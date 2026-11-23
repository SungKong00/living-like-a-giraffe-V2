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
} from '../web/clay-field.js'
import { riggedGiraffe, giraffeMotion } from './giraffe-fixture.mjs'

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

test('월드 점토와 개체 덮어쓰기, 기린을 저장한다', () => {
  const medium = clayPresets.medium
  const data = validate(
    draft({
      defaults: {
        clay: medium,
        giraffe: { motion: '0123456789abcdef/Walk', speed: 1.2 },
      },
      overrides: { clay: { bench: CLAY_ORIGINAL, tall: clayPresets.strong } },
      giraffes: [{ ...giraffe, motion: null }],
    }),
    catalog,
  )
  assert.deepEqual(data.defaults.clay, medium)
  assert.equal(data.giraffes[0].motion, null)
  assert.deepEqual(clayFor(data, 'bench'), CLAY_ORIGINAL)
  assert.deepEqual(clayFor(data, 'tall'), clayPresets.strong)
  assert.deepEqual(clayFor(data, 'other'), medium)
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
