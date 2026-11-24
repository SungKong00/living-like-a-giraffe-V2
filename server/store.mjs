import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  changeDraft,
  requireRevision,
  versionName,
  versionRecord,
} from './draft-versions.mjs'
import { publishedState } from './world-views.mjs'
import { validate, seed } from './layout.mjs'

import {
  root,
  json,
  put,
  catalog,
  buildDir,
  versionFile,
} from './world-files.mjs'
import { cachedLighting } from './baked-lighting.mjs'
import { initialAsset } from './visitor-asset.mjs'

export function conflict(message) {
  return Object.assign(Error(message), { status: 409 })
}

const building = (job) => ['대기', '베이크', '최적화'].includes(job?.status)

export class WorldStore {
  #file = path.join(root, 'state.json')
  #state
  constructor() {
    if (fs.existsSync(this.#file)) this.#state = json(this.#file)
    else {
      const draft = {
        id: randomUUID(),
        model: 'initial',
        layout: seed(catalog('initial')),
      }
      this.#save({
        draft,
        published: { ...draft, asset: initialAsset(draft) },
        previous: null,
        job: null,
      })
    }
    if (building(this.#state.job))
      this.#save({
        ...this.#state,
        job: {
          ...this.#state.job,
          status: '실패',
          error: '서버가 재시작되었습니다. 작업을 다시 요청하세요.',
        },
      })
  }
  #save(next) {
    put(this.#file, next)
    this.#state = structuredClone(next)
  }
  get state() {
    return structuredClone(this.#state)
  }
  versions() {
    return structuredClone(this.#state.versions ?? [])
  }
  // Immutable layout files are written first. Only the atomic state swap
  // makes them visible; a failed swap may leave an unreferenced file.
  #record(next, records) {
    if (!records.length) return this.#save(next)
    const snapshot = this.#state.draft
    const index = this.#state.versions ?? []
    const additions = records.filter(
      (r) => !index.some((entry) => entry.id === r.id),
    )
    if (additions.length) {
      const file = versionFile(snapshot.id)
      if (!fs.existsSync(file)) put(file, snapshot)
    }
    this.#save({ ...next, versions: [...additions.reverse(), ...index] })
  }
  version(id) {
    const entry = this.#state.versions?.find((r) => r.id === id)
    if (!entry)
      throw Object.assign(Error('버전을 찾을 수 없습니다.'), { status: 404 })
    return json(versionFile(entry.revision))
  }
  nameVersion(expected, name) {
    requireRevision(this.#state.draft, expected)
    const record = versionRecord(this.#state.draft, 'named', versionName(name))
    this.#record(this.#state, [record])
    return this.#state.versions.find((entry) => entry.id === record.id)
  }
  restoreVersion(expected, id) {
    const { model, layout } = this.version(id)
    return this.edit(expected, model, layout, 'restore')
  }
  edit(expected, model, layout, reason) {
    requireRevision(this.#state.draft, expected)
    const { next, records } = changeDraft(
      this.#state,
      expected,
      model,
      validate(layout, catalog(model)),
      reason,
    )
    if (reason === 'restore' || next.job?.kind === 'review') next.job = null
    this.#record(next, records)
    return next.draft
  }
  beginReview(expected) {
    return this.#begin(expected, 'review')
  }
  beginPublication(expected) {
    return this.#begin(expected, 'publish')
  }
  #begin(expected, kind) {
    const { draft, job, published } = this.#state
    if (draft.id !== expected) throw conflict('저장된 최신 초안을 확인하세요.')
    if (kind === 'review' && job?.kind === 'publish' && building(job))
      throw conflict('현재 발행이 끝난 뒤 결과를 준비할 수 있습니다.')
    if (
      kind === 'publish' &&
      job?.kind === 'review' &&
      job.revision === expected &&
      (building(job) || job.status === '검토 가능')
    )
      throw conflict('준비한 결과를 열고 그 화면에서 공개하세요.')
    if (job?.revision === expected && job.kind === kind) {
      if (building(job)) return { id: job.id }
      if (job.status === '검토 가능' && this.#assetExists(job.asset))
        return { id: job.id }
      if (
        kind === 'publish' &&
        job.status === '공개 완료' &&
        published.asset === cachedLighting(draft)
      )
        return { id: job.id }
    }

    const id = randomUUID()
    this.#save({
      ...this.#state,
      job: { id, kind, revision: expected, status: '대기' },
    })
    // The worker can complete only this request. The authoritative snapshot and
    // destination never cross the callback boundary.
    const active = () => this.#state.job?.id === id && building(this.#state.job)
    const status = (status, error) => {
      this.#save({
        ...this.#state,
        job: { ...this.#state.job, status, error, bakePercent: undefined },
      })
    }
    return {
      id,
      isCurrent: active,
      snapshot: structuredClone(draft),
      stage: (next, percent) => {
        if (!active()) return
        if (next === '베이크' && this.#state.job.status === next && Number.isInteger(percent)) {
          if (percent >= 0 && percent <= 100 && percent > (this.#state.job.bakePercent ?? -1))
            this.#state.job.bakePercent = percent
          return
        }
        const allowed = { 대기: '베이크', 베이크: '최적화' }
        if (allowed[this.#state.job.status] !== next)
          throw Error('잘못된 빌드 단계입니다.')
        status(next)
      },
      complete: () => {
        if (!active()) return
        const snapshot = { ...draft, asset: cachedLighting(draft) }
        if (!snapshot.asset) throw Error('검증된 렌더 파일이 없습니다.')
        if (kind === 'publish') this.#publish(snapshot)
        else
          this.#save({
            ...this.#state,
            job: {
              ...this.#state.job,
              status: '검토 가능',
              asset: snapshot.asset,
            },
          })
      },
      fail: (error) => {
        if (active()) status('실패', error.message)
      },
    }
  }
  reviewedSnapshot(id) {
    const { job, draft } = this.#state
    if (
      !job ||
      job.id !== id ||
      job.kind !== 'review' ||
      job.status !== '검토 가능' ||
      job.revision !== draft.id
    )
      throw conflict(
        '초안이나 검토 대상이 변경되었습니다. 최신 초안의 결과를 다시 확인하세요.',
      )
    if (!this.#assetExists(job.asset)) {
      const error = '렌더 파일이 없습니다. 구운 결과를 다시 준비하세요.'
      this.#save({ ...this.#state, job: { ...job, status: '실패', error } })
      throw conflict(error)
    }
    return structuredClone({ ...draft, asset: job.asset })
  }
  approveReview(id) {
    const { job } = this.#state
    if (job?.id === id && job.kind === 'review' && job.status === '공개 완료')
      return
    const snapshot = this.reviewedSnapshot(id)
    this.#publish(snapshot)
  }
  #assetExists(key) {
    return fs.existsSync(path.join(buildDir(key), 'world.glb'))
  }
  #publish(snapshot) {
    this.#save(publishedState(this.#state, snapshot))
  }
  restore() {
    if (!this.#state.previous) throw conflict('복원할 이전 공개본이 없습니다.')
    this.#save({
      ...this.#state,
      published: this.#state.previous,
      previous: this.#state.published,
      job: null,
    })
  }
}
