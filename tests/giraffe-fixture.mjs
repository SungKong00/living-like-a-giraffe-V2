import { Document, NodeIO } from '@gltf-transform/core'

// A tiny rigged "giraffe" and motion files for its skeleton, built in memory
// so tests do not depend on a real Blender export. The column is 4.5m tall
// with a three-joint chain: Root › Neck › Head.

const joints = [
  ['Root', [0, 0, 0]],
  ['Neck', [0, 2, 0]],
  ['Head', [0, 2.5, 0]],
]

const turn = (axis, degrees) => {
  const r = (degrees * Math.PI) / 360
  const q = [0, 0, 0, Math.cos(r)]
  q[axis] = Math.sin(r)
  return q
}

function chain(doc, names = joints.map(([n]) => n)) {
  const nodes = joints.map(([, t], i) =>
    doc.createNode(names[i]).setTranslation(t),
  )
  nodes[0].addChild(nodes[1])
  nodes[1].addChild(nodes[2])
  return nodes
}

function animate(doc, buffer, name, node, axis) {
  const times = doc
    .createAccessor()
    .setType('SCALAR')
    .setArray(new Float32Array([0, 0.5, 1]))
    .setBuffer(buffer)
  const values = doc
    .createAccessor()
    .setType('VEC4')
    .setArray(
      new Float32Array([...turn(axis, 0), ...turn(axis, 25), ...turn(axis, 0)]),
    )
    .setBuffer(buffer)
  const sampler = doc
    .createAnimationSampler()
    .setInput(times)
    .setOutput(values)
    .setInterpolation('LINEAR')
  return doc
    .createAnimation(name)
    .addSampler(sampler)
    .addChannel(
      doc
        .createAnimationChannel()
        .setTargetNode(node)
        .setTargetPath('rotation')
        .setSampler(sampler),
    )
}

export async function riggedGiraffe({ names } = {}) {
  const doc = new Document()
  const buffer = doc.createBuffer()
  const [root, neck, head] = chain(doc, names)
  // A box from the floor to 4.5m; the top half follows the neck and head.
  const w = 0.5
  const box = []
  for (const y of [0, 2, 4.5])
    for (const [x, z] of [
      [-w, -w],
      [w, -w],
      [w, w],
      [-w, w],
    ])
      box.push(x, y, z)
  const index = []
  for (let ring = 0; ring < 2; ring++)
    for (let i = 0; i < 4; i++) {
      const a = ring * 4 + i,
        b = ring * 4 + ((i + 1) % 4)
      index.push(a, b, b + 4, a, b + 4, a + 4)
    }
  index.push(8, 9, 10, 8, 10, 11)
  const jointIds = [],
    weights = []
  for (let v = 0; v < 12; v++) {
    jointIds.push(v < 4 ? 0 : v < 8 ? 1 : 2, 0, 0, 0)
    weights.push(1, 0, 0, 0)
  }
  const accessor = (type, array) =>
    doc.createAccessor().setType(type).setArray(array).setBuffer(buffer)
  const primitive = doc
    .createPrimitive()
    .setAttribute('POSITION', accessor('VEC3', new Float32Array(box)))
    .setAttribute(
      'NORMAL',
      accessor(
        'VEC3',
        new Float32Array(
          box.flatMap((v, i) =>
            i % 3 === 1 ? [] : i % 3 === 0 ? [v / w, 0] : [v / w],
          ),
        ).map((v) => v * Math.SQRT1_2),
      ),
    )
    .setAttribute('JOINTS_0', accessor('VEC4', new Uint16Array(jointIds)))
    .setAttribute('WEIGHTS_0', accessor('VEC4', new Float32Array(weights)))
    .setIndices(accessor('SCALAR', new Uint16Array(index)))
    .setMaterial(
      doc.createMaterial('기린 가죽').setBaseColorFactor([0.85, 0.62, 0.32, 1]),
    )
  const inverse = []
  let y = 0
  for (const [, t] of joints) {
    y += t[1]
    inverse.push(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -y, 0, 1)
  }
  const skin = doc
    .createSkin('기린 뼈대')
    .addJoint(root)
    .addJoint(neck)
    .addJoint(head)
    .setSkeleton(root)
    .setInverseBindMatrices(accessor('MAT4', new Float32Array(inverse)))
  const body = doc
    .createNode('GiraffeBody')
    .setMesh(doc.createMesh('기린').addPrimitive(primitive))
    .setSkin(skin)
  const armature = doc.createNode('Armature').addChild(root)
  doc.createScene('기린').addChild(armature).addChild(body)
  animate(doc, buffer, 'Idle', neck, 2)
  return Buffer.from(await new NodeIO().writeBinary(doc))
}

/** A motion file: the same joint names and one clip. */
export async function giraffeMotion(name, { names } = {}) {
  const doc = new Document()
  const buffer = doc.createBuffer()
  const [root, neck, head] = chain(doc, names)
  doc.createScene('동작').addChild(root)
  animate(
    doc,
    buffer,
    name,
    name === 'Graze' ? neck : head,
    name === 'Graze' ? 0 : 2,
  )
  return Buffer.from(await new NodeIO().writeBinary(doc))
}
