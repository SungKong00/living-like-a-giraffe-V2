import test from 'node:test'
import assert from 'node:assert/strict'
import { getBounds, NodeIO } from '@gltf-transform/core'
import { clayField, clayPresets } from '../web/clay-field.js'

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

test('점토 강하게에서도 얼굴 부속은 제자리에 있고 몸통은 눌린다', async () => {
  const root = (
    await new NodeIO().read(
      'assets-source/characters/riragi-clay/riragi-giraffe-base.glb',
    )
  ).getRoot()
  const field = clayField(
    getBounds(root.listScenes()[0]),
    'studio-test',
    'characters',
  )
  const nodes = new Map(root.listNodes().map((node) => [node.getName(), node]))
  function displacement(name, settings = clayPresets.strong) {
    const positions = nodes
      .get(name)
      .getMesh()
      .listPrimitives()[0]
      .getAttribute('POSITION')
    const point = [],
      moved = []
    let max = 0
    for (let i = 0; i < positions.getCount(); i++) {
      positions.getElement(i, point)
      field(point[0], point[1], point[2], settings, moved)
      max = Math.max(
        max,
        Math.hypot(
          moved[0] - point[0],
          moved[1] - point[1],
          moved[2] - point[2],
        ),
      )
    }
    return max
  }
  for (const name of ['Eye.L', 'Eye.R', 'Mouth', 'Nostril.L', 'Nostril.R'])
    assert.equal(displacement('Giraffe.' + name), 0, name)
  const light = displacement('Giraffe.Body', clayPresets.light)
  const medium = displacement('Giraffe.Body', clayPresets.medium)
  const strong = displacement('Giraffe.Body')
  assert.ok(light > 0 && light < 0.025)
  assert.ok(light < medium && medium < strong)
  assert.ok(strong > 0.03 && strong < 0.085)
})

test('캐릭터 파일의 원점과 단위가 달라도 굴곡과 눌림의 상대 크기가 같다', () => {
  const bounds = { min: [-0.5, 0, -1.5], max: [0.5, 4, 1.5] }
  const field = clayField(bounds, 'riragi', 'characters')
  for (const scale of [0.01, 100]) {
    const offset = [3, -2, 0.25]
    const transform = (p) => p.map((v, i) => v * scale + offset[i])
    const scaled = clayField(
      { min: transform(bounds.min), max: transform(bounds.max) },
      'riragi',
      'characters',
    )
    for (const width of [0, 50, 100]) {
      const settings = { strength: 100, depth: 100, width }
      for (const h of [0, 0.1, 0.4, 0.63, 0.9]) {
        const point = [0.33, h * 4, -0.15]
        const expected = transform(field(...point, settings, []))
        const actual = scaled(...transform(point), settings, [])
        actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-9))
        if (h === 0 || h === 0.9) assert.deepEqual(actual, transform(point))
      }
    }
  }
})

test('기린 체형은 실제 골격의 머리·의상 소켓을 따라가고 발굽과 원래 포즈를 보존한다', async () => {
  const { NullEngine } = await import('@babylonjs/core/Engines/nullEngine.js')
  const { Scene } = await import('@babylonjs/core/scene.js')
  const { TransformNode } =
    await import('@babylonjs/core/Meshes/transformNode.js')
  const { Quaternion } = await import('@babylonjs/core/Maths/math.vector.js')
  const { giraffeProportions } = await import('../web/giraffe-proportions.js')
  const root = (
    await new NodeIO().read(
      'assets-source/characters/riragi-clay/riragi-giraffe.glb',
    )
  ).getRoot()
  const engine = new NullEngine()
  const scene = new Scene(engine)
  try {
    const nodes = new Map()
    for (const n of root.listNodes()) {
      const joint = new TransformNode(n.getName(), scene)
      joint.position.set(...n.getTranslation())
      joint.scaling.set(...n.getScale())
      joint.rotationQuaternion = Quaternion.FromArray(n.getRotation())
      nodes.set(n.getName(), joint)
    }
    for (const n of root.listNodes())
      for (const child of n.listChildren())
        nodes.get(child.getName()).parent = nodes.get(n.getName())
    const at = (name) =>
      nodes.get(name).computeWorldMatrix(true).getTranslation()
    const sole = at('Fore.Hoof.L'),
      eye = at('Socket.Face'),
      ear = at('Socket.Ear.L')
    const raw = nodes.get('Head').position
    const shape = giraffeProportions(scene, nodes)
    const limbNames = ['Fore', 'Hind'].flatMap((pair) =>
      ['L', 'R'].map((side) => [
        pair + '.Upper.' + side,
        pair + '.Hoof.' + side,
      ]),
    )
    const length = (from, to) => at(from).subtract(at(to)).length()
    const limbs = limbNames.map(([upper, hoof]) => ({
      upper,
      hoof,
      length: length(upper, hoof),
      floor: at(hoof).y,
    }))
    const neckLength = length('Neck.01', 'Head')
    const faceLength = length('Head', 'Socket.Face')
    const torsoLength = length('Pelvis', 'Chest')
    // The cape follows the torso bones. Measure all three axes of its back socket.
    const axes = (name) => {
      const m = nodes.get(name).computeWorldMatrix(true).m
      return [0, 4, 8].map((i) => Math.hypot(m[i], m[i + 1], m[i + 2]))
    }
    const restAxes = axes('Socket.Back')
    const neckAxes = axes('Neck.03')
    const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-5, a + ' ≠ ' + b)
    for (const body of [0.7, 1.4, 1]) {
      shape.set({ body })
      for (const axis of [0, 2])
        close(axes('Neck.03')[axis], neckAxes[axis] * body)
      axes('Socket.Back').forEach((value, i) =>
        close(value, restAxes[i] * body),
      )
      close(length('Pelvis', 'Chest'), torsoLength * body)
      close(length('Neck.01', 'Head'), neckLength)
      close(length('Head', 'Socket.Face'), faceLength)
      for (const limb of limbs) {
        close(length(limb.upper, limb.hoof), limb.length)
        close(at(limb.hoof).y, limb.floor)
      }
    }
    shape.set({ neck: 1.4, head: 1.3, legs: 1.3, body: 0.7 })
    assert.ok(at('Socket.Face').y > eye.y + 0.65)
    assert.ok(at('Socket.Ear.L').y > ear.y + 0.65)
    assert.ok(Math.abs(at('Fore.Hoof.L').y - sole.y) < 0.02)
    const shaped = at('Socket.Face')
    for (let i = 0; i < 4; i++) {
      scene.onBeforeAnimationsObservable.notifyObservers(scene)
      assert.equal(nodes.get('Head').position, raw)
      scene.onAfterAnimationsObservable.notifyObservers(scene)
      assert.ok(at('Socket.Face').subtract(shaped).length() < 0.00001)
    }
    shape.set()
    assert.ok(at('Socket.Face').subtract(eye).length() < 0.00001)
    shape.dispose()
  } finally {
    scene.dispose()
    engine.dispose()
  }
})
