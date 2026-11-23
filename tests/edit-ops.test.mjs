import test from 'node:test'
import assert from 'node:assert/strict'
import * as ops from '../web/edit-ops.js'
import { Autosave } from '../web/autosave.js'
import { seed, validate } from '../server/layout.mjs'
import { EditHistory } from '../web/history.js'

const bench = {
  id: 'sauna-bench',
  kind: 'bench',
  room: 'sauna',
  label: '벤치',
  position: [0, 0, 0],
  rotation: [0, 0, 0, 1],
  scale: [1, 1, 1],
  color: 'original',
  finish: 'original',
}
const catalog = { rooms: [{ id: 'sauna' }, { id: 'sports' }], items: [bench] }

test('복제본은 새 ID·옵션·옆 위치를 갖고 원본과 서버 검증을 함께 통과한다', () => {
  const d = seed(catalog)
  d.items[0].color = '#113355'
  const copy = ops.duplicateItem(d, 'sauna-bench', 'copy-1')
  assert.equal(copy.color, '#113355')
  assert.equal(copy.label, '벤치 2')
  assert.deepEqual(copy.position, [1, 0, 1])
  assert.deepEqual(d.items[0].position, [0, 0, 0])
  assert.equal(ops.duplicateItem(d, 'copy-1', 'copy-2').label, '벤치 3')
  validate(d, catalog)
})

test('가구 삭제는 연결 영역을 함께 지우고 되돌리기 한 번으로 모두 복구한다', () => {
  const h = new EditHistory(seed(catalog))
  let removed
  h.change((d) => (removed = ops.deleteItem(d, 'sauna-bench')))
  assert.equal(removed, 1)
  assert.equal(h.value.items.length, 0)
  validate(h.value, catalog)
  h.undo()
  assert.equal(h.value.items.length, 1)
  assert.equal(ops.spotsOn(h.value, 'sauna-bench').length, 1)
})

test('페이지 삭제는 그 페이지에 연결된 영역만 지운다', () => {
  const d = seed(catalog)
  assert.equal(ops.deletePage(d, 'mental-sauna'), 1)
  assert.deepEqual(
    d.spots.map((s) => s.id),
    ['sports-day'],
  )
  validate(d, catalog)
})

test('추가한 가구와 영역은 서버 규칙을 만족한다', () => {
  const d = seed(catalog)
  ops.addItem(d, { id: 'new-1', kind: 'bench', label: '벤치', room: 'sports' })
  const page = ops.addPage(d, { id: 'page-1' })
  ops.addSpot(d, { id: 'spot-1', anchor: 'new-1', page })
  validate(d, catalog)
  ops.moveToRoom(d, 'sauna-bench', 'sports')
  assert.equal(d.items[0].room, 'sports')
  assert.deepEqual(d.items[0].position, [0, 0, 0])
})

test('회전은 위쪽 축 기준으로 누적되고 기울기를 보존한다', () => {
  let q = [0, 0, 0, 1]
  q = ops.rotateBy(q, 15)
  q = ops.rotateBy(q, 15)
  assert.equal(ops.yawOf(q), 30)
  assert.equal(ops.yawOf(ops.withYaw(q, -90)), -90)
  assert.equal(ops.yawOf(ops.rotateBy([0, 0, 0, 1], 180)), 180)
  const tilted = ops.normalize([0.1, 0, 0, 1])
  const turned = ops.rotateBy(tilted, 90)
  assert.ok(Math.abs(Math.hypot(...turned) - 1) < 1e-9)
  assert.ok(Math.abs(ops.yawOf(turned) - 90) < 0.5)
})

test('입력 검증은 서버의 이름·주소 규칙과 맞는다', () => {
  assert.ok(ops.labelError('  '))
  assert.equal(ops.labelError('벤치'), null)
  assert.ok(ops.urlError(''))
  assert.equal(ops.urlError('', { optional: true }), null)
  assert.ok(ops.urlError('javascript:alert(1)'))
  assert.equal(ops.urlError('https://example.com/a'), null)
  assert.equal(ops.snap(1.13), 1.25)
  assert.equal(ops.clampScale(0), 0.01)
})

test('자동 저장은 연속 변경을 합치고 순서대로 한 번씩 저장한다', async () => {
  const calls = []
  let release
  const save = () =>
    new Promise((r) => {
      calls.push(Date.now())
      release = r
    })
  const states = []
  const a = new Autosave({ save, delay: 5, onState: (s) => states.push(s) })
  a.schedule()
  a.schedule()
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(calls.length, 1)
  a.schedule()
  const done = a.flush()
  release()
  await new Promise((r) => setTimeout(r, 5))
  release()
  await done
  assert.equal(calls.length, 2)
  assert.equal(a.state, 'saved')
  assert.equal(states.at(-1), 'saved')
})

test('자동 저장은 409에서 멈추고 이후 변경을 보내지 않는다', async () => {
  let count = 0
  const a = new Autosave({
    save: async () => {
      count++
      throw Object.assign(Error('conflict'), { status: 409 })
    },
    delay: 1,
  })
  await assert.rejects(a.flush())
  assert.equal(a.state, 'conflict')
  a.schedule()
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(count, 1)
})
