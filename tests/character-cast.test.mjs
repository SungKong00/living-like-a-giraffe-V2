import test from 'node:test'
import assert from 'node:assert/strict'

// A walker on a two-point route, with a clock and a screen the test moves.
async function stage() {
  const { NullEngine } = await import('@babylonjs/core/Engines/nullEngine.js')
  const { Scene } = await import('@babylonjs/core/scene.js')
  const { TransformNode } =
    await import('@babylonjs/core/Meshes/transformNode.js')
  const { Animation } = await import('@babylonjs/core/Animations/animation.js')
  const { AnimationGroup } =
    await import('@babylonjs/core/Animations/animationGroup.js')
  const { Vector3 } = await import('@babylonjs/core/Maths/math.vector.js')
  const { characterCast } = await import('../web/characters/cast.js')
  const { restPose } = await import('../web/characters/pose.js')
  const engine = new NullEngine()
  const scene = new Scene(engine)
  // The walk lifts the joint to y 1–2; at rest it is at 0.
  const lift = new Animation(
    'lift',
    'position',
    60,
    Animation.ANIMATIONTYPE_VECTOR3,
  )
  lift.setKeys([
    { frame: 0, value: new Vector3(0, 1, 0) },
    { frame: 30, value: new Vector3(0, 2, 0) },
    { frame: 60, value: new Vector3(0, 1, 0) },
  ])
  const walk = new AnimationGroup('walk', scene)
  walk.addTargetedAnimation(lift, new TransformNode('Joint', scene))
  walk.normalize(0, 60)
  const clock = { ms: 0 }
  const screen = { shows: false }
  const asked = []
  function walker(id) {
    const cast = characterCast(
      { scene, wake() {} },
      { clip: async () => walk },
      {
        shows(place, reach) {
          asked.push({ x: place.x, reach })
          return screen.shows
        },
        idleCheck: 250,
      },
      { now: () => clock.ms },
    )
    const root = new TransformNode('root', scene)
    const joint = new TransformNode('Joint', scene)
    joint.parent = root
    const entry = cast.add(id, {
      root,
      nodes: new Map([['Joint', joint]]),
      skeletons: [],
      file: 'model',
      rest: restPose([joint]),
    })
    const c = {
      id,
      position: [0, 0, 0],
      yaw: 0,
      scale: 1,
      route: { points: [{ at: [0, 0] }, { at: [6, 0] }], walk: 'file/walk' },
    }
    cast.perform(entry, c, null, null, 2)
    return { cast, root, joint }
  }
  const ready = async ({ cast }, id) => {
    for (let i = 0; i < 50 && !cast.route(id)?.ready; i++)
      await new Promise((done) => setTimeout(done, 5))
    assert.ok(cast.route(id).ready, '경로가 준비되지 않았습니다')
  }
  return {
    scene,
    clock,
    screen,
    asked,
    walker,
    ready,
    dispose() {
      scene.dispose()
      engine.dispose()
    },
  }
}

test('화면 밖 캐릭터는 자세 없이 경로만 나아가고, 들어오면 그리기를 깨운다', async () => {
  const s = await stage()
  try {
    const a = s.walker('a')
    await s.ready(a, 'a')
    const frame = () => s.scene.onBeforeAnimationsObservable.notifyObservers()

    // Off screen: it needs no frames, its joints are left as they were and
    // its place still follows the time.
    s.clock.ms = 1000
    assert.equal(a.cast.animating(), false)
    const early = a.root.position.clone()
    frame()
    const untouched = a.joint.position.y
    s.clock.ms = 5000
    assert.equal(a.cast.animating(), false)
    frame()
    assert.ok(
      a.root.position.subtract(early).length() > 0.1,
      '화면 밖에서 경로가 나아가지 않았습니다',
    )
    assert.equal(a.joint.position.y, untouched)
    assert.equal(s.asked.at(-1).reach, 2)
    assert.deepEqual(a.cast.stats(), { total: 1, posed: 0 })

    // The place depends on the time alone, not on the frames in between.
    // A second cast that began at the same moment and saw none of them.
    const late = s.clock.ms
    s.clock.ms = 0
    const b = s.walker('a')
    s.clock.ms = late
    await s.ready(b, 'a')
    b.cast.animating()
    assert.ok(b.root.position.subtract(a.root.position).length() < 1e-6)

    // Between two looks the answer is kept; the next look sees it walk in.
    s.screen.shows = true
    s.clock.ms += 100
    assert.equal(a.cast.animating(), false)
    s.clock.ms += 200
    assert.equal(a.cast.animating(), true)
    assert.deepEqual(a.cast.stats(), { total: 1, posed: 1 })
    frame()
    assert.notEqual(
      a.joint.position.y,
      untouched,
      '보이는 캐릭터의 자세를 쓰지 않았습니다',
    )

    // The studio's rehearsed character shows whatever the screen says.
    s.screen.shows = false
    a.cast.rehearse('a', true)
    s.clock.ms += 300
    assert.equal(a.cast.animating(), true)
  } finally {
    s.dispose()
  }
})
