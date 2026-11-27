import { Buffer } from 'node:buffer'
import {
  changeDraft,
  requireRevision,
  versionName,
  versionRecord,
} from '../server/draft-versions.mjs'
import { publishedState } from '../server/world-views.mjs'

export function reject(status, message) {
  throw Object.assign(new Error(message), { status })
}
export async function world(db) {
  const row = await db
    .prepare('SELECT version,data FROM world WHERE id=1')
    .first()
  if (!row) reject(503, '클라우드 월드를 준비 중입니다.')
  return { version: row.version, state: JSON.parse(row.data) }
}

const metadata = 'id, kind, title, createdAt, revision, model'

export async function listVersions(db) {
  const { results } = await db
    .prepare(
      'SELECT ' +
        metadata +
        ' FROM draft_versions ORDER BY createdAt DESC, rowid DESC',
    )
    .all()
  return results
}

export async function readVersion(db, id) {
  const row = await db
    .prepare('SELECT revision,model,layout FROM draft_versions WHERE id=?')
    .bind(id)
    .first()
  if (!row) reject(404, '버전을 찾을 수 없습니다.')
  return { id: row.revision, model: row.model, layout: JSON.parse(row.layout) }
}

function insertVersion(db, record, layout, expectedVersion = null) {
  return db
    .prepare(
      "INSERT OR IGNORE INTO draft_versions (id,kind,title,createdAt,revision,model,layout) SELECT ?,?,?,?,?,?,? WHERE (SELECT json_extract(data,'$.draft.id') FROM world WHERE id=1)=? AND (? IS NULL OR (SELECT version FROM world WHERE id=1)=?)",
    )
    .bind(
      record.id,
      record.kind,
      record.title,
      record.createdAt,
      record.revision,
      record.model,
      JSON.stringify(layout),
      record.revision,
      expectedVersion,
      expectedVersion,
    )
}

export async function nameVersion(db, { state }, expected, name) {
  requireRevision(state.draft, expected)
  const record = versionRecord(state.draft, 'named', versionName(name))
  // A named save leaves the draft revision and active review untouched.
  await insertVersion(db, record, state.draft.layout).run()
  const saved = await db
    .prepare('SELECT ' + metadata + ' FROM draft_versions WHERE id=?')
    .bind(record.id)
    .first()
  if (!saved)
    reject(409, '다른 변경이 먼저 저장되었습니다. 다시 열어 확인하세요.')
  return saved
}

export async function saveDraft(
  db,
  { state, version },
  expected,
  model,
  layout,
  reason,
) {
  const { next, records } = changeDraft(state, expected, model, layout, reason)
  next.job = null
  if (reason === 'import') next.incoming = null
  await commit(
    db,
    version,
    next,
    null,
    null,
    records.map((record) =>
      insertVersion(db, record, state.draft.layout, version),
    ),
  )
  return next.draft
}

// All changes, including the bytes a new pointer references, commit together.
// Guard each insert as well as the pointer when concurrent requests race.
export async function commit(db, version, state, file, setting, records = []) {
  const data = JSON.stringify(state)
  if (Buffer.byteLength(data) > 1850000)
    reject(413, '저장할 월드 데이터가 너무 큽니다.')
  const statements = [...records]
  if (file) {
    const size = 512 * 1024
    for (let offset = 0; offset < file.bytes.length; offset += size) {
      statements.push(
        db
          .prepare(
            'INSERT OR IGNORE INTO files SELECT ?,?,? WHERE (SELECT version FROM world WHERE id=1)=?',
          )
          .bind(
            file.name,
            offset / size,
            file.bytes.subarray(offset, offset + size).toString('base64'),
            version,
          ),
      )
    }
  }
  if (setting)
    statements.push(
      db
        .prepare(
          'INSERT OR IGNORE INTO settings SELECT ?,? WHERE (SELECT version FROM world WHERE id=1)=?',
        )
        .bind(setting.name, setting.value, version),
    )
  statements.push(
    db
      .prepare(
        'UPDATE world SET version=version+1,data=? WHERE id=1 AND version=?',
      )
      .bind(data, version),
  )
  const change = statements.length - 1
  // Retain exactly the current, previous and review assets in this transaction.
  statements.push(
    db.prepare(`DELETE FROM files WHERE name >= 'baked/' AND name < 'baked0'
    AND name NOT IN (
      SELECT 'baked/' || coalesce(json_extract(data,'$.published.asset'),'') FROM world
      UNION SELECT 'baked/' || coalesce(json_extract(data,'$.previous.asset'),'') FROM world
      UNION SELECT 'baked/' || coalesce(json_extract(data,'$.job.asset'),'') FROM world
    )`),
  )
  // Old draft versions still need their Blender source, catalog and editor mesh.
  for (const prefix of ['source/', 'editor/', 'catalog/']) {
    const table = prefix === 'catalog/' ? 'settings' : 'files'
    statements.push(
      db
        .prepare(
          `DELETE FROM ${table} WHERE name GLOB ?
      AND substr(name,?) NOT IN (
        SELECT coalesce(json_extract(data,'$.draft.model'),'') FROM world UNION
        SELECT coalesce(json_extract(data,'$.published.model'),'') FROM world UNION
        SELECT coalesce(json_extract(data,'$.previous.model'),'') FROM world UNION
        SELECT coalesce(json_extract(data,'$.incoming.id'),'') FROM world UNION
        SELECT model FROM draft_versions)`,
        )
        .bind(
          prefix + '????????-????-????-????-????????????',
          prefix.length + 1,
        ),
    )
  }
  statements.push(
    db.prepare(`DELETE FROM files WHERE name GLOB 'blend/*' AND name NOT IN (
    SELECT coalesce(json_extract(data,'$.published.blend'),'') FROM world UNION
    SELECT coalesce(json_extract(data,'$.previous.blend'),'') FROM world UNION
    SELECT coalesce(json_extract(data,'$.job.blend'),'') FROM world)`),
  )
  const results = await db.batch(statements)
  if (!results[change].meta.changes)
    reject(409, '다른 변경이 먼저 저장되었습니다. 다시 확인하세요.')
}

export async function asset(db, name, publicAsset = false) {
  const { results } = await db
    .prepare('SELECT content FROM files WHERE name=? ORDER BY part')
    .bind(name)
    .all()
  if (!results.length) reject(404, '파일이 없습니다.')
  return new Response(
    Buffer.concat(results.map((r) => Buffer.from(r.content, 'base64'))),
    {
      headers: {
        'Content-Type': name.startsWith('source/')
          ? 'application/octet-stream'
          : 'model/gltf-binary',
        'Cache-Control': publicAsset
          ? 'public, max-age=31536000, immutable'
          : 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  )
}

export function reviewed(state, id) {
  const j = state.job
  if (
    j?.id !== id ||
    j.kind !== 'review' ||
    j.revision !== state.draft.id ||
    j.status !== '검토 가능'
  )
    reject(409, '최신 초안의 구운 결과를 다시 준비하세요.')
  return {
    ...state.draft,
    asset: j.asset,
    blend: j.blend,
    ...(j.cast && { cast: j.cast }),
  }
}

export function complete(state, assetId) {
  const snapshot = {
    ...state.draft,
    asset: assetId,
    blend: state.job.blend,
    ...(state.job.cast && { cast: state.job.cast }),
  }
  const job = {
    ...state.job,
    token: undefined,
    attempt: undefined,
    asset: assetId,
    status: '검토 가능',
  }
  const next = { ...state, job }
  return job.kind === 'publish' ? publishedState(next, snapshot) : next
}
