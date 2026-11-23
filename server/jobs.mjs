import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash, randomUUID } from 'node:crypto'
import { optimize } from '../world/optimize.mjs'
import {
  catalog,
  root,
  modelDir,
  buildDir,
  put,
  json,
  conflict,
} from './store.mjs'
import { mergeItems } from './layout.mjs'

const exec = promisify(execFile)
const python = path.resolve('.venv/bin/python')
const worker = path.resolve('world/worker.py')
const quote = (value) => JSON.stringify(fs.realpathSync(value))
const maxTime = 15 * 60 * 1000
async function blender(mode, source, dir, input) {
  fs.mkdirSync(dir, { recursive: true })
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'riragi-job-'))
  try {
    if (process.platform !== 'darwin')
      throw Error('현재 Blender 작업 격리는 macOS를 지원합니다.')
    const prefix = path.dirname(path.dirname(fs.realpathSync(python)))
    const reads = [
      path.resolve('.venv'),
      prefix,
      path.dirname(worker),
      source,
      dir,
      tmp,
    ]
    const except = (paths) =>
      paths.map((p) => '(require-not (subpath ' + quote(p) + '))').join('')
    const policy =
      '(version 1)(allow default)(deny network*)' +
      '(deny file-read-data (require-all (require-any (subpath "/Users")(subpath "/Volumes")) ' +
      except(reads) +
      '))' +
      '(deny file-write* (require-all ' +
      except([dir, tmp]) +
      '(require-not (literal "/dev/null"))))'
    const args = [worker, mode, source, dir]
    if (input) args.push(input)
    const running = exec(
      '/usr/bin/sandbox-exec',
      ['-p', policy, python, ...args],
      {
        cwd: tmp,
        timeout: maxTime,
        killSignal: 'SIGKILL',
        maxBuffer: 16 * 1024 * 1024,
        env: {
          PATH: '/usr/bin:/bin',
          HOME: tmp,
          TMPDIR: tmp,
          PYTHONDONTWRITEBYTECODE: '1',
          PYTHONNOUSERSITE: '1',
        },
      },
    )
    // macOS does not enforce RLIMIT_AS. Measure the separate Blender process.
    const watch = setInterval(async () => {
      try {
        const { stdout } = await exec('/bin/ps', [
          '-o',
          'rss=',
          '-p',
          String(running.child.pid),
        ])
        if (Number(stdout.trim()) > 6 * 1024 * 1024)
          running.child.kill('SIGKILL')
      } catch {
        /* The worker has already exited. */
      }
    }, 1000)
    try {
      await running
    } finally {
      clearInterval(watch)
    }
  } catch (e) {
    if (process.env.RIRAGI_DEBUG) console.error(e.stderr?.slice(-6000))
    const detail =
      (e.stderr || '')
        .trim()
        .split('\n')
        .filter((line) => /Error:|오류|실패/.test(line))
        .slice(-2)
        .join(' · ') ||
      e.signal ||
      '작업자 시작 실패'
    throw Error('Blender ' + mode + ' 처리 실패 · ' + detail)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}
const digest = (input) =>
  createHash('sha256').update(JSON.stringify(input)).digest('hex')
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
      const published = this.store.state.published
      const sameGeometry =
        published.model === snap.model &&
        digest(published.layout.items) === digest(snap.layout.items)
      const asset = sameGeometry
        ? published.asset
        : digest([snap.model, snap.layout.items, 'bake-v3'])
      const dir = buildDir(asset)
      try {
        if (!fs.existsSync(path.join(dir, 'world.glb'))) {
          this.store.progress(id, '베이크')
          const input = path.join(dir, 'input.json')
          put(input, { items: snap.layout.items, handoff: snap.id })
          await blender(
            'publish',
            path.join(modelDir(snap.model), 'source.blend'),
            dir,
            input,
          )
          this.store.progress(id, '최적화')
          await optimize(
            path.join(dir, 'raw.glb'),
            path.join(dir, 'candidate.glb'),
            catalog(snap.model).rooms.map((r) => r.id),
          )
          fs.renameSync(
            path.join(dir, 'candidate.glb'),
            path.join(dir, 'world.glb'),
          )
        }
        if (asset !== 'initial')
          fs.rmSync(path.join(dir, 'raw.glb'), { force: true })
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
      await optimize(
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
