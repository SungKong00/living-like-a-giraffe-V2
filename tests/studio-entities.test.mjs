import test from 'node:test'
import assert from 'node:assert/strict'
import { entities, entityTypes, WORLD } from '../web/studio-entities.js'

const layout = {
  items: [{ id: 'bench', room: 'sauna', label: '나무 벤치' }],
  spots: [
    { id: 'on-bench', anchor: 'bench', label: '벤치 안내' },
    { id: 'on-room', anchor: 'sauna', label: '방 안내' },
  ],
  pages: [{ id: 'talk', title: '이야기' }],
  lights: [{ id: 'lamp', room: 'sauna', label: '점광원 1' }],
}
const lights = [...layout.lights, { id: 'sun', room: null, label: 'Fill' }]
const scene = entities({
  layout,
  rooms: [{ id: 'sauna', label: '멘탈 사우나' }],
  light: (id) => lights.find((l) => l.id === id),
})

test('선택한 개체의 범위는 월드부터 자기까지 이어진다', () => {
  const path = (sel) => scene.path(sel).map((at) => scene.name(at))
  assert.deepEqual(path({ type: 'spot', id: 'on-bench' }), [
    '월드',
    '멘탈 사우나',
    '나무 벤치',
    '벤치 안내',
  ])
  assert.deepEqual(path({ type: 'spot', id: 'on-room' }), [
    '월드',
    '멘탈 사우나',
    '방 안내',
  ])
  // A Blender light without a room lights the whole world.
  assert.deepEqual(path({ type: 'light', id: 'sun' }), ['월드', 'Fill'])
  assert.deepEqual(path({ type: 'page', id: 'talk' }), ['이야기'])
  assert.deepEqual(path(WORLD), ['월드'])
})

test('새 개체는 선택을 담은 방에 놓인다', () => {
  assert.equal(scene.roomOf({ type: 'spot', id: 'on-bench' }), 'sauna')
  assert.equal(scene.roomOf({ type: 'light', id: 'lamp' }), 'sauna')
  assert.equal(scene.roomOf({ type: 'light', id: 'sun' }), null)
  assert.equal(scene.roomOf(WORLD), null)
})

test('없는 개체와 등록되지 않은 종류를 구분한다', () => {
  assert.equal(scene.exists({ type: 'item', id: 'gone' }), false)
  assert.equal(scene.exists(WORLD), true)
  assert.throws(() => scene.exists({ type: 'dragon', id: 'd' }), /dragon/)
  assert.equal(scene.removable(WORLD), false)
  assert.equal(scene.removable({ type: 'room', id: 'sauna' }), false)
  assert.ok(Object.isFrozen(entityTypes))
})
