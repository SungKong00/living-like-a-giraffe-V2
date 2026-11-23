import test from 'node:test'
import assert from 'node:assert/strict'
import { NodeIO } from '@gltf-transform/core'

test('기본 기린과 착용 예시가 골격·동작·부착점을 공유한다', async () => {
  const io = new NodeIO()
  const read = async (filename) =>
    (
      await io.read('assets-source/characters/riragi-clay/' + filename)
    ).getRoot()
  const [base, fitting] = await Promise.all([
    read('riragi-giraffe-base.glb'),
    read('riragi-giraffe.glb'),
  ])
  const bones = (root) =>
    root
      .listSkins()[0]
      .listJoints()
      .map((n) => n.getName())
  assert.deepEqual(bones(base), bones(fitting))
  for (const root of [base, fitting]) {
    const nodes = new Map(
      root.listNodes().map((node) => [node.getName(), node]),
    )
    const body = nodes.get('Giraffe.Body')
    assert.ok(body.getSkin())
    for (const primitive of body.getMesh().listPrimitives()) {
      assert.ok(primitive.getAttribute('JOINTS_0'))
      assert.ok(primitive.getAttribute('WEIGHTS_0'))
    }
    const sockets = {
      Crown: 'Head',
      Face: 'Head',
      Neck: 'Neck.02',
      Chest: 'Chest',
      Back: 'Spine',
      'Ear.L': 'Ear.L',
      'Ear.R': 'Ear.R',
    }
    for (const [socket, bone] of Object.entries(sockets))
      assert.equal(
        nodes
          .get('Socket.' + socket)
          ?.getParentNode()
          ?.getName(),
        bone,
      )
    const glance = root
      .listAnimations()
      .find((clip) => clip.getName() === 'LookAround')
    assert.ok(
      glance
        ?.listChannels()
        .some((channel) => channel.getTargetNode() === nodes.get('Head')),
    )
    if (root === fitting) {
      assert.equal(nodes.get('Wear.Cape')?.getSkin(), body.getSkin())
      assert.equal(
        nodes.get('Wear.Flower')?.getParentNode(),
        nodes.get('Socket.Ear.L'),
      )
    } else {
      assert.ok(!nodes.has('Wear.Cape') && !nodes.has('Wear.Flower'))
    }
  }
})
