import { giraffeProportions } from './giraffe-proportions.js'
import { motionPhase } from './edit-ops.js'
import { CLAY_PROTECT_KIND } from './clay-protect-loader.js'
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader'
import { AnimationGroup } from '@babylonjs/core/Animations/animationGroup'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import {
  routeAt,
  routeClips,
  routeDefaults,
  routeTimeline,
  strideFromSamples,
} from '../shared/character-route.mjs'
import '@babylonjs/core/Animations/animatable'
import '@babylonjs/loaders/glTF/2.0'

// Characters in the editing scene. Each library model is read once, when a
// character first needs it, and cloned with its skeleton per character. A
// motion file's clip is copied onto a character by matching node names, so
// a motion plays on every model that shares those joint names. A translucent
// stand-in marks the placement while a model loads or when it is missing.
// A character's scale multiplies its model's default height, and each one
// starts its motion at its own point so copies do not move in step. A list
// of motions plays each clip once, in order or at random, blending between
// them. Wearables listed by the library show when the character wears them.
//
// A character with a route walks it instead. Its place, facing and pose come
// from the route's timetable (shared/character-route.mjs) at the character's
// own clock, so the layer writes the clips' values itself, blended, rather
// than starting animation groups. The clock runs only while the character
// may move, so one that was stopped goes on from where it stood.

const standInHeight = 4.6
// Yaw a model shows when it walks toward +Z of its room.
const FORWARD = 0
const POSE = ['position', 'rotationQuaternion', 'scaling']
const STRIDE_SAMPLES = 48
const radians = Math.PI / 180
const adminFile = (id) => '/api/admin/characters/files/' + id + '.glb'

/**
 * The character's motion, play order and speed, or the world default where
 * it has none. `motion` is null (still), one clip or a list of clips.
 */
export function characterMotion(layout, c) {
  const world = layout.defaults?.character ?? {}
  return {
    motion: c.motion !== undefined ? c.motion : (world.motion ?? null),
    order: c.order ?? world.order ?? 'sequence',
    speed: c.speed ?? world.speed ?? 1,
  }
}

/** A motion value as a list of clips (empty when still). */
export const motionList = (motion) => (motion == null ? [] : [motion].flat())

/** The model a character shows: its own, else the library's fallback. */
export const characterModel = (library, c) => c.model ?? library.fallback

/**
 * `onLoad()` runs when a model finishes loading so characters can respawn;
 * `onRoute(id)` when a character's route has read its clips and can walk.
 * `fileUrl(id)` gives a library file's address (the studio's by default);
 * `standIn` draws a placeholder while a model loads or is missing; `shadows`
 * lays a soft round shadow under each character.
 */
export function characterLayer(
  world,
  {
    onLoad,
    onRoute,
    fileUrl = adminFile,
    standIn: showStandIn = true,
    shadows = false,
  } = {},
) {
  const { scene, rooms } = world
  const cast = new Map()
  const models = new Map()
  const motions = new Map()
  let library = { models: [], motions: [], fallback: null }
  let standIn = null
  let shadowMaterial = null
  // Characters allowed to move; null lets every one move.
  let active = null
  const moving = (entry) => !active || active.has(entry.id)
  // The studio's selected character: it stands at its first point, or walks
  // its route from the start while `playing`.
  let rehearsal = null
  const held = (entry) => rehearsal?.id === entry.id && !rehearsal.playing
  const walking = (entry) =>
    entry.route?.timeline?.duration > 0 && !held(entry) && moving(entry)

  world.keepDrawing(() => {
    for (const entry of cast.values())
      if (entry.group?.isPlaying || walking(entry)) return true
    return false
  })
  const engine = scene.getEngine()
  const step = scene.onBeforeAnimationsObservable.add(() => {
    // A frame after a sleep must not carry the whole pause.
    const dt = Math.min(engine.getDeltaTime() / 1000, 0.1)
    for (const entry of cast.values()) {
      const route = entry.route
      if (!route) continue
      if (walking(entry)) route.clock += dt
      else if (!route.dirty) continue
      route.dirty = false
      if (held(entry) || !(route.timeline?.duration > 0)) stand(entry)
      else follow(entry)
    }
  })
  scene.onDisposeObservable.addOnce(() =>
    scene.onBeforeAnimationsObservable.remove(step),
  )
  const load = (id) =>
    LoadAssetContainerAsync(fileUrl(id), scene, { pluginExtension: '.glb' })

  const info = (id) => library.models.find((m) => m.id === id)
  // The loaded file of a model, keyed by file so a replaced file reloads:
  // { file, container, failed } once settled; container is null until then.
  function model(id) {
    const m = id && info(id)
    if (!m) return null
    let slot = models.get(m.file)
    if (!slot) {
      slot = { file: m.file, container: null, failed: false }
      slot.loading = load(m.file)
        .then((container) => (slot.container = container))
        .catch(() => (slot.failed = true))
        .finally(() => onLoad?.())
      models.set(m.file, slot)
    }
    return slot
  }
  function motionFile(id) {
    if (!motions.has(id))
      motions.set(
        id,
        load(id).catch((e) => {
          motions.delete(id)
          throw e
        }),
      )
    return motions.get(id)
  }
  function standInMaterial() {
    standIn ??= Object.assign(new StandardMaterial('캐릭터 자리', scene), {
      diffuseColor: Color3.FromHexString('#d9a05b'),
      alpha: 0.45,
    })
    return standIn
  }
  // One soft round texture shared by every shadow disc.
  function shadowDisc(radius) {
    if (!shadowMaterial) {
      const texture = new DynamicTexture('캐릭터 그림자', 128, scene, false)
      const ctx = texture.getContext()
      const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
      g.addColorStop(0, 'rgba(0,0,0,0.42)')
      g.addColorStop(0.55, 'rgba(0,0,0,0.2)')
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, 128, 128)
      texture.hasAlpha = true
      texture.update()
      shadowMaterial = Object.assign(
        new StandardMaterial('캐릭터 그림자', scene),
        {
          diffuseTexture: texture,
          useAlphaFromDiffuseTexture: true,
          disableLighting: true,
          emissiveColor: Color3.Black(),
          backFaceCulling: false,
        },
      )
    }
    const disc = MeshBuilder.CreateDisc('캐릭터 그림자', { radius }, scene)
    disc.rotation.x = Math.PI / 2
    disc.position.y = 0.02
    disc.isPickable = false
    disc.material = shadowMaterial
    return disc
  }
  function register(entry, id) {
    for (const node of [entry.root, ...entry.root.getDescendants(false)])
      world.owners.set(node, { type: 'character', id })
  }
  function release(entry) {
    for (const node of [entry.root, ...entry.root.getDescendants(false)])
      world.owners.delete(node)
    for (const group of entry.groups) group.dispose()
    entry.proportions?.dispose()
    entry.root.dispose(false, false)
    for (const skeleton of entry.skeletons) skeleton.dispose()
  }
  function spawn(c, file, container, info) {
    const root = new TransformNode('캐릭터 · ' + c.label, scene)
    const nodes = new Map()
    let skeletons = []
    let proportions = null
    let head = false
    let protection = null
    const wear = new Map()
    // The pose as exported: what a route blends with where a clip is silent.
    const rest = new Map()
    if (container) {
      const copy = container.instantiateModelsToScene((name) => name, false, {
        doNotInstantiate: true,
      })
      // Clips embedded in the model play as library motions instead.
      for (const group of copy.animationGroups) group.dispose()
      skeletons = copy.skeletons
      for (const node of copy.rootNodes) node.parent = root
      for (const node of root.getDescendants(false)) {
        nodes.set(node.name, node)
        rest.set(node, {
          position: node.position.clone(),
          rotationQuaternion: (
            node.rotationQuaternion ?? Quaternion.FromEulerVector(node.rotation)
          ).clone(),
          scaling: node.scaling.clone(),
        })
        if (node.getTotalVertices?.()) {
          node.isPickable = true
          node.receiveShadows = true
          world.styleMaterial(node.material)
        }
      }
      for (const { id, nodes: names } of info?.wearables ?? [])
        wear.set(id, names.map((name) => nodes.get(name)).filter(Boolean))
      proportions = giraffeProportions(scene, nodes)
      // Clay keeps the face: the model's own marked vertices, else the
      // giraffe rule by height for a giraffe skeleton, else nothing.
      const meshes = root
        .getChildMeshes(false)
        .filter((mesh) => mesh.getTotalVertices())
      const own = meshes.some((mesh) =>
        mesh.isVerticesDataPresent(CLAY_PROTECT_KIND),
      )
      protection = own ? 'vertices' : proportions ? 'giraffe' : null
      head = !own && !!proportions
      if (head) world.includeClayGiraffe(meshes)
      else for (const mesh of meshes) world.includeClay(mesh)
      if (shadows) shadowDisc((info?.measured ?? 1) * 0.24).parent = root
    } else if (showStandIn) {
      const body = MeshBuilder.CreateCapsule(
        '캐릭터 자리',
        { height: standInHeight, radius: 0.55 },
        scene,
      )
      body.position.y = standInHeight / 2
      body.material = standInMaterial()
      body.parent = root
    }
    const entry = {
      id: c.id,
      root,
      nodes,
      skeletons,
      file: container ? file : null,
      proportions,
      head,
      protection,
      wear,
      groups: [],
      group: null,
      motionKey: null,
      rest,
      // Route clips read for this character and strides measured from them.
      tracks: new Map(),
      strides: new Map(),
      route: null,
    }
    register(entry, c.id)
    return entry
  }
  // One clip of a motion file copied onto the character's nodes, or null.
  async function clipGroup(entry, motion) {
    const [file, ...rest] = motion.split('/')
    const clip = rest.join('/')
    const container = await motionFile(file).catch(() => null)
    const source = container?.animationGroups.find((a) => a.name === clip)
    if (!source) return null
    const group = new AnimationGroup(clip + ' · ' + entry.id, scene)
    for (const { animation, target } of source.targetedAnimations) {
      const node = entry.nodes.get(target.name)
      if (node) group.addTargetedAnimation(animation, node)
    }
    return group
  }
  // ---- Routes ----
  // One clip's tracks on this character's nodes and its length in seconds.
  function clipTracks(entry, motion) {
    if (!entry.tracks.has(motion))
      entry.tracks.set(
        motion,
        (async () => {
          const [file, ...rest] = motion.split('/')
          const name = rest.join('/')
          const container = await motionFile(file).catch(() => null)
          const source = container?.animationGroups.find((a) => a.name === name)
          if (!source) return null
          const tracks = []
          let fps = 60
          for (const { animation, target } of source.targetedAnimations) {
            const node = entry.nodes.get(target.name)
            if (!node || !POSE.includes(animation.targetProperty)) continue
            fps = animation.framePerSecond
            tracks.push({ node, prop: animation.targetProperty, animation })
          }
          const duration = (source.to - source.from) / fps
          return tracks.length && duration > 0
            ? { tracks, from: source.from, fps, duration }
            : null
        })(),
      )
    return entry.tracks.get(motion)
  }
  // Writes the blend of one or two timetable layers onto the nodes.
  function pose(route, layers) {
    const frames = layers.map((layer) => {
      const clip = layer.clip && route.clips.get(layer.clip)
      if (!clip) return null
      const time = layer.loop
        ? ((layer.time % clip.duration) + clip.duration) % clip.duration
        : Math.min(Math.max(layer.time, 0), clip.duration)
      return { name: layer.clip, frame: clip.from + time * clip.fps }
    })
    const value = (channel, at) =>
      (at && channel.by.get(at.name)?.evaluate(at.frame)) ?? channel.rest
    for (const channel of route.channels) {
      const a = value(channel, frames[0])
      if (layers.length < 2) channel.value.copyFrom(a)
      else {
        const b = value(channel, frames[1])
        if (channel.prop === 'rotationQuaternion')
          Quaternion.SlerpToRef(a, b, layers[1].weight, channel.value)
        else Vector3.LerpToRef(a, b, layers[1].weight, channel.value)
      }
      // Assigned, not copied into: body proportions swap these objects.
      channel.node[channel.prop] = channel.value
    }
  }
  function settle(entry, x, z, yaw) {
    const { position } = entry.route.base
    entry.root.position.set(position[0] + x, position[1], position[2] + z)
    entry.root.rotation.y = yaw * radians
  }
  // At the first point as placed, standing.
  function stand(entry) {
    const route = entry.route
    settle(entry, 0, 0, route.base.yaw)
    pose(route, [{ clip: route.idle, time: 0, weight: 1, loop: true }])
  }
  function follow(entry) {
    const route = entry.route
    const at = routeAt(route.timeline, route.clock)
    settle(entry, at.x, at.z, at.yaw ?? route.base.yaw)
    pose(route, at.layers)
  }
  // Ground one cycle of the walk covers, in the model's own units.
  function measureStride(entry, route, name, clip) {
    if (entry.strides.has(name)) return entry.strides.get(name)
    const joints = [...new Set(clip.tracks.map((t) => t.node))]
    const order = entry.root.getDescendants(false)
    const samples = []
    for (let i = 0; i < STRIDE_SAMPLES; i++) {
      const time = (clip.duration * i) / STRIDE_SAMPLES
      pose(route, [{ clip: name, time, weight: 1, loop: true }])
      entry.root.computeWorldMatrix(true)
      for (const node of order) node.computeWorldMatrix(true)
      const inverse = entry.root.getWorldMatrix().clone().invert()
      samples.push(
        joints.map((node) =>
          Vector3.TransformCoordinates(
            node.getAbsolutePosition(),
            inverse,
          ).asArray(),
        ),
      )
    }
    const stride = strideFromSamples(samples)
    entry.strides.set(name, stride)
    return stride
  }
  // Puts the nodes a route moved back and lets a motion play again.
  function leave(entry) {
    const route = entry.route
    if (!route) return
    for (const channel of route.channels) {
      channel.value.copyFrom(channel.rest)
      channel.node[channel.prop] = channel.value
    }
    entry.route = null
    entry.root.rotationQuaternion = null
  }
  async function walk(entry, c, m) {
    const key = JSON.stringify([c.route, c.scale, m?.stride, m?.height])
    const base = { position: c.position, yaw: c.yaw }
    if (entry.route?.key === key) {
      entry.route.base = base
      entry.route.dirty = true
      return
    }
    // The motion it played where it stood stops.
    for (const group of entry.groups) group.dispose()
    entry.groups = []
    entry.group = null
    entry.motionKey = null
    const before = entry.route
    const route = (entry.route = {
      key,
      base,
      idle: c.route.idle ?? null,
      clips: new Map(),
      channels: before?.channels ?? [],
      timeline: null,
      clock: 0,
      dirty: true,
    })
    if (!entry.file) return
    const names = [...new Set(routeClips(c.route))]
    const loaded = await Promise.all(names.map((n) => clipTracks(entry, n)))
    // A newer edit may have replaced this one while the files loaded.
    if (entry.route !== route || cast.get(entry.id) !== entry) return
    names.forEach((name, i) => loaded[i] && route.clips.set(name, loaded[i]))
    const channels = new Map()
    for (const [name, clip] of route.clips)
      for (const { node, prop, animation } of clip.tracks) {
        const id = node.uniqueId + prop
        if (!channels.has(id)) {
          const rest = entry.rest.get(node)[prop]
          channels.set(id, {
            node,
            prop,
            rest,
            value: rest.clone(),
            by: new Map(),
          })
        }
        channels.get(id).by.set(name, animation)
      }
    // Nodes only the route before moved go back to rest.
    for (const channel of before?.channels ?? [])
      if (!channels.has(channel.node.uniqueId + channel.prop)) {
        channel.value.copyFrom(channel.rest)
        channel.node[channel.prop] = channel.value
      }
    route.channels = [...channels.values()]
    route.dirty = true
    world.wake()
    const steps = route.clips.get(c.route.walk)
    route.loaded = true
    // Without its walk it would slide, so it stays at the first point.
    if (!steps) return void onRoute?.(entry.id)
    const fit = m ? m.height / m.measured : 1
    route.measured = measureStride(entry, route, c.route.walk, steps) * fit
    const stride = m?.stride ?? route.measured
    // Speed at which the feet do not slide, for this character's size.
    route.natural = (stride * c.scale) / steps.duration
    const known = route.natural > 0.01
    route.speed = c.route.speed ?? (known ? route.natural : routeDefaults.speed)
    route.pace = known ? route.speed / route.natural : 1
    route.timeline = routeTimeline(
      { ...c.route, speed: route.speed },
      {
        duration: (clip) => route.clips.get(clip)?.duration,
        radius: 0.6 * c.scale,
        forward: FORWARD,
        walkRate: Math.min(2, Math.max(0.5, route.pace)),
      },
    )
    route.clock =
      rehearsal?.id === entry.id
        ? 0
        : motionPhase(entry.id) * route.timeline.duration
    onRoute?.(entry.id)
  }

  async function play(entry, { motion, order, speed }) {
    const list = motionList(motion)
    const key = entry.file ? JSON.stringify([list, order, speed]) : null
    if (entry.motionKey === key) return
    entry.motionKey = key
    for (const group of entry.groups) group.dispose()
    entry.groups = []
    entry.group = null
    if (!key || !list.length) return
    const loaded = await Promise.all(list.map((m) => clipGroup(entry, m)))
    const groups = loaded.filter(Boolean)
    // A newer edit may have replaced this one while the files loaded.
    if (entry.motionKey !== key || cast.get(entry.id) !== entry) {
      for (const group of groups) group.dispose()
      return
    }
    if (!groups.length) return
    entry.groups = groups
    const phase = motionPhase(entry.id)
    const start = (index, at) => {
      const group = groups[index]
      entry.group = group
      group.start(groups.length === 1, speed)
      if (at !== undefined)
        group.goToFrame(group.from + (group.to - group.from) * at)
    }
    if (groups.length > 1)
      groups.forEach((group, index) => {
        group.enableBlending = true
        group.blendingSpeed = 0.05
        group.onAnimationGroupEndObservable.add(() => {
          if (entry.groups !== groups) return
          let next = (index + 1) % groups.length
          if (order === 'random') {
            next = Math.floor(Math.random() * (groups.length - 1))
            if (next >= index) next++
          }
          start(next)
        })
      })
    // Copies start at different points: in the clip, or in the list.
    if (groups.length === 1) start(0, phase)
    else start(Math.floor(phase * groups.length), (phase * groups.length) % 1)
    if (!moving(entry)) entry.group.pause()
  }

  return Object.freeze({
    /** Uses a new library; characters whose model left it respawn. */
    setLibrary(next) {
      library = next
      for (const [file, slot] of models)
        if (!next.models.some((m) => m.file === file)) {
          slot.loading.then(() => slot.container?.dispose())
          models.delete(file)
        }
    },
    update(layout) {
      const list = layout.characters ?? []
      for (const [id, entry] of cast)
        if (!list.some((c) => c.id === id)) {
          release(entry)
          cast.delete(id)
        }
      for (const c of list) {
        const m = info(characterModel(library, c))
        const slot = model(m?.id)
        const container = slot?.container ?? null
        let entry = cast.get(c.id)
        // Respawn when the model or its file changed or finished loading.
        if (entry && entry.file !== (container ? slot.file : null)) {
          release(entry)
          entry = null
        }
        if (!entry) {
          entry = spawn(c, slot?.file, container, m)
          cast.set(c.id, entry)
        }
        for (const [id, nodes] of entry.wear)
          for (const node of nodes) node.setEnabled(!!c.wear?.includes(id))
        // 100% is the model's default height; the stand-in is standIn tall.
        const fit = m ? m.height / (container ? m.measured : standInHeight) : 1
        entry.root.parent = rooms.get(c.room) ?? null
        entry.root.position.set(...c.position)
        entry.root.rotationQuaternion = null
        entry.root.rotation.set(0, (c.yaw * Math.PI) / 180, 0)
        entry.root.scaling.setAll(c.scale * fit)
        entry.proportions?.set(c.proportions)
        if (c.route) walk(entry, c, m)
        else {
          leave(entry)
          play(entry, characterMotion(layout, c))
        }
      }
    },
    /** The node that carries a character's placement, or undefined. */
    root: (id) => cast.get(id)?.root,
    /**
     * 'ready' once the character shows its model, 'loading' while it loads,
     * 'missing' when the model is gone from the library or failed to load.
     */
    state(layout, c) {
      const slot = model(characterModel(library, c))
      if (!slot || slot.failed) return 'missing'
      return cast.get(c.id)?.file === slot.file ? 'ready' : 'loading'
    },
    proportionDimensions: (id) => cast.get(id)?.proportions?.dimensions,
    /** Lets only these character IDs move (null: all); others hold still. */
    setActive(ids) {
      active = ids && new Set(ids)
      for (const entry of cast.values()) {
        if (!entry.group) continue
        if (moving(entry)) entry.group.play(entry.groups.length === 1)
        else entry.group.pause()
      }
    },
    /**
     * The studio's selected character `id` stands at its first point, or
     * walks its route from the start while `playing`. null lets every
     * character walk again from its own starting point.
     */
    rehearse(id, playing = false) {
      const before = rehearsal
      if (before ? before.id === id && before.playing === playing : !id) return
      rehearsal = id ? { id, playing } : null
      for (const entry of cast.values()) {
        const route = entry.route
        if (!route || (entry.id !== id && entry.id !== before?.id)) continue
        route.dirty = true
        route.clock =
          entry.id === id
            ? 0
            : motionPhase(entry.id) * (route.timeline?.duration ?? 0)
      }
      world.wake()
    },
    /**
     * How a character's route plays, or null without one: `loaded` once its
     * clips are read, `ready` when it can walk (false when the walk clip
     * cannot move the model), `speed` and `natural` in m/s, `pace` the walk
     * clip's rate before it is kept between ×0.5 and ×2, `stride` measured
     * in metres at 100% and `duration` of one lap in seconds.
     */
    route(id) {
      const route = cast.get(id)?.route
      if (!route) return null
      return {
        loaded: !!route.loaded,
        ready: !!route.timeline,
        speed: route.speed,
        natural: route.natural,
        pace: route.pace,
        stride: route.measured,
        duration: route.timeline?.duration ?? 0,
      }
    },
    /**
     * How clay keeps the face: 'vertices' (the model's marked vertices),
     * 'giraffe' (by height on a giraffe skeleton) or null.
     */
    protection: (id) => cast.get(id)?.protection ?? null,
    /** True when clay keeps the character's face by the giraffe rule. */
    head: (id) => !!cast.get(id)?.head,
    /** How many characters there are and how many compute a pose each frame. */
    stats() {
      let posed = 0
      for (const entry of cast.values())
        if (entry.group?.isPlaying || walking(entry)) posed++
      return { total: cast.size, posed }
    },
    /** True while the character is playing a clip (for tests and the inspector). */
    playing(id) {
      const entry = cast.get(id)
      return !!entry && (!!entry.group?.isPlaying || walking(entry))
    },
  })
}
