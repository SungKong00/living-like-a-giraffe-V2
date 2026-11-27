import test from 'node:test'
import assert from 'node:assert/strict'
import { mat4, vec3 } from 'gl-matrix'
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

async function poseNodes(root, scene) {
  const { TransformNode } =
    await import('@babylonjs/core/Meshes/transformNode.js')
  const { Quaternion } = await import('@babylonjs/core/Maths/math.vector.js')
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
  return nodes
}

test('기린 체형은 실제 골격의 머리·의상 소켓을 따라가고 발굽과 원래 포즈를 보존한다', async () => {
  const { NullEngine } = await import('@babylonjs/core/Engines/nullEngine.js')
  const { Scene } = await import('@babylonjs/core/scene.js')
  const { giraffeProportions } = await import('../web/giraffe-proportions.js')
  const root = (
    await new NodeIO().read(
      'assets-source/characters/riragi-clay/riragi-giraffe.glb',
    )
  ).getRoot()
  const engine = new NullEngine()
  const scene = new Scene(engine)
  try {
    const nodes = await poseNodes(root, scene)
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

function* walkSample(walk, time) {
  for (const channel of walk.listChannels()) {
    const sampler = channel.getSampler()
    const keys = sampler.getInput().getArray()
    const index = keys.reduce(
      (nearest, t, i) =>
        Math.abs(t - time) < Math.abs(keys[nearest] - time) ? i : nearest,
      0,
    )
    const value = sampler.getOutput().getElement(index, [])
    yield [channel.getTargetNode(), channel.getTargetPath(), value]
  }
}

// Track the two ends of the flat pad on each hoof. The ankle rises as the
// hoof rolls over its toe, even when its contact point stays on the floor.
function hoofPads(matrixForSide) {
  return ['L', 'R'].map((side) => {
    const rest = matrixForSide(side)
    const ankle = mat4.getTranslation([], rest)
    const inverse = mat4.invert([], rest)
    const local = [0.008, 0.138].map((forward) =>
      vec3.transformMat4(
        [],
        vec3.add([], ankle, [0, -0.158, forward]),
        inverse,
      ),
    )
    return () => {
      const matrix = matrixForSide(side)
      return local.map((point) => vec3.transformMat4([], point, matrix))
    }
  })
}

test('두발 기린은 골반 위에 선 몸통, 독립된 팔, 양발을 번갈아 드는 보행과 옷 없는 얼굴 조절 골격을 갖춘다', async () => {
  const root = (
    await new NodeIO().read(
      'assets-source/characters/riragi-clay/riragi-biped.glb',
    )
  ).getRoot()
  const byName = new Map(root.listNodes().map((node) => [node.getName(), node]))
  const body = byName.get('Giraffe.Body')
  const [surface] = body.getMesh().listPrimitives()
  assert.ok(
    surface.getAttribute('WEIGHTS_0') && surface.getAttribute('JOINTS_0'),
  )
  const protect = surface.getAttribute('_CLAY_PROTECT')
  assert.equal(protect.getMax([])[0], 1)
  assert.equal(protect.getMin([])[0], 0)
  const headIndex = body.getSkin().listJoints().indexOf(byName.get('Head'))
  const joints = surface.getAttribute('JOINTS_0')
  const weights = surface.getAttribute('WEIGHTS_0')
  const jointIds = [],
    skinWeights = []
  let faceVertices = 0
  for (let i = 0; i < weights.getCount(); i++) {
    joints.getElement(i, jointIds)
    weights.getElement(i, skinWeights)
    if (skinWeights[jointIds.indexOf(headIndex)] >= 0.9999) {
      faceVertices++
      assert.ok(protect.getScalar(i) >= 0.9999)
    }
  }
  assert.ok(faceVertices > 0)

  assert.ok(
    root.listNodes().every((node) => !node.getName().startsWith('Wear.')),
  )
  assert.equal(byName.get('Muzzle').getParentNode(), byName.get('Head'))
  assert.equal(byName.get('Socket.Face').getParentNode(), byName.get('Muzzle'))
  assert.equal(byName.get('Socket.Ear.L').getParentNode(), byName.get('Ear.L'))
  const at = (name) => byName.get(name).getWorldTranslation()
  const chest = at('Chest'),
    hips = at('Pelvis')
  assert.ok(chest[1] > hips[1] + 0.5 && Math.abs(chest[2] - hips[2]) < 0.2)
  for (const side of ['L', 'R']) {
    assert.equal(
      byName.get('Arm.Upper.' + side).getParentNode(),
      byName.get('Chest'),
    )
    assert.equal(
      byName.get('Hind.Upper.' + side).getParentNode(),
      byName.get('Pelvis'),
    )
    assert.ok(at('Arm.Hoof.' + side)[1] > hips[1])
  }
  const walk = root
    .listAnimations()
    .find((clip) => clip.getName() === '두 발 걷기')
  // Sample the actual exported joint transforms at the two passing poses.
  function sample(time) {
    for (const [joint, path, value] of walkSample(walk, time)) {
      if (path === 'rotation') joint.setRotation(value)
      else if (path === 'translation') joint.setTranslation(value)
      else joint.setScale(value)
    }
  }
  const left = 'Hind.Hoof.L',
    right = 'Hind.Hoof.R'
  const pads = hoofPads((s) => byName.get('Hind.Hoof.' + s).getWorldMatrix())
  const keys = walk.listSamplers().reduce((times, s) => {
    const input = s.getInput().getArray()
    return input.length > times.length ? input : times
  }, [])
  const end = keys.at(-1)
  assert.equal(keys[0], 0)
  const snapshots = Array.from(keys, (time) => {
    sample(time)
    return { pads: pads.map((pad) => pad()), ankles: [at(left), at(right)] }
  })
  const height = (pad) => Math.min(...pad.map((p) => p[1]))
  for (const [phase, planted, lifted] of [
    [0.14, 0, 1],
    [0.64, 1, 0],
  ]) {
    const { pads } = snapshots[Math.round(phase * (keys.length - 1))]
    assert.ok(Math.abs(height(pads[planted])) < 0.006)
    assert.ok(height(pads[lifted]) > 0.085 && height(pads[lifted]) < 0.105)
  }
  // The captured hoof rolls from heel to toe. During each stance the ankle
  // must keep moving backwards, including the middle of the step.
  for (let i = 1; i < keys.length; i++) {
    const { pads, ankles } = snapshots[i]
    assert.ok(Math.abs(Math.min(...pads.map(height))) < 0.012)
    for (const side of [0, 1]) {
      const phase = (keys[i] / end + side * 0.5) % 1
      if (phase <= 0.05 || phase >= 0.46) continue
      const dt = keys[i] - keys[i - 1]
      const speed = (snapshots[i - 1].ankles[side][2] - ankles[side][2]) / dt
      assert.ok(speed > 0.8 && speed < 1.2)
    }
  }
  for (const side of [0, 1]) {
    for (const point of [0, 1]) {
      const atPad = (i) => snapshots.at(i).pads[side][point]
      assert.ok(vec3.distance(atPad(0), atPad(-1)) < 0.0001)
      // At the loop boundary both the heel and the toe continue moving.
      const velocity = (a, b) =>
        vec3.scale(
          [],
          vec3.subtract([], atPad(b), atPad(a)),
          1 / (keys.at(b) - keys.at(a)),
        )
      assert.ok(vec3.distance(velocity(-2, -1), velocity(0, 1)) < 0.3)
    }
  }
  // A foot reaching forward is accompanied by the opposite hand.
  sample(1 / 24)
  assert.ok(at(left)[2] > at(right)[2] + 0.2)
  assert.ok(at('Arm.Hoof.R')[2] > at('Arm.Hoof.L')[2] + 0.1)
})

test('두발 얼굴 체형은 귀 뿌리와 눈을 고정하고 걷기 프레임 사이에도 독립적으로 유지된다', async () => {
  const { NullEngine } = await import('@babylonjs/core/Engines/nullEngine.js')
  const { Scene } = await import('@babylonjs/core/scene.js')
  const { giraffeProportions } = await import('../web/giraffe-proportions.js')
  const doc = await new NodeIO().read(
    'assets-source/characters/riragi-clay/riragi-biped.glb',
  )
  const engine = new NullEngine()
  const scene = new Scene(engine)
  try {
    const nodes = await poseNodes(doc.getRoot(), scene)
    const shape = giraffeProportions(scene, nodes)
    const at = (name) =>
      nodes.get(name).computeWorldMatrix(true).getTranslation()
    const length = (from, to) => at(from).subtract(at(to)).length()
    const ear = length('Ear.L', 'Socket.Ear.L')
    const face = at('Socket.Face')
    const temple = at('Ear.L')
    shape.set({ ears: 1.4 })
    assert.ok(Math.abs(length('Ear.L', 'Socket.Ear.L') / ear - 1.4) < 1e-5)
    assert.ok(at('Socket.Face').equalsWithEpsilon(face))
    shape.set({ muzzle: 0.75, ears: 1.4 })
    const short = at('Socket.Face')
    assert.ok(short.subtract(face).length() > 0.05)
    for (let frame = 0; frame < 3; frame++) {
      scene.onBeforeAnimationsObservable.notifyObservers(scene)
      scene.onAfterAnimationsObservable.notifyObservers(scene)
      assert.ok(at('Ear.L').equalsWithEpsilon(temple))
      assert.ok(at('Socket.Face').equalsWithEpsilon(short))
    }
    shape.set()
    assert.ok(at('Socket.Face').equalsWithEpsilon(face))
    shape.dispose()
  } finally {
    scene.dispose()
    engine.dispose()
  }
})

test('두발 걷기에서 다리 길이와 몸통 크기를 바꿔도 지지발의 높이를 유지한다', async () => {
  const { NullEngine } = await import('@babylonjs/core/Engines/nullEngine.js')
  const { Scene } = await import('@babylonjs/core/scene.js')
  const { giraffeProportions } = await import('../web/giraffe-proportions.js')
  const root = (
    await new NodeIO().read(
      'assets-source/characters/riragi-clay/riragi-biped.glb',
    )
  ).getRoot()
  const engine = new NullEngine()
  const scene = new Scene(engine)
  try {
    const nodes = await poseNodes(root, scene)
    const shape = giraffeProportions(scene, nodes)
    const walk = root
      .listAnimations()
      .find((clip) => clip.getName() === '두 발 걷기')
    const props = {
      translation: 'position',
      rotation: 'rotationQuaternion',
      scale: 'scaling',
    }
    const pads = hoofPads((side) =>
      nodes
        .get('Hind.Hoof.' + side)
        .computeWorldMatrix(true)
        .asArray(),
    )
    const supportHeight = () =>
      Math.min(...pads.flatMap((pad) => pad().map((point) => point[1])))
    const keys = walk.listSamplers().reduce((times, sampler) => {
      const input = sampler.getInput().getArray()
      return input.length > times.length ? input : times
    }, [])
    function sampleHeight(time) {
      scene.onBeforeAnimationsObservable.notifyObservers(scene)
      for (const [joint, path, value] of walkSample(walk, time))
        nodes.get(joint.getName())[props[path]].set(...value)
      scene.onAfterAnimationsObservable.notifyObservers(scene)
      return supportHeight()
    }
    const baseline = Array.from(keys, sampleHeight)
    for (const [legs, body] of [
      [0.75, 1.4],
      [1.3, 0.7],
    ]) {
      shape.set({ legs, body })
      for (const [i, time] of keys.entries()) {
        assert.ok(
          Math.abs(sampleHeight(time) - baseline[i]) < 0.013,
          'time ' + time + ' / legs ' + legs + ' / body ' + body,
        )
      }
    }
    shape.dispose()
  } finally {
    scene.dispose()
    engine.dispose()
  }
})

test('모션 전용 걷기 GLB는 모델의 같은 골격 채널과 시간·값만 담는다', async () => {
  const io = new NodeIO()
  const read = async (name) =>
    (
      await io.read('assets-source/characters/riragi-clay/' + name + '.glb')
    ).getRoot()
  const [model, motion] = await Promise.all([
    read('riragi-biped'),
    read('riragi-biped-walk'),
  ])
  assert.equal(motion.listMeshes().length, 0)
  assert.equal(motion.listTextures().length, 0)
  function tracks(root) {
    assert.equal(root.listAnimations().length, 1)
    const clip = root.listAnimations()[0]
    assert.equal(clip.getName(), '두 발 걷기')
    return new Map(
      clip.listChannels().map((c) => {
        const s = c.getSampler()
        return [
          [c.getTargetNode().getName(), c.getTargetPath()].join('/'),
          [
            s.getInterpolation(),
            s.getInput().getArray(),
            s.getOutput().getArray(),
          ],
        ]
      }),
    )
  }
  const skinTracks = tracks(model)
  assert.equal(skinTracks.size, 75)
  assert.deepEqual(tracks(motion), skinTracks)
})

test('편안히 서기는 같은 기린 골격에서 8초 동안 양발을 고정하고 상체를 움직인 뒤 처음 자세로 돌아온다', async () => {
  const io = new NodeIO()
  const dir = 'assets-source/characters/riragi-clay/'
  const model = (await io.read(dir + 'riragi-biped.glb')).getRoot()
  const idle = (await io.read(dir + 'riragi-biped-idle.glb')).getRoot()
  const nodes = new Map(model.listNodes().map((n) => [n.getName(), n]))
  assert.equal(idle.listMeshes().length, 0)
  assert.deepEqual(idle.listAnimations().map((a) => a.getName()), ['편안히 서기'])
  const [clip] = idle.listAnimations()
  const times = new Set()
  for (const c of clip.listChannels()) {
    assert.ok(nodes.has(c.getTargetNode().getName()))
    const input = c.getSampler().getInput()
    assert.deepEqual([input.getMin([])[0], input.getMax([])[0]], [0, 8])
    for (const t of input.getArray()) times.add(t)
  }
  const feet = ['Hind.Hoof.L', 'Hind.Hoof.R'].map((name) => nodes.get(name))
  const rest = feet.map((n) => n.getWorldMatrix())
  const face = nodes.get('Socket.Face')
  const samples = []
  for (const t of [...times].sort((a, b) => a - b)) {
    for (const [n, path, value] of walkSample(clip, t)) {
      const joint = nodes.get(n.getName())
      if (path === 'rotation') joint.setRotation(value)
      else if (path === 'translation') joint.setTranslation(value)
      else joint.setScale(value)
    }
    for (const [i, foot] of feet.entries())
      assert.ok(mat4.equals(foot.getWorldMatrix(), rest[i]))
    samples.push(face.getWorldTranslation())
  }
  const travel = samples.map((p) => vec3.distance(p, samples[0]))
  assert.ok(Math.max(...travel) > 0.02 && Math.max(...travel) < 0.13)
  assert.ok(travel.at(-1) < 0.0001)
})
