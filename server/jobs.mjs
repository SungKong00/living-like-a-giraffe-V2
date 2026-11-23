import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { studioFile, buildStudioAsset } from './studio-asset.mjs'
import { catalog, root, modelDir, put, json } from './world-files.mjs'
import { conflict } from './store.mjs'
import { blender } from './blender.mjs'
import { assetKey } from './visitor-asset.mjs'
import { cachedLighting, bakeLighting } from './baked-lighting.mjs'
import { mergeItems, studioLights } from './layout.mjs'

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
    return this.#schedule(this.store.beginPublication(expected))
  }
  prepareReview(expected) {
    return this.#schedule(this.store.beginReview(expected))
  }
  #schedule(ticket) {
    if (ticket.snapshot)
      this.#enqueue(async () => {
        if (!ticket.isCurrent()) return
        try {
          await bakeLighting(ticket.snapshot, ticket.stage)
          ticket.complete()
        } catch (error) {
          ticket.fail(error)
        }
      })
    return ticket.id
  }
  async previewLighting(revision, signal) {
    const snapshot = this.store.state.draft
    if (snapshot.id !== revision)
      throw conflict('최신 초안을 다시 열어 주세요.')
    const appearance = assetKey(snapshot)
    const asset =
      cachedLighting(snapshot) ||
      (await this.#enqueue(() => {
        if (assetKey(this.store.state.draft) !== appearance)
          throw conflict('조명 준비 중 초안이 바뀌었습니다.')
        signal?.throwIfAborted()
        return bakeLighting(snapshot, undefined, signal)
      }))
    if (assetKey(this.store.state.draft) !== appearance)
      throw conflict('조명 준비 중 초안이 바뀌었습니다.')
    return { ...snapshot, asset }
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
        put(input, {
          items: snap.layout.items,
          lights: snap.layout.lights,
          handoff: snap.id,
        })
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
  studioAsset(model) {
    const file = studioFile(model)
    return fs.existsSync(file)
      ? Promise.resolve(file)
      : this.#enqueue(() => buildStudioAsset(model))
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
      await this.studioAsset(id)
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
    const lights = mergeItems(
      studioLights.parse(base.layout.lights ?? []),
      studioLights.parse(draft.layout.lights ?? []),
      studioLights.parse(candidate.webLights ?? []),
      Object.fromEntries(
        Object.entries(choices)
          .filter(([key]) => key.startsWith('light:'))
          .map(([key, value]) => [key.slice(6), value]),
      ),
    )
    const furniture = mergeItems(
      base.layout.items,
      draft.layout.items,
      candidate.items,
      choices,
    )
    return {
      model: id,
      revision: draft.id,
      publication: published.id,
      rooms: candidate.rooms,
      items: furniture.items,
      lights: lights.items,
      conflicts: [
        ...furniture.conflicts,
        ...lights.conflicts.map((c) => ({ ...c, key: 'light:' + c.key })),
      ],
    }
  }
}
