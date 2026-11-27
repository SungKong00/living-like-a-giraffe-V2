import { claySurfaceSettings } from '../shared/clay-motion.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { validate } from '../server/layout.mjs'
import { characterLibrary } from '../server/characters.mjs'
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
const character = {
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

test('월드·오브젝트·캐릭터 점토 기본값과 개체 덮어쓰기를 저장한다', () => {
  const medium = clayPresets.medium
  const data = validate(
    draft({
      defaults: {
        clay: { world: clayPresets.strong, objects: medium },
        character: { motion: '0123456789abcdef/Walk', speed: 1.2 },
      },
      overrides: {
        clay: {
          bench: CLAY_ORIGINAL,
          tall: clayPresets.strong,
          sauna: clayPresets.light,
        },
      },
      characters: [{ ...character, model: 'riragi', motion: null }],
    }),
    catalog,
  )
  assert.deepEqual(data.defaults.clay.objects, medium)
  assert.equal(data.characters[0].motion, null)
  assert.equal(data.characters[0].model, 'riragi')
  // An override wins; otherwise the object's own kind decides.
  assert.deepEqual(clayFor(data, 'bench', 'objects'), CLAY_ORIGINAL)
  assert.deepEqual(clayFor(data, 'tall', 'characters'), clayPresets.strong)
  assert.deepEqual(clayFor(data, 'sauna', 'world'), clayPresets.light)
  assert.deepEqual(clayFor(data, 'sports', 'world'), clayPresets.strong)
  assert.deepEqual(clayFor(data, 'other', 'objects'), medium)
  assert.deepEqual(clayFor(data, 'other', 'characters'), CLAY_ORIGINAL)
  // A draft saved with one value for everything applies it to every kind.
  const old = validate(draft({ defaults: { clay: medium } }), catalog)
  for (const scope of ['world', 'objects', 'characters'])
    assert.deepEqual(clayFor(old, 'x', scope), medium)
  // Drafts saved while characters were called giraffes.
  const named = validate(
    draft({
      defaults: {
        clay: { giraffes: clayPresets.light },
        giraffe: { speed: 2 },
      },
      giraffes: [character],
    }),
    catalog,
  )
  assert.equal(named.characters[0].id, 'tall')
  assert.equal(named.defaults.character.speed, 2)
  assert.deepEqual(clayFor(named, 'tall', 'characters'), clayPresets.light)
  assert.equal('giraffes' in named, false)
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
    { characters: [{ ...character, room: 'nowhere' }] },
    { characters: [{ ...character, id: 'bench' }] },
    { characters: [{ ...character, motion: 'walk' }] },
    { characters: [{ ...character, speed: 9 }] },
    { characters: [{ ...character, model: '../library' }] },
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

test('캐릭터 자료실은 여러 리깅 모델과 맞는 동작만 받는다', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'characters-'))
  const library = characterLibrary(dir, { builtin: path.join(dir, 'none.glb') })
  await assert.rejects(
    library.addModel(await giraffeMotion('Walk'), '뼈대 없음'),
    /리깅된 모델이 아닙니다/,
  )
  const first = await library.addModel(await riggedGiraffe(), '기린.glb')
  const model = first.library.models[0]
  assert.equal(model.id, first.id)
  assert.equal(model.joints, 3)
  assert.equal(first.library.fallback, model.id)
  // Actions exported with the model are listed as its first motion file.
  assert.equal(first.library.motions[0].id, model.id)
  assert.equal(first.library.motions[0].clips[0].name, 'Idle')
  // A second skeleton with other joint names is a model of its own.
  const other = await library.addModel(
    await riggedGiraffe({ names: ['A', 'B', 'C'] }),
    '다른 캐릭터',
  )
  assert.equal(other.library.models.length, 2)
  const added = await library.addMotion(await giraffeMotion('Walk'), '걷기')
  const walk = added.motions.find((m) => m.name === '걷기')
  assert.equal(walk.clips[0].name, 'Walk')
  assert.equal(walk.matched[model.id], 1)
  assert.equal(walk.matched[other.id], 0)
  assert.ok(walk.clips[0].duration > 0.9)
  await assert.rejects(
    library.addMotion(
      await giraffeMotion('Wrong', { names: ['X', 'Y', 'Z'] }),
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
  const removed = await library.removeMotion(walk.id)
  assert.deepEqual(
    removed.motions.map((m) => m.name),
    ['다른 캐릭터', '기린.glb'],
  )
  // Removing a model takes its embedded actions along.
  const left = await library.removeModel(model.id)
  assert.deepEqual(
    left.models.map((m) => m.name),
    ['다른 캐릭터'],
  )
  assert.equal(left.fallback, other.id)
  await assert.rejects(library.removeModel('riragi'), /지울 수 없습니다/)
})

test('모델은 파일을 바꿔도 ID를 지키고 쓰는 중이면 지울 수 없다', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'characters-'))
  const layouts = []
  const library = characterLibrary(dir, {
    builtin: path.join(dir, 'none.glb'),
    layouts: () => layouts,
  })
  const added = await library.addModel(await riggedGiraffe(), '기린')
  const { id } = added
  const first = added.library.models[0]
  assert.equal(first.file, id)
  assert.equal(first.measured, 4.5)
  assert.equal(first.height, 4.5)
  // Name and the height a character at 100% shows.
  let view = await library.updateModel(id, { name: '키 큰 기린', height: 2.4 })
  assert.equal(view.models[0].name, '키 큰 기린')
  assert.equal(view.models[0].height, 2.4)
  await assert.rejects(library.updateModel(id, { height: 0 }), /기본 키/)
  await assert.rejects(library.updateModel(id, { name: ' ' }), /이름/)
  // A new file keeps the ID, name and height; the embedded action moves.
  const replaced = await library.replaceModel(
    id,
    await riggedGiraffe({ top: 3, clip: 'Idle' }),
  )
  const model = replaced.library.models[0]
  assert.equal(replaced.id, id)
  assert.notEqual(model.file, id)
  assert.equal(model.name, '키 큰 기린')
  assert.equal(model.height, 2.4)
  assert.equal(model.measured, 3)
  assert.deepEqual(replaced.motion, { from: id, to: model.file })
  assert.deepEqual(
    replaced.library.motions.map((m) => [m.id, m.model]),
    [[model.file, id]],
  )
  assert.ok(library.file(model.file))
  await assert.rejects(
    library.replaceModel('riragi', Buffer.from('')),
    /교체할 수 없습니다/,
  )
  // In use by a draft character or the world default motion: kept.
  layouts.push({ characters: [{ id: 'a', model: id }] })
  await assert.rejects(library.removeModel(id), /1곳에서 쓰는 모델/)
  const walk = await library.addMotion(await giraffeMotion('Walk'), '걷기')
  const walkId = walk.motions.find((m) => m.name === '걷기').id
  layouts[0] = {
    characters: [],
    defaults: { character: { motion: walkId + '/Walk' } },
  }
  await assert.rejects(library.removeMotion(walkId), /쓰는 동작/)
  // Unused: removed from the list, and uploading the file brings it back.
  layouts.length = 0
  view = await library.removeModel(id)
  assert.equal(view.models.length, 0)
  const back = await library.addModel(
    await riggedGiraffe({ top: 3 }),
    '돌아온 기린',
  )
  assert.equal(back.library.models[0].measured, 3)
})

test('교체한 모델의 동작은 같은 클립으로 옮기고 캐릭터마다 시작 시점이 다르다', async () => {
  const { moveMotionFile, motionPhase } = await import('../web/edit-ops.js')
  const layout = {
    defaults: { character: { motion: 'aaaa/Idle' } },
    characters: [
      { id: 'a', motion: 'aaaa/Idle' },
      { id: 'b', motion: 'aaaa/Gone' },
      { id: 'c', motion: 'bbbb/Idle' },
      { id: 'd', motion: ['bbbb/Idle', 'aaaa/Idle'] },
    ],
  }
  assert.equal(moveMotionFile(layout, 'aaaa', 'cccc', ['Idle']), 3)
  assert.equal(layout.defaults.character.motion, 'cccc/Idle')
  assert.deepEqual(
    layout.characters.map((c) => c.motion),
    ['cccc/Idle', 'aaaa/Gone', 'bbbb/Idle', ['bbbb/Idle', 'cccc/Idle']],
  )
  assert.equal(motionPhase('a'), motionPhase('a'))
  assert.notEqual(motionPhase('a'), motionPhase('b'))
  assert.ok(motionPhase('x') >= 0 && motionPhase('x') < 1)
})

test('모델의 착용물과 점토 보호 정점을 읽고 캐릭터에 착용·동작 목록을 저장한다', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'characters-'))
  const library = characterLibrary(dir, { builtin: path.join(dir, 'none.glb') })
  const plain = await library.addModel(await riggedGiraffe(), '맨몸')
  assert.deepEqual(plain.library.models[0].wearables, [])
  assert.equal(plain.library.models[0].protect, false)
  const dressed = await library.addModel(
    await riggedGiraffe({ wear: true, protect: true, top: 3 }),
    '망토 기린',
  )
  const model = dressed.library.models.find((m) => m.id === dressed.id)
  assert.deepEqual(model.wearables, [
    { id: 'cape', label: '케이프', nodes: ['Wear.Cape'] },
  ])
  assert.equal(model.protect, true)

  const { setWear } = await import('../web/edit-ops.js')
  const input = draft({
    characters: [{ ...character, room: 'sauna', model: dressed.id }],
    defaults: {
      character: {
        motion: [model.id + '/Idle', 'riragi/Look'],
        order: 'random',
      },
    },
  })
  setWear(input, 'tall', 'cape', true)
  setWear(input, 'tall', 'flower', true)
  setWear(input, 'tall', 'flower', false)
  assert.deepEqual(input.characters[0].wear, ['cape'])
  input.characters[0].motion = [model.id + '/Idle']
  const saved = validate(input, catalog)
  assert.deepEqual(saved.characters[0].wear, ['cape'])
  assert.equal(saved.defaults.character.order, 'random')
  assert.equal(saved.defaults.character.motion.length, 2)
  setWear(input, 'tall', 'cape', false)
  assert.equal(input.characters[0].wear, undefined)
  input.characters[0].motion = Array(9).fill('riragi/Look')
  assert.throws(() => validate(input, catalog))
  input.characters[0].motion = []
  assert.throws(() => validate(input, catalog))
})

test('정점 보호 값이 1인 점은 점토로 움직이지 않는다', () => {
  const rest = new Float32Array([0, 1, 0, 0, 3, 0.2, 0.3, 2, 0.1])
  const bounds = { min: [-0.5, 0, -0.5], max: [0.5, 4, 0.5] }
  const field = clayField(bounds, 'x', 'characters', { head: false })
  const free = clayPositions(rest, field, clayPresets.strong)
  const kept = clayPositions(rest, field, clayPresets.strong, null, [1, 0, 0.5])
  assert.deepEqual([...kept.slice(0, 3)], [...rest.slice(0, 3)])
  assert.deepEqual([...kept.slice(3, 6)], [...free.slice(3, 6)])
  for (let k = 6; k < 9; k++)
    assert.ok(Math.abs(kept[k] - (rest[k] + free[k]) / 2) < 1e-6)
})

test('공개본은 처음 조회할 때 쓰는 캐릭터 파일을 고정하고 그 파일만 내준다', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'characters-'))
  const library = characterLibrary(dir, { builtin: path.join(dir, 'none.glb') })
  const { id } = await library.addModel(await riggedGiraffe(), '기린')
  const walk = await library.addMotion(await giraffeMotion('Walk'), '걷기')
  const walkFile = walk.motions.find((m) => m.name === '걷기').id
  const unused = await library.addModel(
    await riggedGiraffe({ names: ['A', 'B', 'C'] }),
    '안 쓰는 모델',
  )
  const layout = {
    characters: [{ ...character, model: id, motion: [walkFile + '/Walk'] }],
  }
  assert.equal(await library.published('snap-0', { characters: [] }), null)
  const fixed = await library.published('snap-1', layout)
  assert.deepEqual(Object.keys(fixed.models), [id])
  assert.equal(fixed.models[id].height, 4.5)
  assert.deepEqual(fixed.files.sort(), [id, walkFile].sort())
  // Library edits wait for the next publication.
  await library.updateModel(id, { height: 2 })
  await library.replaceModel(id, await riggedGiraffe({ top: 3 }))
  const again = await library.published('snap-1', layout)
  assert.equal(again.models[id].height, 4.5)
  assert.equal(again.models[id].file, id)
  const next = await library.published('snap-2', layout)
  assert.equal(next.models[id].height, 2)
  assert.notEqual(next.models[id].file, id)
  assert.equal(library.servesPublished(['snap-1'], id), true)
  assert.equal(library.servesPublished(['snap-1'], unused.id), false)
  assert.equal(library.servesPublished(['../x', null], id), false)
  assert.equal(await library.published('../escape', layout), null)
})

test('캐릭터의 연결 페이지는 지운 페이지를 따라 풀린다', async () => {
  const { deletePage } = await import('../web/edit-ops.js')
  const page = { id: 'p1', title: '행사', summary: '요약', body: '', url: '' }
  const input = draft({
    characters: [{ ...character, room: 'sauna', page: 'p1' }],
  })
  input.pages = [page]
  const saved = validate(structuredClone(input), catalog)
  assert.equal(saved.characters[0].page, 'p1')
  deletePage(input, 'p1')
  assert.equal(input.characters[0].page, undefined)
  // A draft that still points at a removed page loses only the link.
  input.characters[0].page = 'gone'
  assert.equal(validate(input, catalog).characters[0].page, undefined)
})

test('기린이라 부르던 자료실과 하나뿐이던 모델을 그대로 읽는다', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'world-'))
  const legacy = path.join(base, 'giraffes')
  fs.mkdirSync(legacy)
  const model = { id: '0123456789abcdef', name: '옛 기린', joints: ['Root'] }
  fs.writeFileSync(
    path.join(legacy, 'library.json'),
    JSON.stringify({ model, motions: [] }),
  )
  const library = characterLibrary(path.join(base, 'characters'), {
    builtin: path.join(base, 'none.glb'),
  })
  const view = await library.list()
  assert.equal(fs.existsSync(legacy), false)
  assert.deepEqual(
    view.models.map((m) => m.name),
    ['옛 기린'],
  )
  assert.equal(view.fallback, model.id)
})

test('기본 리라지 기린은 자료실의 첫 모델이고 자기 동작을 함께 준다', async (t) => {
  if (
    !fs.existsSync(
      'assets-source/characters/riragi-clay/riragi-giraffe-base.glb',
    )
  )
    return t.skip('기본 기린 원본이 없습니다.')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'characters-'))
  const view = await characterLibrary(dir).list()
  assert.equal(view.models[0].id, 'riragi')
  assert.equal(view.models[0].builtin, true)
  assert.equal(view.fallback, 'riragi')
  assert.equal(view.motions[0].clips[0].name, 'LookAround')
  assert.ok(view.motions[0].matched.riragi > 0)
  if (!fs.existsSync('assets-source/characters/riragi-clay/riragi-biped.glb')) {
    assert.ok(!view.models.some((m) => m.id === 'riragi-biped'))
    return
  }
  const biped = view.models.find((m) => m.id === 'riragi-biped')
  assert.deepEqual(biped.wearables, [])
  const gait = view.motions.find((m) => m.id === biped.id)
  assert.equal(biped.suggestedMotion, gait.id + '/' + gait.clips[0].name)
  assert.ok(gait.clips[0].duration > 1 && gait.matched[biped.id] > 0)
  assert.equal(gait.matched.riragi, 0)
  const { selectCharacterModel } = await import('../web/edit-ops.js')
  const character = {}
  selectCharacterModel({}, character, biped.id, view)
  assert.equal(character.motion, biped.suggestedMotion)
  selectCharacterModel({}, character, 'riragi', view)
  assert.equal(character.motion, null)
  selectCharacterModel({}, character, biped.id, view)
  assert.equal(character.motion, null)
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

test('같은 방의 캐릭터 둘에 서로 다른 비율과 배치를 저장한다', async () => {
  const { addCharacter, duplicateCharacter } =
    await import('../web/edit-ops.js')
  const input = draft({})
  const first = addCharacter(input, {
    id: 'one',
    room: 'sauna',
    model: 'riragi',
    name: '리라지 점토 기린',
  })
  const second = addCharacter(input, { id: 'two', room: 'sauna' })
  assert.equal(first.label, '리라지 점토 기린 1')
  assert.equal(second.label, '캐릭터 1')
  assert.equal(second.model, undefined)
  first.proportions = {
    neck: 1.4,
    head: 0.8,
    legs: 1.1,
    body: 0.85,
    ears: 1.3,
    muzzle: 0.8,
  }
  assert.notDeepEqual(first.position, second.position)
  const copy = duplicateCharacter(input, 'one', 'three')
  assert.equal(copy.label, '리라지 점토 기린 2')
  assert.equal(copy.model, 'riragi')
  assert.ok(
    [first, second].every(
      (c) =>
        Math.hypot(
          c.position[0] - copy.position[0],
          c.position[2] - copy.position[2],
        ) >= 1.5,
    ),
  )
  input.characters.pop()
  const saved = validate(input, catalog).characters
  assert.deepEqual(saved[0].proportions, first.proportions)
  assert.equal(saved[1].proportions, undefined)
  first.proportions.neck = 1.5
  assert.throws(() => validate(input, catalog))
})
