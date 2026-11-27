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

const standInHeight = 4.6
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
 * `onLoad()` runs when a model finishes loading so characters can respawn.
 * `fileUrl(id)` gives a library file's address (the studio's by default);
 * `standIn` draws a placeholder while a model loads or is missing; `shadows`
 * lays a soft round shadow under each character.
 */
export function characterLayer(
  world,
  {
    onLoad,
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

  world.keepDrawing(() => {
    for (const entry of cast.values()) if (entry.group?.isPlaying) return true
    return false
  })
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
        play(entry, characterMotion(layout, c))
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
     * How clay keeps the face: 'vertices' (the model's marked vertices),
     * 'giraffe' (by height on a giraffe skeleton) or null.
     */
    protection: (id) => cast.get(id)?.protection ?? null,
    /** True when clay keeps the character's face by the giraffe rule. */
    head: (id) => !!cast.get(id)?.head,
    /** True while the character is playing a clip (for tests and the inspector). */
    playing(id) {
      return !!cast.get(id)?.group?.isPlaying
    },
  })
}
