import { claySurfaceSettings } from '../shared/clay-motion.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { validate } from '../server/layout.mjs'
import { giraffeLibrary } from '../server/giraffes.mjs'
import {
  clayField,
  clayFor,
  clayPositions,
  clayPresetOf,
  clayPresets,
  CLAY_ORIGINAL,
  surfaceField,
} from '../web/clay-field.js'
import { riggedGiraffe, giraffeMotion } from './giraffe-fixture.mjs'
import { tessellate } from '../web/clay-tessellate.js'

const catalog = {
  rooms: [{ id: 'sauna' }, { id: 'sports' }],
  items: [{ id: 'bench', kind: 'tier-bench' }],
}
const bench = {
  id: 'bench',
  room: 'sauna',
  kind: 'tier-bench',
  label: '나무 벤치',
  position: [0, 0, 0],
  rotation: [0, 0, 0, 1],
  scale: [1, 1, 1],
  color: 'original',
  finish: 'original',
}
const giraffe = {
  id: 'tall',
  room: 'sports',
  label: '기린 1',
  position: [1, 0, 2],
  yaw: 30,
  scale: 1,
}
const draft = (extra) => ({ items: [bench], spots: [], pages: [], ...extra })

test('꿈틀거림은 강도와 재생 여부를 독립적으로 저장하고 이전 초안도 읽는다', () => {
  assert.equal(validate(draft({}), catalog).defaults?.clayMotion, undefined)
  for (const enabled of [true, false])
    for (const strength of [0, 45, 100]) {
      const motion = { enabled, strength }
      const result = validate(
        draft({ defaults: { clayMotion: motion } }),
        catalog,
      )
      assert.deepEqual(result.defaults.clayMotion, motion)
    }
  for (const strength of [-1, 101])
    assert.throws(() =>
      validate(
        draft({ defaults: { clayMotion: { enabled: true, strength } } }),
        catalog,
      ),
    )
})

test('기존 빗금은 정적 질감으로 열리고 새 움직임은 빗금과 따로 저장된다', () => {
  const legacy = claySurfaceSettings({ enabled: true, strength: 72 })
  assert.deepEqual(legacy, {
    enabled: false,
    strength: 72,
    hatch: 72,
    style: 'surface',
  })
  assert.equal(claySurfaceSettings({ enabled: false, strength: 72 }).hatch, 0)
  for (const style of ['surface', 'screen']) {
    const settings = { ...legacy, style, enabled: true, strength: 32 }
    const saved = validate(
      draft({ defaults: { clayMotion: settings } }),
      catalog,
    )
    assert.deepEqual(claySurfaceSettings(saved.defaults.clayMotion), settings)
  }
})

test('월드·오브젝트·기린 점토 기본값과 개체 덮어쓰기를 저장한다', () => {
  const medium = clayPresets.medium
  const data = validate(
    draft({
      defaults: {
        clay: { world: clayPresets.strong, objects: medium },
        giraffe: { motion: '0123456789abcdef/Walk', speed: 1.2 },
      },
      overrides: {
        clay: {
          bench: CLAY_ORIGINAL,
          tall: clayPresets.strong,
          sauna: clayPresets.light,
        },
      },
      giraffes: [{ ...giraffe, motion: null }],
    }),
    catalog,
  )
  assert.deepEqual(data.defaults.clay.objects, medium)
  assert.equal(data.giraffes[0].motion, null)
  // An override wins; otherwise the object's own kind decides.
  assert.deepEqual(clayFor(data, 'bench', 'objects'), CLAY_ORIGINAL)
  assert.deepEqual(clayFor(data, 'tall', 'giraffes'), clayPresets.strong)
  assert.deepEqual(clayFor(data, 'sauna', 'world'), clayPresets.light)
  assert.deepEqual(clayFor(data, 'sports', 'world'), clayPresets.strong)
  assert.deepEqual(clayFor(data, 'other', 'objects'), medium)
  assert.deepEqual(clayFor(data, 'other', 'giraffes'), CLAY_ORIGINAL)
  // A draft saved with one value for everything applies it to every kind.
  const old = validate(draft({ defaults: { clay: medium } }), catalog)
  for (const scope of ['world', 'objects', 'giraffes'])
    assert.deepEqual(clayFor(old, 'x', scope), medium)
  assert.equal(clayPresetOf(medium), 'medium')
  assert.equal(clayPresetOf({ ...medium, width: 51 }), 'custom')
})

test('사라진 개체의 덮어쓰기는 남기지 않고 잘못된 값은 거부한다', () => {
  const data = validate(
    draft({ overrides: { clay: { gone: clayPresets.light } } }),
    catalog,
  )
  assert.equal(data.overrides, undefined)
  for (const bad of [
    { defaults: { clay: { strength: 120, depth: 0, width: 50 } } },
    { giraffes: [{ ...giraffe, room: 'nowhere' }] },
    { giraffes: [{ ...giraffe, id: 'bench' }] },
    { giraffes: [{ ...giraffe, motion: 'walk' }] },
    { giraffes: [{ ...giraffe, speed: 9 }] },
  ])
    assert.throws(() => validate(draft(bad), catalog))
})

test('점토 변형은 결정적이고 원본 설정은 모양을 바꾸지 않는다', () => {
  const bounds = { min: [-1, 0, -0.3], max: [1, 0.5, 0.3] }
  const rest = new Float32Array([0.2, 0.5, 0.1, -0.8, 0.1, 0, 0.5, 0, 0.2])
  const a = clayPositions(rest, clayField(bounds, 'bench'), clayPresets.strong)
  const b = clayPositions(rest, clayField(bounds, 'bench'), clayPresets.strong)
  const c = clayPositions(rest, clayField(bounds, 'other'), clayPresets.strong)
  assert.deepEqual(a, b)
  assert.notDeepEqual(a, c)
  assert.notDeepEqual(a, rest)
  // The base stays on the floor.
  assert.equal(a[7], 0)
  assert.deepEqual(
    clayPositions(rest, clayField(bounds, 'bench'), CLAY_ORIGINAL),
    rest,
  )
})

test('방 표면 점토는 바닥을 평평하게 두고 벽은 면을 따라 누른다', () => {
  const field = surfaceField('sauna')
  // Floor vertices (height 0, facing up) and wall vertices (facing +x).
  const floor = new Float32Array([0.3, 0, 0.7, 1.1, 0, -2.4, -3.2, 0, 5.5])
  const up = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0])
  const wall = new Float32Array([4, 1.2, 0.3, 4, 2.1, -1.7, 4, 0.9, 2.6])
  const side = new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0])
  const strong = clayPresets.strong
  assert.deepEqual(clayPositions(floor, field, strong, up), floor)
  const moved = clayPositions(wall, field, strong, side)
  assert.notDeepEqual(moved, wall)
  for (let i = 0; i < moved.length; i++)
    assert.ok(Math.abs(moved[i] - wall[i]) < 0.2)
  assert.deepEqual(clayPositions(wall, field, CLAY_ORIGINAL, side), wall)
})

test('기린 자료실은 리깅 모델과 맞는 동작만 받는다', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'giraffes-'))
  const library = giraffeLibrary(dir)
  await assert.rejects(
    library.setModel(await giraffeMotion('Walk'), '뼈대 없음'),
    /리깅된 모델이 아닙니다/,
  )
  const model = await library.setModel(await riggedGiraffe(), '기린.glb')
  assert.equal(model.model.joints, 3)
  // Actions exported with the model are listed as its first motion file.
  assert.equal(model.motions[0].id, model.model.id)
  assert.equal(model.motions[0].clips[0].name, 'Idle')
  const added = await library.addMotion(await giraffeMotion('Walk'), '걷기')
  const walk = added.motions.find((m) => m.name === '걷기')
  assert.equal(walk.clips[0].name, 'Walk')
  assert.equal(walk.matched, 1)
  assert.ok(walk.clips[0].duration > 0.9)
  await assert.rejects(
    library.addMotion(
      await giraffeMotion('Wrong', { names: ['A', 'B', 'C'] }),
      '다른 뼈대',
    ),
    /관절 이름과 맞는 동작이 없습니다/,
  )
  await assert.rejects(
    library.addMotion(Buffer.from('not a glb')),
    /GLB 파일을 읽을 수 없습니다/,
  )
  assert.ok(fs.existsSync(library.file(walk.id)))
  assert.equal(library.file('../library'), null)
  assert.deepEqual(
    library.removeMotion(walk.id).motions.map((m) => m.name),
    ['기린.glb'],
  )
})

test('긴 모서리만 나누고 공유 모서리는 같은 점에서 나눠 틈이 없다', () => {
  // Two triangles sharing the 4m diagonal of a 4×1m wall panel.
  const position = new Float32Array([0, 0, 0, 4, 0, 0, 4, 1, 0, 0, 1, 0])
  const uv = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1])
  const result = tessellate(
    {
      attributes: {
        position: { data: position, stride: 3 },
        uv: { data: uv, stride: 2 },
      },
      indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
      groups: [
        { start: 0, count: 3 },
        { start: 3, count: 3 },
      ],
    },
    { maxEdge: 0.6 },
  )
  const p = result.attributes.position
  const edge = (a, b) =>
    Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1])
  const tris = result.indices
  for (let t = 0; t < tris.length; t += 3)
    for (let e = 0; e < 3; e++)
      assert.ok(edge(tris[t + e], tris[t + ((e + 1) % 3)]) <= 0.6 + 1e-6)
  // Each sub-mesh keeps its own range, and texture coordinates follow.
  assert.equal(result.groups.length, 2)
  assert.equal(result.groups[1].start, result.groups[0].count)
  for (let v = 0; v < result.vertices; v++)
    assert.ok(Math.abs(result.attributes.uv[v * 2] - p[v * 3] / 4) < 1e-6)
  // No two vertices sit at the same place: shared edges split once.
  const seen = new Set()
  for (let v = 0; v < result.vertices; v++) {
    const key = p[v * 3].toFixed(4) + ',' + p[v * 3 + 1].toFixed(4)
    assert.ok(!seen.has(key), 'crack at ' + key)
    seen.add(key)
  }
})

test('같은 방의 기린 둘에 서로 다른 비율과 배치를 저장한다', async () => {
  const { addGiraffe } = await import('../web/edit-ops.js')
  const input = draft({})
  const first = addGiraffe(input, { id: 'one', room: 'sauna' })
  const second = addGiraffe(input, { id: 'two', room: 'sauna' })
  first.proportions = { neck: 1.4, head: 0.8, legs: 1.1, body: 0.85 }
  assert.notDeepEqual(first.position, second.position)
  const saved = validate(input, catalog).giraffes
  assert.deepEqual(saved[0].proportions, first.proportions)
  assert.equal(saved[1].proportions, undefined)
  first.proportions.neck = 1.5
  assert.throws(() => validate(input, catalog))
})
