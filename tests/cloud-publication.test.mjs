import { riggedGiraffe, giraffeMotion } from './giraffe-fixture.mjs'
import { characterListing } from '../cloud/characters.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { onRequest } from '../functions/api/[[path]].js'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import { Buffer } from 'node:buffer'
import {
  asset,
  commit,
  complete,
  listVersions,
  nameVersion,
  readVersion,
  reviewed,
  saveDraft,
  world,
} from '../cloud/state.mjs'
import { validateResult } from '../cloud/glb.mjs'

function store(state) {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(
    fs.readFileSync(new URL('../cloud/schema.sql', import.meta.url), 'utf8'),
  )
  sqlite.prepare('INSERT INTO world VALUES(1,0,?)').run(JSON.stringify(state))
  return {
    prepare(sql) {
      const statement = sqlite.prepare(sql)
      const query = {
        args: [],
        bind(...args) {
          this.args = args
          return this
        },
        first(column) {
          const row = statement.get(...this.args)
          return column ? row?.[column] : row
        },
        all() {
          return { results: statement.all(...this.args) }
        },
        run() {
          return { meta: statement.run(...this.args) }
        },
      }
      return query
    },
    batch(statements) {
      sqlite.exec('BEGIN')
      try {
        const results = statements.map((s) => s.run())
        sqlite.exec('COMMIT')
        return results
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
    },
  }
}

test('stale helper cannot upload bytes or change a publication, review approves only its draft', async () => {
  const state = {
    draft: { id: 'edit' },
    published: { id: 'live', asset: 'old' },
    job: { id: 'job', kind: 'review', revision: 'edit', token: 'single-job' },
  }
  const db = store(state)
  const first = complete(state, 'ready')
  await commit(db, 0, first, {
    name: 'baked/ready',
    bytes: Buffer.from('ready'),
  })
  await assert.rejects(
    commit(db, 0, complete(state, 'late'), {
      name: 'baked/late',
      bytes: Buffer.from('late'),
    }),
    { status: 409 },
  )
  await assert.rejects(asset(db, 'baked/late'), { status: 404 })
  const saved = await world(db)
  assert.equal(saved.state.published.id, 'live')
  assert.equal(await (await asset(db, 'baked/ready')).text(), 'ready')
  assert.equal(reviewed(saved.state, 'job').asset, 'ready')
  assert.throws(
    () => reviewed({ ...saved.state, draft: { id: 'changed' } }, 'job'),
    { status: 409 },
  )
  assert.equal(saved.state.job.token, undefined)
})

function glb(doc) {
  const text = Buffer.from(JSON.stringify(doc))
  const padded = Math.ceil(text.length / 4) * 4
  const bytes = Buffer.alloc(28 + padded + 4)
  bytes.write('glTF')
  bytes.writeUInt32LE(2, 4)
  bytes.writeUInt32LE(bytes.length, 8)
  bytes.writeUInt32LE(padded, 12)
  bytes.write('JSON', 16)
  bytes.fill(32, 20, 20 + padded)
  text.copy(bytes, 20)
  bytes.writeUInt32LE(4, 20 + padded)
  bytes.writeUInt32LE(0x004e4942, 24 + padded)
  return bytes
}
test('cloud accepts embedded meshopt buffer and rejects external images and wrong identities', () => {
  const doc = {
    asset: { version: '2.0' },
    meshes: [{}],
    buffers: [
      { byteLength: 4 },
      {
        byteLength: 32,
        extensions: { EXT_meshopt_compression: { fallback: true } },
      },
    ],
    nodes: [{ extras: { roomId: 'room' } }],
  }
  const check = (d) => validateResult(glb(d), [{ id: 'room' }], [])
  check(doc)
  assert.throws(() =>
    check({ ...doc, images: [{ uri: 'https://example.com/image' }] }),
  )
  assert.throws(() => check({ ...doc, nodes: [] }))
})

test('review keeps its editable Blender file and drops an abandoned candidate atomically', async () => {
  const id = 'bf18ae71-d251-4f65-a2b7-329007a6cb22'
  const base = {
    draft: { id: 'draft', model: 'initial' },
    published: { id: 'live', model: 'initial', asset: 'old' },
    job: {
      kind: 'review',
      revision: 'draft',
      id: 'job',
      blend: 'blend/current',
    },
  }
  const db = store(base)
  await commit(db, 0, base, {
    name: 'blend/current',
    bytes: Buffer.from('editable'),
  })
  const inspecting = { ...base, incoming: { id } }
  await commit(db, 1, inspecting, {
    name: 'source/' + id,
    bytes: Buffer.from('artist'),
  })
  await assert.rejects(commit(db, 1, base), { status: 409 })
  assert.equal(await (await asset(db, 'source/' + id)).text(), 'artist')
  const ready = complete(base, 'output')
  await commit(db, 2, ready)
  assert.equal(reviewed((await world(db)).state, 'job').blend, 'blend/current')
  assert.equal(await (await asset(db, 'blend/current')).text(), 'editable')
  await assert.rejects(asset(db, 'source/' + id), { status: 404 })
})

test('버전과 초안 변경은 함께 저장되며 보관 중인 Blender 모델을 정리하지 않는다', async () => {
  const model = '08010100-0000-4000-8000-000000000000'
  const draft = { id: 'old', model, layout: { items: ['bench'] } }
  const published = { id: 'live', model: 'initial', layout: {} }
  const db = store({ draft, published })
  for (const type of ['source', 'editor'])
    await commit(
      db,
      (await world(db)).version,
      { draft, published },
      {
        name: type + '/' + model,
        bytes: Buffer.from(type),
      },
    )
  await commit(db, (await world(db)).version, { draft, published }, null, {
    name: 'catalog/' + model,
    value: '{}',
  })
  const start = await world(db)
  const named = await nameVersion(db, start, 'old', '  원래 배치  ')
  assert.equal(named.title, '원래 배치')
  assert.deepEqual(await nameVersion(db, start, 'old', '원래 배치'), named)
  assert.deepEqual(await world(db), start)
  const next = await saveDraft(db, start, 'old', 'new', {}, 'import')
  await assert.rejects(saveDraft(db, start, 'old', 'stale', {}, 'restore'), {
    status: 409,
  })
  await assert.rejects(nameVersion(db, start, 'old', '늦은 저장'), {
    status: 409,
  })
  const records = await listVersions(db)
  assert.deepEqual(records.map((v) => v.kind).sort(), [
    'day',
    'import',
    'named',
  ])
  for (const entry of records)
    assert.deepEqual(await readVersion(db, entry.id), draft)
  for (const type of ['source', 'editor'])
    assert.equal(await (await asset(db, type + '/' + model)).text(), type)
  assert.ok(
    await db
      .prepare('SELECT value FROM settings WHERE name=?')
      .bind('catalog/' + model)
      .first(),
  )
  const restored = await saveDraft(
    db,
    await world(db),
    next.id,
    draft.model,
    draft.layout,
    'restore',
  )
  assert.notEqual(restored.id, draft.id)
  const versions = await listVersions(db)
  assert.deepEqual(
    await readVersion(db, versions.find((r) => r.kind === 'restore').id),
    next,
  )
  assert.equal(versions.filter((r) => r.kind === 'day').length, 1)
  assert.deepEqual((await world(db)).state.published, published)
})

test('하루 시작점은 서울 자정 이후 첫 변경에서만 생성된다', async () => {
  const { changeDraft } = await import('../server/draft-versions.mjs')
  const initial = { draft: { id: 'start', model: 'initial', layout: {} } }
  const edit = (state, iso) =>
    changeDraft(state, state.draft.id, 'initial', {}, undefined, new Date(iso))
  const first = edit(initial, '2026-11-23T14:59:00Z')
  assert.equal(first.records[0].revision, 'start')
  const same = edit(first.next, '2026-11-23T14:59:59Z')
  assert.deepEqual(same.records, [])
  const nextDay = edit(same.next, '2026-11-23T15:00:00Z')
  assert.equal(nextDay.next.editDay, '2026-11-24')
  assert.equal(nextDay.records[0].revision, same.next.draft.id)
})

test('클라우드의 버전 미리보기와 복원은 버전 자체의 모델과 카탈로그를 사용한다', async () => {
  const draft = {
    id: 'before',
    model: 'initial',
    layout: { items: [], pages: [], spots: [] },
  }
  const db = store({ draft, published: draft })
  const token = 'a'.repeat(64)
  db.prepare('INSERT INTO sessions VALUES(?,?)')
    .bind(createHash('sha256').update(token).digest('hex'), Date.now() + 60000)
    .run()
  for (const model of ['initial', 'replacement'])
    db.prepare('INSERT INTO settings VALUES(?,?)')
      .bind(
        'catalog/' + model,
        JSON.stringify({
          rooms: [{ id: model, label: model }],
          items: [],
        }),
      )
      .run()
  const request = (route, body, authorized = true) =>
    onRequest({
      env: { STUDIO: db },
      params: { path: route.split('/') },
      request: new Request('https://studio.test/api/' + route, {
        method: body ? 'POST' : 'GET',
        body: body && JSON.stringify(body),
        headers: authorized ? { Cookie: 'riragi=' + token } : {},
      }),
    })
  const record = await (
    await request('admin/versions', { revision: 'before', name: '원본' })
  ).json()
  const current = await saveDraft(
    db,
    await world(db),
    'before',
    'replacement',
    draft.layout,
    'import',
  )
  const route = 'admin/versions/' + record.id
  const preview = await (await request(route)).json()
  assert.equal(preview.rooms[0].id, 'initial')
  assert.equal(
    (await request(preview.asset.slice(5), undefined, false)).status,
    401,
  )
  db.prepare('INSERT INTO files VALUES(?,?,?)')
    .bind('editor/initial', 0, Buffer.from('model').toString('base64'))
    .run()
  assert.equal(await (await request(preview.asset.slice(5))).text(), 'model')
  assert.equal(
    (await request(route + '/restore', { revision: 'before' })).status,
    409,
  )
  const result = await request(route + '/restore', { revision: current.id })
  assert.equal(result.status, 200)
  assert.deepEqual((await result.json()).rooms, preview.rooms)
  assert.equal((await world(db)).state.published.id, 'before')
})

test('운영 자료실에서 별도 모델과 동작을 등록하고 공개 승인된 파일만 방문자가 읽는다', async () => {
  const draft = {
    id: 'draft',
    model: 'initial',
    layout: { items: [], spots: [], pages: [] },
  }
  const db = store({ draft, published: { ...draft, id: 'live' } })
  db.prepare('INSERT INTO settings VALUES(?,?)')
    .bind('catalog/initial', JSON.stringify({ rooms: [], items: [] }))
    .run()
  const token = 'c'.repeat(64)
  db.prepare('INSERT INTO sessions VALUES(?,?)')
    .bind(createHash('sha256').update(token).digest('hex'), Date.now() + 60000)
    .run()
  const request = (route, method = 'GET', body, auth = true) =>
    onRequest({
      env: { STUDIO: db },
      params: { path: route.split('/') },
      request: new Request('https://studio.test/api/' + route, {
        method,
        headers: {
          ...(auth && { cookie: 'riragi=' + token }),
          'Content-Type': Buffer.isBuffer(body)
            ? 'application/octet-stream'
            : 'application/json',
        },
        body,
      }),
    })
  const model = Buffer.from(await riggedGiraffe()), walk = Buffer.from(await giraffeMotion('Walk'))
  const models = 'admin/characters/models',
    motions = 'admin/characters/motions'
  assert.equal((await request(models, 'POST', model, false)).status, 401)
  assert.equal((await request(models, 'POST', walk)).status, 422)
  const upload = await request(models, 'POST', model)
  assert.equal(upload.status, 200)
  const { id, library } = await upload.json()
  assert.equal(library.models[0].joints, 3)
  const clip = (
    await (await request(motions, 'POST', walk)).json()
  ).motions.find((m) => !m.model)
  assert.ok(clip.matched[id] > 0)
  const ref = {
    id: 'giraffe',
    model: id,
    motion: clip.id + '/' + clip.clips[0].name,
  }
  const { state, version } = await world(db)
  state.draft.layout.characters = [ref]
  await commit(db, version, state)
  assert.equal((await request(models + '/' + id, 'DELETE')).status, 409)
  assert.equal((await request(motions + '/' + clip.id, 'DELETE')).status, 409)
  const publicFile = 'world/characters/' + clip.id + '.glb'
  assert.equal((await request(publicFile, 'GET', undefined, false)).status, 404)
  const review = await request(
    'admin/reviews',
    'POST',
    JSON.stringify({ revision: draft.id }),
  )
  assert.equal(review.status, 202)
  const saved = await world(db)
  const ready = complete(saved.state, 'asset')
  const snap = reviewed(ready, ready.job.id)
  assert.deepEqual(new Set(snap.cast.files), new Set([id, clip.id]))
  await commit(db, saved.version, ready)
  assert.equal(
    (await request('admin/reviews/' + ready.job.id + '/publish', 'POST'))
      .status,
    200,
  )
  assert.deepEqual(
    Buffer.from(
      await (await request(publicFile, 'GET', undefined, false)).arrayBuffer(),
    ),
    walk,
  )
  assert.equal(
    (await (await request('world', 'GET', undefined, false)).json()).characters
      .base,
    '/api/world/characters/',
  )
})

test('퇴역한 원격 자료는 이전 배치가 참조할 때만 자료 목록에 복구한다', async () => {
  const db = store({draft: {}, published: {}})
  const active = {models:[{id:'biped'}], motions:[{id:'walk'}], fallback:'biped'}
  const archive = {models:[{id:'riragi'}], motions:[{id:'riragi'},{id:'old-walk'}]}
  for (const [key,value] of [['characters',active],['character-archive',archive]]) {
    db.prepare('INSERT INTO settings VALUES(?,?)').bind(key,JSON.stringify(value)).run()
  }
  assert.deepEqual(await characterListing(db),active)
  const restored=await characterListing(db,{characters:[{model:'riragi'}],defaults:{character:{motion:'riragi/LookAround'}}})
  assert.deepEqual(restored.models.map(m=>m.id),['biped','riragi'])
  assert.deepEqual(restored.motions.map(m=>m.id),['walk','riragi'])
})
