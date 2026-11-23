import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeItems, seed, validate } from '../server/layout.mjs'
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

test('발행 데이터는 고아 링크, 잘못된 변환, 외부 스크립트 주소를 거부한다', () => {
  for (const mutate of [
    (d) => d.items.push(bench),
    (d) => (d.items[0].scale[0] = 0),
    (d) => (d.items[0].rotation = [0, 0, 0, 0]),
    (d) => (d.spots[0].anchor = 'missing'),
    (d) => (d.spots[0].action.page = 'missing'),
    (d) => (d.spots[0].action = { type: 'url', url: 'javascript:alert(1)' }),
  ]) {
    const d = seed(catalog)
    mutate(d)
    assert.throws(() => validate(d, catalog))
  }
})
test('독립 변경은 보존하고, 양쪽에서 다른 색이나 삭제를 선택하면 충돌로 남긴다', () => {
  const web = { ...bench, color: '#ff0000' },
    file = { ...bench, position: [4, 0, 1] }
  assert.deepEqual(mergeItems([bench], [web], [file]).items, [
    { ...web, position: file.position },
  ])
  const other = { ...bench, color: '#001122' }
  assert.equal(
    mergeItems([bench], [web], [other]).conflicts[0].key,
    'sauna-bench.color',
  )
  assert.deepEqual(
    mergeItems([bench], [web], [other], { 'sauna-bench.color': 'file' }).items,
    [other],
  )
  assert.equal(mergeItems([bench], [web], []).conflicts[0].file, null)
  assert.deepEqual(
    mergeItems([bench], [web], [], { 'sauna-bench': 'file' }).items,
    [],
  )
})
test('편집 이력은 반환값의 외부 변경과 취소 후 분기에서 보호된다', () => {
  const h = new EditHistory({ x: 1 })
  h.value.x = 9
  assert.equal(h.value.x, 1)
  h.change((d) => (d.x = 2))
  h.undo()
  assert.equal(h.value.x, 1)
  h.change((d) => (d.x = 3))
  h.redo()
  assert.equal(h.value.x, 3)
})
test('가구 종류의 허용 옵션을 서버에서 검사한다', () => {
  const d = seed(catalog)
  const limited = {
    ...catalog,
    options: {
      bench: { colors: ['original', '#226655'], finishes: ['original'] },
    },
  }
  d.items[0].finish = 'gloss'
  assert.throws(() => validate(d, limited))
  d.items[0].finish = 'original'
  d.items[0].color = '#226655'
  assert.deepEqual(validate(d, limited), d)
})
