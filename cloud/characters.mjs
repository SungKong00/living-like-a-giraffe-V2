import { createHash } from 'node:crypto'
import { WebIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import {
  characterCatalog,
  modelFacts,
  motionEntry,
} from '../shared/character-library.mjs'
import { asset, commit, reject } from './state.mjs'

const io = new WebIO().registerExtensions(ALL_EXTENSIONS)
const libraryKey = 'character-library-v1'
const setting = (db, key) =>
  db.prepare('SELECT value FROM settings WHERE name=?').bind(key).first('value')
// Retired library entries can still be referenced by a saved version. Only
// expose those specific entries while previewing or restoring that layout.
export async function characterListing(db, layout) {
  const active = JSON.parse((await setting(db, 'characters')) ?? null) ?? {
    models: [],
    motions: [],
    fallback: null,
  }
  const characters = layout?.characters ?? layout?.giraffes ?? []
  const models = new Set(characters.map((c) => c.model).filter(Boolean))
  const clips = [
    layout?.defaults?.character ?? layout?.defaults?.giraffe,
    ...characters,
  ].flatMap((c) => [c?.motion ?? []].flat())
  const motions = new Set(clips.map((clip) => clip.split('/')[0]))
  for (const m of active.models) models.delete(m.id)
  for (const m of active.motions) motions.delete(m.id)
  if (!models.size && !motions.size) return active
  const archive = JSON.parse((await setting(db, 'character-archive')) ?? null)
  if (!archive) return active
  return {
    ...active,
    models: [
      ...active.models,
      ...archive.models.filter((m) => models.has(m.id)),
    ],
    motions: [
      ...active.motions,
      ...archive.motions.filter((m) => motions.has(m.id)),
    ],
  }
}
async function parse(bytes) {
  try {
    return await io.readBinary(bytes)
  } catch {
    reject(
      422,
      '스킨·동작과 외부 자료를 포함한 바이너리 GLB 파일을 선택하세요.',
    )
  }
}

// Older seeds contain display counts only. Recover the exact joint names from
// the files already registered with that world before accepting new motions.
async function recover(db, listing) {
  const library = {
    models: [],
    motions: [],
    builtin: {},
    fallback: listing.fallback,
  }
  const bundled = []
  const documents = new Map()
  async function document(id) {
    if (!documents.has(id)) {
      const response = await asset(db, 'character/' + id + '.glb')
      documents.set(
        id,
        await parse(new Uint8Array(await response.arrayBuffer())),
      )
    }
    return documents.get(id)
  }
  for (const m of listing.models) {
    const file = m.file ?? m.id
    const model = { ...m, file, ...modelFacts(await document(file)) }
    if (m.builtin) bundled.push({ model, motion: null })
    else library.models.push(model)
  }
  for (const m of listing.motions) {
    const entry = { ...m, ...motionEntry(await document(m.id), m.id, m.name) }
    const owner = m.builtin && bundled.find(({ model }) => model.id === m.id)
    if (owner) owner.motion = entry
    else library.motions.push(entry)
  }
  return { library, bundled }
}

export async function editCharacters(
  db,
  current,
  req,
  route,
  { body, input, limit },
) {
  const match =
    /^admin\/characters\/(models|motions)(?:\/([\w-]+)(\/file)?)?$/.exec(route)
  if (!match) reject(404, '캐릭터 자료를 찾을 수 없습니다.')
  const [, kind, id, replace] = match
  const method = req.method
  const upload = method === 'POST' && (!id || (replace && kind === 'models'))
  if (
    !upload &&
    !(
      id &&
      !replace &&
      (method === 'DELETE' || (method === 'PATCH' && kind === 'models'))
    )
  )
    reject(405, '지원하지 않는 자료실 요청입니다.')
  if (
    upload &&
    req.headers.get('Content-Type')?.split(';')[0] !==
      'application/octet-stream'
  )
    reject(415, '바이너리 GLB 파일을 선택하세요.')
  const bytes = upload ? await body(req, limit) : null
  const listing = await characterListing(db)
  const stored =
    JSON.parse((await setting(db, libraryKey)) ?? null) ??
    (await recover(db, listing))
  let file
  const catalog = characterCatalog({
    read: () => stored.library,
    bundledEntries: () => stored.bundled,
    isBuiltin: (id) => stored.bundled.some((e) => e.model.id === id),
    parse,
    store(bytes) {
      const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16)
      file = { name: 'character/' + hash + '.glb', bytes }
      return hash
    },
    // Save the parsed facts, visible catalog and file in one guarded D1 batch.
    persist: (library) => {
      stored.library = library
    },
    async layouts() {
      const { state } = current
      const { results } = await db
        .prepare('SELECT DISTINCT layout FROM draft_versions')
        .all()
      return [state.draft, state.published, state.previous]
        .filter(Boolean)
        .map((s) => s.layout)
        .concat(results.map((r) => JSON.parse(r.layout)))
    },
  })
  const name = (
    new URL(req.url).searchParams.get('name') ||
    (kind === 'models' ? '캐릭터 모델' : '동작')
  ).replace(/\.glb$/i, '')
  let result
  if (upload) {
    if (replace) result = await catalog.replaceModel(id, bytes)
    else if (kind === 'models') result = await catalog.addModel(bytes, name)
    else result = await catalog.addMotion(bytes, name)
  } else if (method === 'PATCH')
    result = await catalog.updateModel(id, await input(req))
  else if (kind === 'models') result = await catalog.removeModel(id)
  else result = await catalog.removeMotion(id)
  const settings = [
    [libraryKey, stored],
    ['characters', result.library ?? result],
  ].map(([key, value]) => {
    const data = JSON.stringify(value)
    if (new TextEncoder().encode(data).length > 1500000)
      reject(413, '자료실 목록이 너무 큽니다.')
    return db
      .prepare(
        'INSERT OR REPLACE INTO settings SELECT ?,? WHERE (SELECT version FROM world WHERE id=1)=?',
      )
      .bind(key, data, current.version)
  })
  await commit(db, current.version, current.state, file, null, settings)
  return result
}
