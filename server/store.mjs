import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { validate, seed } from './layout.mjs'

import { root, json, put, catalog, buildDir } from './world-files.mjs'
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
    for (const snap of [this.#state.published, this.#state.previous].filter(
      Boolean,
    ))
      cachedLighting(snap)
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
  edit(expected, model, layout) {
    if (this.#state.draft.id !== expected)
      throw conflict('다른 변경이 먼저 저장되었습니다. 다시 열어 확인하세요.')
    cachedLighting(this.#state.draft)
    const draft = {
      id: randomUUID(),
      model,
      layout: validate(layout, catalog(model)),
    }
    const { job } = this.#state
    this.#save({
      ...this.#state,
      draft,
      job: job?.kind === 'review' ? null : job,
    })
    return draft
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
      this.#save({ ...this.#state, job: { ...this.#state.job, status, error } })
    }
    return {
      id,
      isCurrent: active,
      snapshot: structuredClone(draft),
      stage: (next) => {
        if (!active()) return
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
    const { published, previous } = this.#state
    this.#save({
      ...this.#state,
      published: snapshot,
      previous:
        published.id === snapshot.id && published.asset === snapshot.asset
          ? previous
          : published,
      job: { ...this.#state.job, status: '공개 완료' },
    })
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
