import { giraffeProportions } from './giraffe-proportions.js'
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader'
import { AnimationGroup } from '@babylonjs/core/Animations/animationGroup'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import '@babylonjs/core/Animations/animatable'
import '@babylonjs/loaders/glTF/2.0'

// Giraffes in the editing scene. The rigged model is read once and cloned
// with its skeleton for each giraffe; a motion file's clip is copied onto a
// giraffe by matching node names, so any motion made on the same armature
// plays on every giraffe. A translucent stand-in marks the placement while
// the bundled or uploaded model loads.

const fileUrl = (id) => '/api/admin/giraffes/files/' + id + '.glb'

/** The giraffe's motion and speed, or the world default where it has none. */
export function giraffeMotion(layout, g) {
  const world = layout.defaults?.giraffe ?? {}
  return {
    motion: g.motion !== undefined ? g.motion : (world.motion ?? null),
    speed: g.speed ?? world.speed ?? 1,
  }
}

export function giraffeLayer(world) {
  const { scene, rooms } = world
  const herd = new Map()
  const motions = new Map()
  let model = null,
    modelId,
    loading = null,
    standIn = null
  let generation = 0

  world.keepDrawing(() => {
    for (const entry of herd.values()) if (entry.group?.isPlaying) return true
    return false
  })
  const load = (id) =>
    LoadAssetContainerAsync(fileUrl(id), scene, { pluginExtension: '.glb' })

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
    standIn ??= Object.assign(new StandardMaterial('기린 자리', scene), {
      diffuseColor: Color3.FromHexString('#d9a05b'),
      alpha: 0.45,
    })
    return standIn
  }
  function register(entry, id) {
    for (const node of [entry.root, ...entry.root.getDescendants(false)])
      world.owners.set(node, { type: 'giraffe', id })
  }
  function release(entry) {
    for (const node of [entry.root, ...entry.root.getDescendants(false)])
      world.owners.delete(node)
    entry.group?.dispose()
    entry.proportions?.dispose()
    entry.root.dispose(false, false)
    for (const skeleton of entry.skeletons) skeleton.dispose()
  }
  function spawn(g) {
    const root = new TransformNode('기린 · ' + g.label, scene)
    const nodes = new Map()
    let skeletons = []
    if (model) {
      const copy = model.instantiateModelsToScene((name) => name, false, {
        doNotInstantiate: true,
      })
      // The model's own clips are not motions; motions come from the library.
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
    } else {
      const body = MeshBuilder.CreateCapsule(
        '기린 자리',
        { height: 4.6, radius: 0.55 },
        scene,
      )
      body.position.y = 2.3
      body.material = standInMaterial()
      body.parent = root
    }
    world.includeClayGiraffe(
      root.getChildMeshes().filter((mesh) => mesh.getTotalVertices()),
    )
    const proportions = giraffeProportions(scene, nodes)
    const entry = {
      root,
      nodes,
      skeletons,
      proportions,
      group: null,
      motionKey: null,
    }
    register(entry, g.id)
    return entry
  }
  async function play(entry, { motion, speed }) {
    const key = model ? motion + '@' + speed : null
    if (entry.motionKey === key) return
    entry.motionKey = key
    entry.group?.dispose()
    entry.group = null
    if (!model || !motion) return
    const [file, ...rest] = motion.split('/')
    const clip = rest.join('/')
    const container = await motionFile(file).catch(() => null)
    // A newer edit may have replaced this one while the file loaded.
    if (!container || entry.motionKey !== key || !herd.has(entry.id)) return
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
    /** Loads (or replaces) the rigged model; existing giraffes respawn. */
    async useModel(id) {
      if (id === modelId) return loading
      modelId = id
      const mine = ++generation
      loading = (
        id
          ? load(id)
          : LoadAssetContainerAsync(
              '/api/admin/clay-giraffe?outfit=base',
              scene,
              { pluginExtension: '.glb' },
            )
      )
        .then((container) => {
          if (mine !== generation) {
            container?.dispose()
            return
          }
          model?.dispose()
          model = container
          for (const [gid, entry] of herd) {
            release(entry)
            herd.delete(gid)
          }
        })
        .catch((error) => {
          if (mine === generation) modelId = undefined
          throw error
        })
      return loading
    },
    update(layout) {
      const list = layout.giraffes ?? []
      for (const [id, entry] of herd)
        if (!list.some((g) => g.id === id)) {
          release(entry)
          herd.delete(id)
        }
      for (const g of list) {
        let entry = herd.get(g.id)
        if (!entry) {
          entry = spawn(g)
          entry.id = g.id
          herd.set(g.id, entry)
        }
        entry.root.parent = rooms.get(g.room) ?? null
        entry.root.position.set(...g.position)
        entry.root.rotationQuaternion = null
        entry.root.rotation.set(0, (g.yaw * Math.PI) / 180, 0)
        entry.root.scaling.setAll(g.scale)
        entry.proportions?.set(g.proportions)
        play(entry, giraffeMotion(layout, g))
      }
    },
    /** The node that carries a giraffe's placement, or undefined. */
    root: (id) => herd.get(id)?.root,
    /** Whether a giraffe shows the rigged model (not the stand-in). */
    rigged: () => !!model,
    supportsProportions: (id) => !!herd.get(id)?.proportions,
    /** True while the giraffe is playing a clip (for tests and the inspector). */
    playing(id) {
      return !!herd.get(id)?.group?.isPlaying
    },
  })
}
