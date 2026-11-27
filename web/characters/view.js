import { CLAY_PROTECT_KIND } from '../clay-protect-loader.js'
import { giraffeProportions, restPose } from './pose.js'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'

// What a character looks like in the scene: its model cloned with its own
// skeleton, its wearables, the shadow under it, the translucent stand-in
// shown while a model loads or is missing, and the nodes a click selects it
// by. This module does not know routes or timetables.

const standInHeight = 4.6

/**
 * `standIn` draws a placeholder while a model loads or is missing; `shadows`
 * lays a soft round shadow under each character.
 */
export function characterView(world, { standIn: showStandIn, shadows }) {
  const { scene, rooms } = world
  let standIn = null
  let shadowMaterial = null
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
        rest = restPose(root.getDescendants(false))
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
      }
    },
    /** Takes a spawned character out of the scene. */
    release(body) {
      for (const node of [body.root, ...body.root.getDescendants(false)])
        world.owners.delete(node)
      body.proportions?.dispose()
      body.root.dispose(false, false)
      for (const skeleton of body.skeletons) skeleton.dispose()
    },
    /**
     * Shows character `c` as placed: its wearables, room, place, facing,
     * size and body proportions. `info` is its model's library entry.
     */
    place(body, c, info) {
      for (const [id, nodes] of body.wear)
        for (const node of nodes) node.setEnabled(!!c.wear?.includes(id))
      // 100% is the model's default height; the stand-in is standIn tall.
      const fit = info
        ? info.height / (body.file ? info.measured : standInHeight)
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
