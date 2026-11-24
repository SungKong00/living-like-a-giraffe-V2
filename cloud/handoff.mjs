import { asset, commit, reject, saveDraft } from './state.mjs'
import { compareHandoff } from '../server/compare-handoff.mjs'
import { validate } from '../server/layout.mjs'
import { editorView } from '../server/world-views.mjs'
import { validateResult } from './glb.mjs'

export function checkBlend(bytes) {
  // Blender writes plain, gzip, or Zstandard-compressed project files.
  if (
    bytes.length < 12 ||
    !(
      bytes.subarray(0, 7).toString() === 'BLENDER' ||
      bytes.readUInt16BE(0) === 0x1f8b ||
      bytes.readUInt32LE(0) === 0xfd2fb528
    )
  )
    reject(422, 'Blender에서 저장한 .blend 파일을 선택하세요.')
}

export function availableImport(state) {
  const incoming = state.incoming
  if (!incoming || incoming.publication !== state.published.id) return null
  return incoming
}

export async function uploadedScene(db, current, req, route, io) {
  const { state, version } = current
  const { draft, published } = state
  const { json, body, input, limit, secret, catalog } = io
  const incoming = availableImport(state)
  if (route === 'admin/download/published' && req.method === 'GET') {
    const response = await asset(
      db,
      published.blend || 'legacy/' + published.id,
    )
    response.headers.set('Content-Type', 'application/octet-stream')
    response.headers.set(
      'Content-Disposition',
      'attachment; filename="giraffe-' + published.id.slice(0, 8) + '.blend"',
    )
    return response
  }
  if (route === 'admin/upload' && req.method === 'POST') {
    const bytes = await body(req, limit)
    checkBlend(bytes)
    const id = crypto.randomUUID()
    const next = {
      id,
      publication: published.id,
      status: '대기',
      kind: 'inspect',
      token: secret(),
      deadline: Date.now() + 2 * 3600000,
    }
    await commit(
      db,
      version,
      { ...state, incoming: next },
      { name: 'source/' + id, bytes },
    )
    return json({ id }, 202)
  }
  if (route === 'admin/upload-status' && req.method === 'GET') {
    if (!incoming) return json(null)
    const active = incoming.token && incoming.deadline > Date.now()
    const expired = incoming.token && !active
    return json({
      id: incoming.id,
      status: expired ? '실패' : incoming.status,
      error: expired
        ? '작업 시간이 만료되었습니다. 파일을 다시 올리세요.'
        : incoming.error,
      helper: active
        ? new URL(req.url).origin +
          '/api/helper/' +
          incoming.id +
          '#' +
          incoming.token
        : null,
    })
  }
  const match = /^admin\/(compare|candidate|model)\/([a-f0-9-]+)$/.exec(route)
  if (
    !incoming ||
    incoming.status !== '검토 가능' ||
    (!match && route !== 'admin/import') ||
    (match && match[2] !== incoming.id)
  )
    reject(
      409,
      '검토할 파일이 바뀌었습니다. 현재 공개본을 기준으로 다시 올리세요.',
    )
  const fileModel = await catalog(db, incoming.id)
  if (match?.[1] === 'model' && req.method === 'GET')
    return asset(db, 'editor/' + incoming.id)
  const values = req.method === 'POST' ? await input(req) : {}
  const differentSource = draft.model !== published.model
  // Meshes in independently revised Blender files cannot be merged by the layout contract.
  // Keep the current web pages and links, and require an explicit choice of the new geometry.
  const result = differentSource
    ? {
        model: incoming.id,
        revision: draft.id,
        publication: published.id,
        rooms: fileModel.rooms,
        items: fileModel.items,
        lights: fileModel.webLights ?? [],
        sourceLights: [],
        sourceCatalog: fileModel.sourceLights,
        conflicts:
          values.choices?.['blender-source'] === 'file'
            ? []
            : [{ key: 'blender-source', replaceModel: true }],
      }
    : compareHandoff(
        incoming.id,
        fileModel,
        published,
        await catalog(db, published.model),
        draft,
        published,
        values.choices,
      )
  if (match?.[1] === 'compare' && req.method === 'GET') return json(result)
  const layout = {
    ...draft.layout,
    items: result.items,
    lights: result.lights,
    sourceLights: result.sourceLights,
  }
  if (match?.[1] === 'candidate')
    return json(
      editorView({ id: draft.id, model: incoming.id, layout }, fileModel),
    )
  if (route !== 'admin/import' || req.method !== 'POST')
    reject(404, '요청을 찾을 수 없습니다.')
  if (
    values.model !== incoming.id ||
    values.revision !== draft.id ||
    values.publication !== published.id ||
    result.conflicts.length
  )
    reject(409, '초안이 바뀌었습니다. 최신 초안에서 다시 확인하세요.')
  if (values.spots) layout.spots = values.spots
  const next = await saveDraft(
    db,
    current,
    values.revision,
    incoming.id,
    validate(layout, fileModel),
    'import',
  )
  return json({ ...editorView(next, fileModel), publishing: 'helper' })
}

export async function inspectResult(db, current, req, io) {
  const { state, version } = current
  const incoming = availableImport(state)
  const bytes = await io.body(req, io.limit + 650000)
  // One message ties the catalog to the exact editor GLB. Both become visible together.
  if (bytes.length < 4) reject(422, '검토 결과가 비어 있습니다.')
  const length = bytes.readUInt32BE(0)
  if (length > 650000 || length + 4 >= bytes.length)
    reject(422, '검토 결과가 올바르지 않습니다.')
  const model = JSON.parse(bytes.toString('utf8', 4, 4 + length))
  if (model.handoff !== state.published.id)
    reject(
      409,
      '현재 공개본에서 받은 .blend를 선택하세요. 공개본이 바뀌었다면 다시 내려받으세요.',
    )
  if (
    !model.rooms?.length ||
    !Array.isArray(model.items) ||
    !Array.isArray(model.sourceLights) ||
    !model.options
  )
    reject(422, '파일의 방과 가구 정보를 확인하세요.')
  const glb = bytes.subarray(4 + length)
  if (glb.length > io.limit) reject(413, '검토용 모델이 16 MiB를 넘었습니다.')
  validateResult(glb, model.rooms, model.items)
  await commit(
    db,
    version,
    {
      ...state,
      incoming: {
        ...incoming,
        status: '검토 가능',
        token: undefined,
        attempt: undefined,
      },
    },
    { name: 'editor/' + incoming.id, bytes: glb },
    { name: 'catalog/' + incoming.id, value: JSON.stringify(model) },
  )
  return io.json({ ok: true })
}
