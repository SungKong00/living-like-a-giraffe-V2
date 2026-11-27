import { characterListing, editCharacters } from '../../cloud/characters.mjs'
import { characterSheet } from '../../shared/character-sheet.mjs'
import {
  availableImport,
  uploadedScene,
  inspectResult,
  checkBlend,
} from '../../cloud/handoff.mjs'
import { publisherVersion } from '../../shared/helper-connection.mjs'
import { Buffer } from 'node:buffer'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { validate } from '../../server/layout.mjs'
import {
  editorView,
  visitorView,
  publishedState,
} from '../../server/world-views.mjs'
import {
  asset,
  commit,
  complete,
  reject,
  reviewed,
  listVersions,
  nameVersion,
  readVersion,
  saveDraft,
  world,
} from '../../cloud/state.mjs'
import { validateResult } from '../../cloud/glb.mjs'

const digest = (value) => createHash('sha256').update(value).digest('hex')
const secret = () => randomBytes(32).toString('hex')
const equal = (a, b) =>
  typeof a === 'string' &&
  typeof b === 'string' &&
  timingSafeEqual(Buffer.from(digest(a)), Buffer.from(digest(b)))
const json = (value, status = 200, headers = {}) =>
  Response.json(value, {
    status,
    headers: { 'Cache-Control': 'private, no-store', ...headers },
  })
const setting = (db, name) =>
  db
    .prepare('SELECT value FROM settings WHERE name=?')
    .bind(name)
    .first('value')
const catalog = async (db, model) =>
  JSON.parse(await setting(db, 'catalog/' + model))
const active = (job) => job?.token && job.deadline > Date.now()
const limit = 16 * 1024 * 1024
async function body(req, maximum) {
  if (Number(req.headers.get('Content-Length')) > maximum)
    reject(413, '파일이 너무 큽니다.')
  const reader = req.body?.getReader()
  if (!reader) reject(400, '본문이 필요합니다.')
  const chunks = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > maximum) {
      await reader.cancel()
      reject(413, '파일이 너무 큽니다.')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks, total)
}
const input = async (req) =>
  JSON.parse((await body(req, 650000)).toString('utf8'))

async function login(db, request) {
  const { key } = await input(request)
  if (typeof key !== 'string' || !equal(digest(key), await setting(db, 'key')))
    reject(403, '관리자 키가 맞지 않습니다.')
  const token = secret(),
    expires = Date.now() + 8 * 3600000
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE expires<=?').bind(Date.now()),
    db
      .prepare('INSERT INTO sessions VALUES (?,?)')
      .bind(digest(token), expires),
  ])
  return json({ ok: true }, 200, {
    'Set-Cookie':
      'riragi=' +
      token +
      '; Path=/api; Max-Age=28800; HttpOnly; SameSite=Strict; Secure',
  })
}

async function helper(db, req, route, current) {
  const { state, version } = current
  const [, id, action] = route.split('/')
  const incoming = availableImport(state)
  const inspecting = incoming?.id === id
  const field = inspecting ? 'incoming' : 'job'
  const j = state[field]
  if (
    !active(j) ||
    id !== j.id ||
    (!inspecting && j.revision !== state.draft.id) ||
    !equal(req.headers.get('Authorization'), 'Bearer ' + j.token)
  )
    reject(403, '작업 시간이 끝났거나 장면이 바뀌었습니다.')
  const model = await catalog(db, state.draft.model)
  if (action === 'source' && req.method === 'GET')
    return asset(db, 'source/' + (inspecting ? id : state.draft.model))
  if (
    ['start', 'blend', 'result'].includes(action) &&
    req.headers.get('X-Publisher-Version') !== publisherVersion
  )
    reject(409, '스튜디오에서 최신 발행 도우미를 다시 내려받으세요.')
  if (action === 'start' && req.method === 'POST') {
    if (j.attempt && req.headers.get('X-Publisher-Claim') === 'waiting')
      reject(
        409,
        '다른 도우미가 처리 중입니다. 이어서 처리하려면 스튜디오에서 선택하세요.',
      )
    const attempt = secret()
    await commit(db, version, {
      ...state,
      [field]: {
        ...j,
        attempt,
        status: inspecting ? '파일 확인 중' : '베이크',
      },
    })
    return json({
      attempt,
      kind: j.kind,
      publication: state.published.id,
      snapshot: inspecting ? undefined : state.draft,
      rooms: model.rooms.map((r) => r.id),
    })
  }
  if (!equal(req.headers.get('X-Publisher-Attempt'), j.attempt))
    reject(409, '다른 도우미가 이 작업을 이어받았습니다.')
  if (action === 'fail' && req.method === 'POST') {
    const { error } = await input(req)
    await commit(db, version, {
      ...state,
      [field]: {
        ...j,
        token: undefined,
        attempt: undefined,
        status: '실패',
        error: String(error || '도우미를 다시 실행하세요.').slice(0, 300),
      },
    })
    return json({ ok: true })
  }
  if (inspecting && action === 'result' && req.method === 'PUT')
    return inspectResult(db, current, req, { body, json, limit })
  if (inspecting) reject(404, '작업을 찾을 수 없습니다.')
  if (action === 'blend' && req.method === 'PUT') {
    const bytes = await body(req, limit)
    checkBlend(bytes)
    const name = 'blend/' + digest(bytes)
    await commit(
      db,
      version,
      { ...state, job: { ...j, blend: name } },
      { name, bytes },
    )
    return json({ ok: true })
  }
  if (action === 'result' && req.method === 'PUT' && j.status === '베이크') {
    const bytes = await body(req, limit)
    if (!j.blend) reject(409, '이 개정의 Blender 파일을 먼저 제출하세요.')
    validateResult(bytes, model.rooms, state.draft.layout.items)
    const hash = digest(bytes)
    await commit(db, version, complete(state, hash), {
      name: 'baked/' + hash,
      bytes,
    })
    return json({ ok: true })
  }
  reject(404, '작업을 찾을 수 없습니다.')
}

async function handle({ request: req, env, params, waitUntil, next }) {
  const db = env.STUDIO,
    route = [].concat(params.path || []).join('/')
  const url = new URL(req.url),
    method = req.method
  if (
    method !== 'GET' &&
    req.headers.has('Origin') &&
    req.headers.get('Origin') !== url.origin
  )
    reject(403, '같은 사이트에서 요청하세요.')
  if (route === 'login' && method === 'POST') return login(db, req)
  const isPublic = route === 'world' || route.startsWith('world/')
  if (!isPublic && !route.startsWith('helper/')) {
    const cookie = /(?:^|;\s*)riragi=([0-9a-f]{64})(?:;|$)/.exec(
      req.headers.get('Cookie') || '',
    )
    if (
      !cookie ||
      !(await db
        .prepare('SELECT 1 FROM sessions WHERE digest=? AND expires>?')
        .bind(digest(cookie[1]), Date.now())
        .first())
    )
      reject(401, '스튜디오 로그인이 필요합니다.')
  }
  const current = await world(db),
    { state, version } = current
  const { draft, published, job } = state
  if (route.startsWith('helper/')) return helper(db, req, route, current)
  const visitor = async (snap, path, privateView = false) => {
    const cast = snap.cast
    return json({
      ...visitorView(snap, await catalog(db, snap.model), path),
      ...(cast && {
        characters: {
          ...cast,
          base: privateView
            ? '/api/admin/characters/files/'
            : '/api/world/characters/',
        },
      }),
    })
  }
  if (method === 'GET' && route.startsWith('world/characters/')) {
    const file = /^world\/characters\/([\w-]+)\.glb$/.exec(route)?.[1]
    if (
      !file ||
      ![published, state.previous].some((snap) =>
        snap?.cast?.files.includes(file),
      )
    )
      reject(404, '공개되지 않은 캐릭터 파일입니다.')
    return asset(db, 'character/' + file + '.glb', true)
  }
  if (method === 'GET' && route === 'world')
    return visitor(published, '/api/world/' + published.asset)
  if (method === 'GET' && route.startsWith('world/')) {
    const key = route.slice(6)
    if (![published.asset, state.previous?.asset].includes(key))
      reject(404, '공개되지 않은 파일입니다.')
    const cache = caches.default
    const cacheKey = new Request(url.origin + '/api/world/' + key)
    const cached = await cache.match(cacheKey)
    if (cached) return cached
    const response = await asset(db, 'baked/' + key, true)
    waitUntil(cache.put(cacheKey, response.clone()))
    return response
  }
  const model = await catalog(db, draft.model)
  const editor = (snap) =>
    json({ ...editorView(snap, model), publishing: 'helper' })
  if (route === 'admin/draft' && method === 'GET') return editor(draft)
  if (route === 'admin/draft' && method === 'PUT') {
    const { revision, layout } = await input(req)
    if (revision !== draft.id)
      reject(409, '다른 변경이 먼저 저장되었습니다. 다시 열어 확인하세요.')
    return editor(
      await saveDraft(
        db,
        current,
        revision,
        draft.model,
        validate(layout, model),
      ),
    )
  }
  if (route === 'admin/versions' && method === 'GET')
    return json(await listVersions(db))
  if (route === 'admin/versions' && method === 'POST') {
    const { revision, name } = await input(req)
    return json(await nameVersion(db, current, revision, name))
  }
  const historyRoute =
    /^admin\/versions\/([a-f0-9]{64})(?:\/(model|restore))?$/.exec(route)
  if (historyRoute) {
    const [, id, action] = historyRoute
    const snap = await readVersion(db, id)
    if (method === 'GET' && action === 'model')
      return asset(db, 'editor/' + snap.model)
    const source = await catalog(db, snap.model)
    if (method === 'GET' && !action)
      return json({
        ...editorView(snap, source),
        asset: '/api/admin/versions/' + id + '/model',
        characterLibrary: await characterListing(db, snap.layout),
      })
    if (method === 'POST' && action === 'restore') {
      const { revision } = await input(req)
      const next = await saveDraft(
        db,
        current,
        revision,
        snap.model,
        validate(snap.layout, source),
        'restore',
      )
      return json({ ...editorView(next, source), publishing: 'helper' })
    }
  }
  if (method === 'GET' && route === 'admin/model/' + draft.model)
    return asset(db, 'editor/' + draft.model)
  if (
    [
      'admin/download/published',
      'admin/upload',
      'admin/import',
      'admin/upload-status',
    ].includes(route) ||
    /^admin\/(model|compare|candidate)\//.test(route)
  )
    return uploadedScene(db, current, req, route, {
      json,
      body,
      input,
      limit,
      secret,
      catalog,
    })
  if (method === 'GET' && route === 'admin/characters')
    return json(await characterListing(db, draft.layout))
  if (route.startsWith('admin/characters/') && method !== 'GET')
    return json(
      await editCharacters(db, current, req, route, { body, input, limit }),
    )
  // The bundled clay sample is also available on older, single-model D1 seeds.
  if (
    method === 'GET' &&
    route === 'admin/characters/files/riragi-biped.glb' &&
    next
  ) {
    const stored = await db
      .prepare('SELECT 1 FROM files WHERE name=? LIMIT 1')
      .bind('character/riragi-biped.glb')
      .first()
    if (!stored) {
      const modelId = await setting(db, 'clay/biped-model')
      const sampleModel =
        modelId &&
        (await characterListing(db)).models.find((m) => m.id === modelId)
      if (sampleModel)
        return asset(db, 'character/' + sampleModel.file + '.glb')
      const sample = await next()
      return new Response(sample.body, {
        status: sample.status,
        headers: {
          'Content-Type': 'model/gltf-binary',
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      })
    }
  }
  if (method === 'GET' && route.startsWith('admin/characters/files/'))
    return asset(
      db,
      'character/' + route.slice('admin/characters/files/'.length),
    )
  if (route === 'admin/status' && method === 'GET') {
    const { token, deadline, attempt, ...view } = job || {}
    if (token && !active(job))
      Object.assign(view, {
        status: '실패',
        error: '작업 시간이 끝났습니다. 미리보기를 다시 만드세요.',
      })
    return json({
      published: published.id,
      previous: !!state.previous,
      job: job ? view : null,
      helper: active(job)
        ? url.origin + '/api/helper/' + job.id + '#' + token
        : null,
    })
  }
  if (['admin/reviews', 'admin/publish'].includes(route) && method === 'POST') {
    const { revision } = await input(req)
    if (revision !== draft.id) reject(409, '저장된 최신 초안을 확인하세요.')
    const kind = route.endsWith('reviews') ? 'review' : 'publish'
    if (active(job) || job?.status === '검토 가능') {
      if (job.kind !== kind) reject(409, '준비 중인 결과를 먼저 확인하세요.')
      return json({ job: job.id }, 202)
    }
    const next = {
      id: crypto.randomUUID(),
      revision,
      kind,
      cast: characterSheet(
        draft.layout,
        await characterListing(db, draft.layout),
      ),
      status: '대기',
      token: secret(),
      deadline: Date.now() + 2 * 3600000,
    }
    await commit(db, version, { ...state, job: next })
    return json({ job: next.id }, 202)
  }
  const review = /^admin\/reviews\/([^/]+)(?:\/(asset|publish))?$/.exec(route)
  if (review) {
    if (
      method === 'POST' &&
      review[2] === 'publish' &&
      job?.id === review[1] &&
      job.status === '공개 완료'
    )
      return json({ ok: true })
    const snapshot = reviewed(state, review[1])
    if (method === 'GET' && !review[2])
      return visitor(snapshot, '/api/admin/reviews/' + job.id + '/asset', true)
    if (method === 'GET' && review[2] === 'asset')
      return asset(db, 'baked/' + snapshot.asset)
    if (method === 'POST' && review[2] === 'publish') {
      await commit(db, version, publishedState(state, snapshot))
      return json({ ok: true })
    }
  }
  if (route === 'admin/restore' && method === 'POST') {
    if (!state.previous) reject(409, '직전 공개본이 없습니다.')
    await commit(db, version, {
      ...state,
      published: state.previous,
      previous: published,
      job: null,
    })
    return json({ ok: true })
  }
  reject(404, '이 클라우드 스튜디오에서 제공되지 않는 요청입니다.')
}

export async function onRequest(ctx) {
  try {
    return await handle(ctx)
  } catch (e) {
    if (/^D1_/.test(e.message)) {
      console.error(e.message)
      return json({ error: '저장소 요청을 완료할 수 없습니다.' }, 503)
    }
    return json({ error: e.message }, e.status || 400)
  }
}
