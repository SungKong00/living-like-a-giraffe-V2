import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { validate, seed } from './layout.mjs'

export const root = path.resolve(process.env.RIRAGI_DATA || '.world')
export function json(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}
export function put(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.' + randomUUID()
  fs.writeFileSync(tmp, JSON.stringify(value))
  fs.renameSync(tmp, file)
}
export const modelDir = (model) => path.join(root, 'models', model)
export const buildDir = (key) => path.join(root, 'builds', key)
export const catalog = (model) =>
  json(path.join(modelDir(model), 'catalog.json'))
export function conflict(message) {
  return Object.assign(Error(message), { status: 409 })
}

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
        published: { ...draft, asset: 'initial' },
        previous: null,
        job: null,
      })
    }
    if (['대기', '베이크', '최적화'].includes(this.#state.job?.status))
      this.#save({
        ...this.#state,
        job: {
          ...this.#state.job,
          status: '실패',
          error: '서버 재시작 후 다시 발행하세요.',
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
    const draft = {
      id: randomUUID(),
      model,
      layout: validate(layout, catalog(model)),
    }
    this.#save({ ...this.#state, draft })
    return draft
  }
  begin(expected) {
    if (this.#state.draft.id !== expected)
      throw conflict('저장된 최신 초안을 확인하세요.')
    const job = { id: randomUUID(), revision: expected, status: '대기' }
    this.#save({ ...this.#state, job })
    return job.id
  }
  progress(id, status, error) {
    if (this.#state.job?.id === id)
      this.#save({ ...this.#state, job: { ...this.#state.job, status, error } })
  }
  release(id, snapshot, asset) {
    if (this.#state.job?.id !== id || this.#state.job.revision !== snapshot.id)
      return
    this.#save({
      ...this.#state,
      published: { ...snapshot, asset },
      previous:
        this.#state.published.id === snapshot.id
          ? this.#state.previous
          : this.#state.published,
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
