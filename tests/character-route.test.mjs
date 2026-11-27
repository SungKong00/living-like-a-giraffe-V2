import test from 'node:test'
import assert from 'node:assert/strict'
import { validate } from '../server/layout.mjs'
import { characterSheet } from '../shared/character-sheet.mjs'
import {
  characterClips,
  retargetRoute,
  routeAt,
  routeTimeline,
  strideFromSamples,
  turnBetween,
} from '../shared/character-route.mjs'
import * as ops from '../web/edit-ops.js'
import { characterLibrary } from '../server/characters.mjs'
import { riggedGiraffe } from './giraffe-fixture.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const catalog = { rooms: [{ id: 'sports' }], items: [] }
const WALK = 'riragi-biped/두 발 걷기'
const WAVE = 'aaaaaaaaaaaaaaaa/손 흔들기'
const LOOK = 'bbbbbbbbbbbbbbbb/두리번'
const character = (route) => ({
  id: 'tall',
  room: 'sports',
  label: '기린 1',
  position: [1, 0, 2],
  yaw: 0,
  scale: 1,
  ...(route ? { route } : {}),
})
const draft = (c) => ({ items: [], spots: [], pages: [], characters: [c] })
const square = (extra = {}) => ({
  points: [{ at: [0, 0] }, { at: [4, 0] }, { at: [4, 4] }],
  walk: WALK,
  speed: 1,
  ...extra,
})
const durations = { [WAVE]: 2, [LOOK]: 3, [WALK]: 1.1 }
const timeline = (route, options) =>
  routeTimeline(route, { duration: (clip) => durations[clip], ...options })
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) <= e, a + ' ≠ ' + b)

test('경로는 지점 2~12개와 지점별 할 일을 저장하고 첫 지점은 캐릭터 자리다', () => {
  const route = {
    points: [
      { at: [9, 9] },
      { at: [3, 2], stop: { motion: WAVE, repeat: 2, wait: 0 } },
      { at: [3, 5], stop: { face: 90, motion: [WAVE, LOOK], wait: 3 } },
    ],
    mode: 'pingpong',
    speed: 1.2,
    walk: WALK,
    idle: null,
  }
  const saved = validate(draft(character(route)), catalog).characters[0]
  assert.deepEqual(saved.route.points[0].at, [0, 0])
  assert.deepEqual(saved.route.points.slice(1), route.points.slice(1))
  assert.equal(saved.route.mode, 'pingpong')
  // A draft without a route reads as before.
  assert.equal(
    validate(draft(character()), catalog).characters[0].route,
    undefined,
  )
  const bad = [
    { ...route, points: route.points.slice(0, 1) },
    { ...route, points: Array.from({ length: 13 }, () => ({ at: [0, 0] })) },
    { ...route, points: [{ at: [0, 0] }, { at: [1, 0], stop: { repeat: 6 } }] },
    { ...route, points: [{ at: [0, 0] }, { at: [1, 0], stop: { wait: 61 } }] },
    { ...route, speed: 5 },
    { ...route, walk: undefined },
    { ...route, mode: 'once' },
  ]
  for (const r of bad)
    assert.throws(() => validate(draft(character(r)), catalog))
})

test('경로가 쓰는 동작 파일도 공개 목록과 사용 중 판정에 든다', () => {
  const route = square({
    idle: LOOK,
    points: [{ at: [0, 0] }, { at: [4, 0], stop: { motion: WAVE } }],
  })
  const c = character(route)
  assert.deepEqual(characterClips(c), [WALK, LOOK, WAVE])
  const library = {
    fallback: 'riragi-biped',
    models: [{ id: 'riragi-biped', file: 'riragi-biped', height: 2 }],
    motions: [
      { id: 'riragi-biped' },
      { id: 'aaaaaaaaaaaaaaaa' },
      { id: 'bbbbbbbbbbbbbbbb' },
    ],
  }
  assert.deepEqual(characterSheet(draft(c), library).files.sort(), [
    'aaaaaaaaaaaaaaaa',
    'bbbbbbbbbbbbbbbb',
    'riragi-biped',
  ])
  // A replaced model file takes the route's clips of the same name along.
  const layout = draft(c)
  assert.equal(
    ops.moveMotionFile(layout, 'aaaaaaaaaaaaaaaa', 'cccccccccccccccc', [
      '손 흔들기',
    ]),
    1,
  )
  assert.equal(
    layout.characters[0].route.points[1].stop.motion,
    'cccccccccccccccc/손 흔들기',
  )
  assert.equal(retargetRoute(route, 'zzzz', 'yyyy'), route)
})

test('지나가기 지점은 멈추지 않고 모서리를 둥글게 돈다', () => {
  const t = timeline(square(), { radius: 0.5 })
  assert.ok(t.segments.every((s) => s.kind === 'line' || s.kind === 'arc'))
  assert.equal(t.segments.filter((s) => s.kind === 'arc').length, 3)
  // The whole lap is walked at the route's speed with no jump in place.
  let previous = routeAt(t, 0)
  for (let i = 1; i <= 2000; i++) {
    const now = routeAt(t, (t.duration * i) / 2000)
    const step = Math.hypot(now.x - previous.x, now.z - previous.z)
    near(step, t.duration / 2000, 1e-3)
    assert.ok(Math.abs(turnBetween(previous.yaw, now.yaw)) < 2)
    previous = now
  }
  // The rounded corner cuts inside the point instead of touching it.
  const corner = t.segments.find((s) => s.kind === 'arc' && s.by === -90)
  const mid = routeAt(t, corner.start + corner.duration / 2)
  assert.ok(Math.hypot(mid.x - 4, mid.z - 0) > 0.05)
  // On the first leg the character faces +X: yaw 90 with a +Z-facing model.
  const leg = t.segments.find((s) => s.kind === 'line')
  near(routeAt(t, leg.start + 0.1).yaw, 90)
  near(
    timeline(square(), { forward: 180 }).segments.find((s) => s.kind === 'line')
      .yaw,
    270,
  )
})

test('멈추기 지점은 도착·방향·동작·대기·출발 순서를 지킨다', () => {
  const route = square({
    points: [
      { at: [0, 0] },
      { at: [4, 0], stop: { face: 0, motion: WAVE, repeat: 2, wait: 0 } },
      { at: [4, 4], stop: { wait: 3 } },
    ],
  })
  const t = timeline(route)
  const kinds = t.segments.map((s) => s.kind)
  assert.deepEqual(kinds, [
    'arc', // point 1 is passed where the lap closes
    'line',
    'turn', // face 0°
    'act',
    'act',
    'line', // facing 0° is already the way to point 3
    'turn', // toward the way home
    'wait',
    'line',
  ])
  const [, , face, wave, again, , , wait] = t.segments
  near(face.duration, 0.5) // 90° at 180°/s
  near(wave.duration, 2)
  near(again.duration, 2)
  near(wait.duration, 3)
  // Standing at the stop the whole time, facing the chosen way.
  const during = routeAt(t, wave.start + 1)
  assert.deepEqual([during.x, during.z, during.yaw], [4, 0, 0])
  assert.deepEqual(during.layers, [
    { clip: WAVE, time: 1, weight: 1, loop: false },
  ])
  // The second play starts again without a fade; the wait fades to rest.
  assert.equal(routeAt(t, again.start + 0.01).layers.length, 1)
  const resting = routeAt(t, wait.start + 0.15)
  assert.equal(resting.layers.length, 2)
  assert.equal(resting.layers[0].clip, WALK)
  assert.equal(resting.layers[1].clip, null)
  near(resting.layers[0].weight + resting.layers[1].weight, 1)
  assert.deepEqual(routeAt(t, wait.start + 1).layers, [
    { clip: null, time: 1, weight: 1, loop: true },
  ])
  // A motion that cannot be read is skipped instead of freezing the walk.
  const missing = routeTimeline(route, { duration: () => 0 })
  assert.ok(!missing.segments.some((s) => s.kind === 'act'))
})

test('왕복은 양 끝에서 제자리로 돌아서고 안쪽 지점을 다시 지난다', () => {
  const route = {
    points: [
      { at: [0, 0] },
      { at: [3, 0], stop: { motion: WAVE } },
      { at: [6, 0] },
    ],
    mode: 'pingpong',
    walk: WALK,
    speed: 1,
  }
  const t = timeline(route)
  assert.deepEqual(
    t.segments.map((s) => s.kind),
    ['turn', 'line', 'act', 'line', 'turn', 'line', 'act', 'line'],
  )
  for (const turn of t.segments.filter((s) => s.kind === 'turn'))
    near(Math.abs(turn.by), 180)
  // The stop waves on the way out and again on the way home.
  near(routeAt(t, t.segments[2].start + 1).yaw, 90)
  near(turnBetween(routeAt(t, t.segments[6].start + 1).yaw, 270), 0)
  const far = t.segments[4]
  const there = routeAt(t, far.start + far.duration / 2)
  assert.deepEqual([there.x, there.z], [6, 0])
})

test('걷기 시계는 바퀴가 바뀌어도 이어지고 돌 때는 절반 빠르기로 흐른다', () => {
  const t = timeline(square(), { radius: 0.5 })
  const end = routeAt(t, t.duration - 1e-4).layers.at(-1).time
  const next = routeAt(t, t.duration + 1e-4).layers.at(-1).time
  near(next - end, 2e-4, 1e-6)
  near(t.walk, t.duration)
  const back = timeline({
    points: [{ at: [0, 0] }, { at: [2, 0] }],
    mode: 'pingpong',
    walk: WALK,
    speed: 1,
  })
  near(back.duration, 2 + 2 + 1 + 1)
  near(back.walk, 2 + 2 + 0.5 + 0.5)
  // A route whose points all coincide has nowhere to go.
  const still = timeline({
    points: [{ at: [1, 1] }, { at: [1, 1] }],
    walk: WALK,
  })
  assert.equal(still.duration, 0)
  assert.deepEqual(routeAt(still, 5).layers, [])
})

test('걸음 길이는 땅에 닿은 발이 뒤로 밀리는 빠르기로 잰다', () => {
  // Two feet take turns: each slides back 0.4 while it is the lower one.
  const samples = Array.from({ length: 20 }, (_, i) => {
    const phase = i / 20
    const foot = (offset) => {
      const p = (phase + offset) % 1
      return p < 0.5
        ? [0, 0, 0.2 - (p / 0.5) * 0.4]
        : [
            0,
            0.1 + Math.sin(((p - 0.5) / 0.5) * Math.PI) * 0.1,
            -0.2 + ((p - 0.5) / 0.5) * 0.4,
          ]
    }
    return [foot(0), foot(0.5), [0, 1, 0]]
  })
  near(strideFromSamples(samples), 0.8, 1e-6)
  assert.equal(strideFromSamples([]), 0)
  // A joint resting on the floor is not mistaken for the foot.
  near(
    strideFromSamples(samples.map((joints) => [...joints, [0, -1, 0]])),
    0.8,
    1e-6,
  )
})

test('경로 편집 연산은 첫 지점을 옮기면 캐릭터를 옮기고 나머지는 제자리에 둔다', () => {
  const layout = draft(character())
  const c = layout.characters[0]
  ops.setRoute(layout, c.id, {
    ...square(),
    points: [{ at: [9, 9] }, { at: [4, 0] }, { at: [4, 4] }],
  })
  assert.deepEqual(c.route.points[0].at, [0, 0])
  // The first point is the character: the others stay where they were.
  ops.moveRoutePoint(layout, c.id, 0, [1, 1])
  assert.deepEqual(c.position, [2, 0, 3])
  assert.deepEqual(
    c.route.points.map((p) => p.at),
    [
      [0, 0],
      [3, -1],
      [3, 3],
    ],
  )
  ops.moveRoutePoint(layout, c.id, 2, [7, 7])
  assert.deepEqual(c.route.points[2].at, [7, 7])
  ops.setRouteStop(layout, c.id, 1, { motion: WAVE, wait: 2 })
  assert.deepEqual(c.route.points[1].stop, { motion: WAVE, wait: 2 })
  ops.setRouteStop(layout, c.id, 1, null)
  assert.equal(c.route.points[1].stop, undefined)
  ops.removeRoutePoint(layout, c.id, 0)
  assert.deepEqual(c.position, [5, 0, 2])
  assert.deepEqual(
    c.route.points.map((p) => p.at),
    [
      [0, 0],
      [4, 8],
    ],
  )
  ops.removeRoutePoint(layout, c.id, 1)
  assert.equal(c.route, undefined)
  ops.setRoute(layout, c.id, { ...square(), points: [{ at: [0, 0] }] })
  assert.equal(c.route, undefined)
})

test('모델의 걸음 길이는 정한 값을 새 파일에도 지키고 지우면 잰 값으로 돌아간다', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'characters-'))
  const library = characterLibrary(dir, {
    builtin: path.join(dir, 'none.glb'),
    layouts: () => [],
  })
  const { id, library: first } = await library.addModel(
    await riggedGiraffe(),
    '기린',
  )
  assert.equal(first.models[0].stride, undefined)
  let view = await library.updateModel(id, { stride: 1.234 })
  assert.equal(view.models[0].stride, 1.23)
  await assert.rejects(library.updateModel(id, { stride: 0 }), /걸음 길이/)
  const replaced = await library.replaceModel(
    id,
    await riggedGiraffe({ top: 3, clip: 'Idle' }),
  )
  assert.equal(replaced.library.models[0].stride, 1.23)
  // The public list of a published world carries it to the visitor scene.
  const layout = draft(character())
  layout.characters[0].model = id
  assert.equal(characterSheet(layout, replaced.library).models[id].stride, 1.23)
  view = await library.updateModel(id, { stride: null })
  assert.equal(view.models[0].stride, undefined)
})
