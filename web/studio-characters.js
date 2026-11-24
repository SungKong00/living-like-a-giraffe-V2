import { giraffeProportions } from './giraffe-proportions.js'
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader'
import { AnimationGroup } from '@babylonjs/core/Animations/animationGroup'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import '@babylonjs/core/Animations/animatable'
import '@babylonjs/loaders/glTF/2.0'

// Characters in the editing scene. Each library model is read once, when a
// character first needs it, and cloned with its skeleton per character. A
// motion file's clip is copied onto a character by matching node names, so
// a motion plays on every model that shares those joint names. A translucent
// stand-in marks the placement while a model loads or when it is missing.

const fileUrl = (id) => '/api/admin/characters/files/' + id + '.glb'

/** The character's motion and speed, or the world default where it has none. */
export function characterMotion(layout, c) {
  const world = layout.defaults?.character ?? {}
  return {
    motion: c.motion !== undefined ? c.motion : (world.motion ?? null),
    speed: c.speed ?? world.speed ?? 1,
  }
}

/** The model a character shows: its own, else the library's fallback. */
export const characterModel = (library, c) => c.model ?? library.fallback

/** `onLoad()` runs when a model finishes loading so characters can respawn. */
export function characterLayer(world, { onLoad } = {}) {
  const { scene, rooms } = world
  const cast = new Map()
  const models = new Map()
  const motions = new Map()
  let library = { models: [], motions: [], fallback: null }
  let standIn = null

  world.keepDrawing(() => {
    for (const entry of cast.values()) if (entry.group?.isPlaying) return true
    return false
  })
  const load = (id) =>
    LoadAssetContainerAsync(fileUrl(id), scene, { pluginExtension: '.glb' })

  // { container, failed } once settled; a pending promise until then.
  function model(id) {
    if (!id || !library.models.some((m) => m.id === id)) return null
    let slot = models.get(id)
    if (!slot) {
      slot = { container: null, failed: false }
      slot.loading = load(id)
        .then((container) => (slot.container = container))
        .catch(() => (slot.failed = true))
        .finally(() => onLoad?.())
      models.set(id, slot)
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
  function register(entry, id) {
    for (const node of [entry.root, ...entry.root.getDescendants(false)])
      world.owners.set(node, { type: 'character', id })
  }
  function release(entry) {
    for (const node of [entry.root, ...entry.root.getDescendants(false)])
      world.owners.delete(node)
    entry.group?.dispose()
    entry.proportions?.dispose()
    entry.root.dispose(false, false)
    for (const skeleton of entry.skeletons) skeleton.dispose()
  }
  function spawn(c, modelId, container) {
    const root = new TransformNode('캐릭터 · ' + c.label, scene)
    const nodes = new Map()
    let skeletons = []
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
      world.includeClayGiraffe(
        root.getChildMeshes().filter((mesh) => mesh.getTotalVertices()),
      )
    } else {
      const body = MeshBuilder.CreateCapsule(
        '캐릭터 자리',
        { height: 4.6, radius: 0.55 },
        scene,
      )
      body.position.y = 2.3
      body.material = standInMaterial()
      body.parent = root
    }
    const entry = {
      id: c.id,
      root,
      nodes,
      skeletons,
      modelId: container ? modelId : null,
      proportions: container ? giraffeProportions(scene, nodes) : null,
      group: null,
      motionKey: null,
    }
    register(entry, c.id)
    return entry
  }
  async function play(entry, { motion, speed }) {
    const key = entry.modelId ? motion + '@' + speed : null
    if (entry.motionKey === key) return
    entry.motionKey = key
    entry.group?.dispose()
    entry.group = null
    if (!key || !motion) return
    const [file, ...rest] = motion.split('/')
    const clip = rest.join('/')
    const container = await motionFile(file).catch(() => null)
    // A newer edit may have replaced this one while the file loaded.
    if (!container || entry.motionKey !== key || cast.get(entry.id) !== entry)
      return
    const source = container.animationGroups.find((a) => a.name === clip)
    if (!source) return
    const group = new AnimationGroup(clip + ' · ' + entry.id, scene)
    for (const { animation, target } of source.targetedAnimations) {
      const node = entry.nodes.get(target.name)
      if (node) group.addTargetedAnimation(animation, node)
    }
    group.speedRatio = speed
    group.start(true, speed)
    entry.group = group
  }

  return Object.freeze({
    /** Uses a new library; characters whose model left it respawn. */
    setLibrary(next) {
      library = next
      for (const [id, slot] of models)
        if (!next.models.some((m) => m.id === id)) {
          slot.loading.then(() => slot.container?.dispose())
          models.delete(id)
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
        const modelId = characterModel(library, c)
        const slot = model(modelId)
        const container = slot?.container ?? null
        let entry = cast.get(c.id)
        // Respawn when the model changed or finished loading.
        if (entry && entry.modelId !== (container ? modelId : null)) {
          release(entry)
          entry = null
        }
        if (!entry) {
          entry = spawn(c, modelId, container)
          cast.set(c.id, entry)
        }
        entry.root.parent = rooms.get(c.room) ?? null
        entry.root.position.set(...c.position)
        entry.root.rotationQuaternion = null
        entry.root.rotation.set(0, (c.yaw * Math.PI) / 180, 0)
        entry.root.scaling.setAll(c.scale)
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
      const id = characterModel(library, c)
      const slot = model(id)
      if (!slot || slot.failed) return 'missing'
      return cast.get(c.id)?.modelId === id ? 'ready' : 'loading'
    },
    supportsProportions: (id) => !!cast.get(id)?.proportions,
    /** True while the character is playing a clip (for tests and the inspector). */
    playing(id) {
      return !!cast.get(id)?.group?.isPlaying
    },
  })
}
