import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { optimizeEditor } from '../world/optimize.mjs'
import { catalog, root, modelDir, put, json } from './world-files.mjs'
import { conflict } from './store.mjs'
import { blender } from './blender.mjs'
import { buildVisitorAsset } from './visitor-asset.mjs'
import { mergeItems } from './layout.mjs'

export class Jobs {
  #tail = Promise.resolve()
  #downloads = new Map()
  constructor(store) {
    this.store = store
  }
  #enqueue(fn) {
    const next = this.#tail.then(fn)
    this.#tail = next.catch(() => {})
    return next
  }
  publish(expected) {
    const { draft: snap, job } = this.store.state
    if (
      snap.id === expected &&
      job?.revision === expected &&
      ['대기', '베이크', '최적화'].includes(job.status)
    )
      return job.id
    const id = this.store.begin(expected)
    this.#enqueue(async () => {
      try {
        const asset = await buildVisitorAsset(snap, (stage) =>
          this.store.progress(id, stage),
        )
        this.store.release(id, snap, asset)
      } catch (e) {
        this.store.progress(id, '실패', e.message)
      }
    })
    return id
  }
  download(snap) {
    const dir = path.join(root, 'handoffs', snap.id)
    const file = path.join(dir, 'world.blend')
    if (fs.existsSync(file) && fs.existsSync(path.join(dir, 'ready.json')))
      return Promise.resolve(file)
    if (!this.#downloads.has(snap.id)) {
      const pending = this.#enqueue(async () => {
        put(path.join(dir, 'snapshot.json'), snap)
        const input = path.join(dir, 'input.json')
        put(input, { items: snap.layout.items, handoff: snap.id })
        await blender(
          'download',
          path.join(modelDir(snap.model), 'source.blend'),
          dir,
          input,
        )
        put(path.join(dir, 'ready.json'), true)
        return file
      }).finally(() => this.#downloads.delete(snap.id))
      this.#downloads.set(snap.id, pending)
    }
    return this.#downloads.get(snap.id)
  }
  async upload(buffer) {
    const id = randomUUID(),
      dir = modelDir(id)
    fs.mkdirSync(dir, { recursive: true })
    const source = path.join(dir, 'source.blend')
    fs.writeFileSync(source, buffer)
    try {
      await this.#enqueue(() => blender('inspect', source, dir))
      const candidate = catalog(id)
      if (
        !/^[a-f0-9-]{36}$/.test(candidate.handoff) ||
        !fs.existsSync(
          path.join(root, 'handoffs', candidate.handoff, 'ready.json'),
        )
      )
        throw conflict('이 파일의 인계 기준을 찾을 수 없습니다.')
      await optimizeEditor(
        path.join(dir, 'raw.glb'),
        path.join(dir, 'editor.glb'),
        candidate.rooms.map((r) => r.id),
      )
      fs.rmSync(path.join(dir, 'raw.glb'))
      return this.compare(id)
    } catch (e) {
      fs.rmSync(dir, { recursive: true, force: true })
      throw e
    }
  }
  compare(id, choices = {}) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw Error('모델 ID 오류')
    const candidate = catalog(id)
    const base = json(
      path.join(root, 'handoffs', candidate.handoff, 'snapshot.json'),
    )
    const { draft, published } = this.store.state
    if (base.model !== draft.model)
      throw conflict(
        '제작 원본이 교체되었습니다. 최신 전체 파일을 기준으로 다시 인계하세요.',
      )
    return {
      model: id,
      revision: draft.id,
      publication: published.id,
      rooms: candidate.rooms,
      ...mergeItems(
        base.layout.items,
        draft.layout.items,
        candidate.items,
        choices,
      ),
    }
  }
}
