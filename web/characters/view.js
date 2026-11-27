import { CLAY_PROTECT_KIND } from '../clay-protect-loader.js'
import { giraffeProportions, restPose } from './pose.js'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js'
import { Matrix } from '@babylonjs/core/Maths/math.vector.js'
import '@babylonjs/core/Meshes/thinInstanceMesh.js'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js'
import { Color3 } from '@babylonjs/core/Maths/math.color.js'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.js'

// What a character looks like in the scene: its model cloned with its own
// skeleton, its wearables and reduced levels, the shadow under it, the translucent stand-in
// shown while a model loads or is missing, and the nodes a click selects it
// by. This module does not know routes or timetables.

/** How tall the stand-in is, in metres. */
export const STAND_IN_HEIGHT = 4.6

/**
 * The node drawn for one part of a model at reduced level `level` (0 is the
 * original). `levels` maps a level to the node that stands in at it. A part
 * without that level uses the nearest finer one it has.
 */
export function levelNode(original, levels, level) {
  for (let l = level; l > 0; l--) if (levels.has(l)) return levels.get(l)
  return original
}

/**
 * `standIn` draws a placeholder while a model loads or is missing; `shadows`
 * lays a soft round shadow under each character.
 */
export function characterView(world, { standIn: showStandIn, shadows }) {
  const { scene, rooms } = world
  let standIn = null
  function standInMaterial() {
    standIn ??= Object.assign(new StandardMaterial('캐릭터 자리', scene), {
      diffuseColor: Color3.FromHexString('#d9a05b'),
      alpha: 0.45,
    })
    return standIn
  }
  // Every shadow is one instance of a single soft round disc, so they all
  // take one draw. Each follows its character's root: root → disc radius.
  const shadowed = new Map()
  const underfoot = Matrix.RotationX(Math.PI / 2).multiply(
    Matrix.Translation(0, 0.02, 0),
  )
  const sized = new Matrix()
  const placed = new Matrix()
  let shadowDisc = null
  let shadowPlaces = null
  function drawShadows() {
    if (!shadowDisc) {
      if (!shadowed.size) return
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
      shadowDisc = MeshBuilder.CreateDisc('캐릭터 그림자', { radius: 1 }, scene)
      shadowDisc.isPickable = false
      // Instances are placed all over the world; the disc's own bounds
      // say nothing about where they are.
      shadowDisc.alwaysSelectAsActiveMesh = true
      shadowDisc.material = Object.assign(
        new StandardMaterial('캐릭터 그림자', scene),
        {
          diffuseTexture: texture,
          useAlphaFromDiffuseTexture: true,
          disableLighting: true,
          emissiveColor: Color3.Black(),
          backFaceCulling: false,
        },
      )
      world.hideFromGlass(shadowDisc)
    }
    shadowDisc.setEnabled(shadowed.size > 0)
    if (!shadowed.size) return
    if (shadowPlaces?.length !== shadowed.size * 16) {
      shadowPlaces = new Float32Array(shadowed.size * 16)
      shadowDisc.thinInstanceSetBuffer('matrix', shadowPlaces, 16, false)
    }
    let at = 0
    for (const [root, radius] of shadowed) {
      Matrix.ScalingToRef(radius, radius, radius, sized)
      sized.multiplyToRef(underfoot, placed)
      placed.multiplyToRef(root.computeWorldMatrix(true), sized)
      sized.copyToArray(shadowPlaces, at)
      at += 16
    }
    shadowDisc.thinInstanceBufferUpdated('matrix')
  }
  if (shadows) {
    const drawn = scene.onBeforeRenderObservable.add(drawShadows)
    scene.onDisposeObservable.addOnce(() =>
      scene.onBeforeRenderObservable.remove(drawn),
    )
  }
  // Switches on what the character wears, each part at the body's level.
  function dress(body) {
    const worn = new Map()
    for (const [id, nodes] of body.wear)
      for (const node of nodes) worn.set(node, body.wearing.includes(id))
    for (const [node, on] of worn)
      if (!body.parts.has(node)) node.setEnabled(on)
    for (const [original, levels] of body.parts) {
      const shown = levelNode(original, levels, body.level)
      const on = worn.get(original) ?? true
      for (const node of [original, ...levels.values()])
        node.setEnabled(on && node === shown)
    }
  }
  return {
    /**
     * Builds character `c` from a model's loaded `container` (library entry
     * `info`), or its stand-in without one. `file` is null for a stand-in.
     */
    spawn(c, file, container, info) {
      const root = new TransformNode('캐릭터 · ' + c.label, scene)
      const nodes = new Map()
      let skeletons = []
      let proportions = null
      let head = false
      let protection = null
      let rest = new Map()
      const wear = new Map()
      // Parts with reduced levels: original node → Map(level → node).
      const parts = new Map()
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
            world.hideFromGlass(node)
          }
        }
        rest = restPose(root.getDescendants(false))
        for (const { id, nodes: names } of info?.wearables ?? [])
          wear.set(id, names.map((name) => nodes.get(name)).filter(Boolean))
        // Reduced levels come cloned with the model; one node per part shows.
        for (const lod of info?.lods ?? []) {
          const original = nodes.get(lod.of)
          const node = nodes.get(lod.node)
          if (!original || !node) continue
          if (!parts.has(original)) parts.set(original, new Map())
          parts.get(original).set(lod.level, node)
        }
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
        if (shadows) shadowed.set(root, (info?.measured ?? 1) * 0.24)
      } else if (showStandIn) {
        const body = MeshBuilder.CreateCapsule(
          '캐릭터 자리',
          { height: STAND_IN_HEIGHT, radius: 0.55 },
          scene,
        )
        body.position.y = STAND_IN_HEIGHT / 2
        body.material = standInMaterial()
        body.parent = root
      }
      for (const node of [root, ...root.getDescendants(false)])
        world.owners.set(node, { type: 'character', id: c.id })
      return {
        root,
        nodes,
        skeletons,
        file: container ? file : null,
        proportions,
        head,
        protection,
        wear,
        rest,
        parts,
        level: 0,
        wearing: [],
      }
    },
    /**
     * Draws the character at reduced level `level` (0 is the original).
     * Its place, pose, proportions and wearables stay as they are.
     */
    setLevel(body, level) {
      if (body.level === level) return
      body.level = level
      dress(body)
    },
    /** Takes a spawned character out of the scene. */
    release(body) {
      for (const node of [body.root, ...body.root.getDescendants(false)])
        world.owners.delete(node)
      shadowed.delete(body.root)
      body.proportions?.dispose()
      body.root.dispose(false, false)
      for (const skeleton of body.skeletons) skeleton.dispose()
    },
    /**
     * Shows character `c` as placed: its wearables, room, place, facing,
     * size and body proportions. `info` is its model's library entry.
     */
    place(body, c, info) {
      body.wearing = c.wear ?? []
      dress(body)
      // 100% is the model's default height; the stand-in is standIn tall.
      const fit = info
        ? info.height / (body.file ? info.measured : STAND_IN_HEIGHT)
        : 1
      body.root.parent = rooms.get(c.room) ?? null
      body.root.position.set(...c.position)
      body.root.rotationQuaternion = null
      body.root.rotation.set(0, (c.yaw * Math.PI) / 180, 0)
      body.root.scaling.setAll(c.scale * fit)
      body.proportions?.set(c.proportions)
    },
  }
}
