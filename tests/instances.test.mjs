import test from 'node:test'
import assert from 'node:assert/strict'
import { Document } from '@gltf-transform/core'
import { batchRoomCopies } from '../world/instances.mjs'

test('렌더 조건이 같은 가구만 같은 방에서 묶고, 클릭 대상은 각각 남긴다', () => {
  const doc = new Document(),
    scene = doc.createScene(),
    buffer = doc.createBuffer()
  const pos = doc
    .createAccessor()
    .setType('VEC3')
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
    .setBuffer(buffer)
  const mesh = doc
    .createMesh()
    .addPrimitive(
      doc
        .createPrimitive()
        .setAttribute('POSITION', pos)
        .setMaterial(doc.createMaterial()),
    )
  const red = doc.createMesh().addPrimitive(
    doc
      .createPrimitive()
      .setAttribute('POSITION', pos)
      .setMaterial(doc.createMaterial().setBaseColorFactor([1, 0, 0, 1])),
  )
  const room = doc.createNode().setExtras({ roomId: 'sauna' })
  scene.addChild(room)
  for (const [id, m, x] of [
    ['one', mesh, 2],
    ['two', mesh, 4],
    ['red', red, 5],
  ])
    room.addChild(
      doc
        .createNode()
        .setExtras({ itemId: id })
        .setTranslation([x, 0, 0])
        .setMesh(m),
    )
  const other = doc.createNode().setExtras({ roomId: 'sports' })
  scene.addChild(other)
  other.addChild(doc.createNode().setMesh(mesh))
  batchRoomCopies(doc)
  const children = room.listChildren()
  assert.deepEqual(
    children
      .filter((n) => n.getExtras().itemId)
      .map((n) => n.getExtras().itemId),
    ['one', 'two', 'red'],
  )
  assert.equal(children.filter((n) => n.getMesh()).length, 2)
  const batch = children
    .find((n) => n.getExtension('EXT_mesh_gpu_instancing'))
    .getExtension('EXT_mesh_gpu_instancing')
  assert.deepEqual(
    Array.from(batch.getAttribute('TRANSLATION').getArray()),
    [2, 0, 0, 4, 0, 0],
  )
  assert.equal(other.listChildren()[0].getMesh(), mesh)
})
