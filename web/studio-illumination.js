import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { RectAreaLight } from '@babylonjs/core/Lights/rectAreaLight'
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight'
import { Light } from '@babylonjs/core/Lights/light'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { FileToolsOptions } from '@babylonjs/core/Misc/fileTools'
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator'
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent'
import '@babylonjs/core/Shaders/shadowMap.vertex'
import '@babylonjs/core/Shaders/shadowMap.fragment'
import { roomLights } from './room-lights.js'
import { studioDisplay } from './studio-display.js'

// Babylon requests this coefficient table when the first rectangle is created.
// Route only that dependency to the bundled copy, including during offline editing.
const preprocess = FileToolsOptions.PreprocessUrl
FileToolsOptions.PreprocessUrl = (url) =>
  url === 'https://assets.babylonjs.com/core/areaLights/areaLightsLTC.bin'
    ? '/core/areaLights/areaLightsLTC.bin'
    : preprocess(url)

const fixed = 1,
  live = 2
export function studioIllumination(scene, rooms, meshes, originals) {
  const host = [...rooms.values()].find(
    (n) => n.metadata?.gltf?.extras?.studioLighting,
  )
  if (!host)
    throw Error('편집용 방 조명 데이터가 없습니다. 모델을 다시 준비하세요.')
  const profile = JSON.parse(host.metadata.gltf.extras.studioLighting)
  let relighting = false
  const sourceIds = new Set(originals.map((l) => l.id))
  const importedSources = scene.lights.filter((l) =>
    sourceIds.has(l.parent?.metadata?.gltf?.extras?.sourceLightId),
  )
  const applyDisplay = studioDisplay(scene, profile.lut, () =>
    relighting ? profile.ambientField : profile.field,
  )
  // Punctual glTF lights use candela; Blender exports radiant power using 683 lm/W.
  for (const light of scene.lights) {
    light.specular.copyFrom(light.diffuse)
    light.diffuse = Color3.Black()
    light.intensity /= 683
    light.includeOnlyWithLayerMask = live
  }
  const panels = profile.areas.map((p, index) => {
    const transform = new TransformNode('면광원 ' + index, scene)
    transform.position.copyFromFloats(...p.position)
    transform.rotationQuaternion = Quaternion.FromArray(p.rotation)
    const light = new RectAreaLight(
      '제작 면광원',
      Vector3.Zero(),
      p.width,
      p.height,
      scene,
    )
    light.parent = transform
    light.specular = Color3.FromArray(p.color)
    light.diffuse = Color3.Black()
    light.intensity = p.energy / (Math.PI * Math.max(0.001, p.width * p.height))
    light.includeOnlyWithLayerMask = live
    return {
      light,
      panel: p,
      direction: Vector3.TransformNormal(
        new Vector3(0, 0, -1),
        transform.computeWorldMatrix(true),
      ).normalize(),
    }
  })
  // Keep one shadow map for movable geometry. The baked room receives only
  // this light's shadow, retaining its authored light everywhere else.
  const key = panels.reduce(
    (best, p) => (!best || p.panel.energy > best.panel.energy ? p : best),
    null,
  )
  const direction = key?.direction ?? new Vector3(-0.4, -1, -0.3)
  const sun = new DirectionalLight('가구 그림자', direction, scene)
  sun.position = key
    ? Vector3.FromArray(key.panel.position)
    : direction.scale(-70)
  sun.lightmapMode = Light.LIGHTMAP_SHADOWSONLY
  sun.includeOnlyWithLayerMask = fixed
  sun.renderPriority = 10
  sun.shadowMinZ = -150
  sun.shadowMaxZ = 150
  const shadow = new ShadowGenerator(1024, sun)
  shadow.usePercentageCloserFiltering = true
  shadow.darkness = 0.55
  shadow.bias = 0.00015
  const white = RawTexture.CreateRGBATexture(
    new Uint8Array([255, 255, 255, 255]),
    1,
    1,
    scene,
    false,
  )
  const staticMaterials = new Map()
  const receivers = new Map()
  const receiverMaterials = new Map()
  const fixedSurfaces = new Set(),
    liveSurfaces = new Set()
  let fixtureSlots = 0
  function style(material) {
    liveSurfaces.add(material)
    material.maxSimultaneousLights = 8 + fixtureSlots
    applyDisplay(material)
  }
  function belongsToItem(node) {
    for (; node; node = node.parent)
      if (node.metadata?.gltf?.extras?.itemId) return true
    return false
  }
  for (const mesh of meshes) {
    const material = mesh.material
    if (!material) continue
    if (material.metadata?.gltf?.extras?.riragiBaked) {
      if (material.metadata.gltf.extras.studioReceiver) {
        let raw = receiverMaterials.get(material)
        if (!raw) {
          raw = material.clone(material.name + ' · 실시간 재질')
          raw.emissiveTexture = null
          raw.emissiveColor = Color3.Black()
          raw.metallic = 0
          raw.roughness = 1
          style(raw)
          material.albedoTexture = material.emissiveTexture
          material.emissiveTexture = null
          material.emissiveColor = Color3.Black()
          receiverMaterials.set(material, raw)
        }
        receivers.set(mesh, { raw, baked: material })
      }
      fixedSurfaces.add(material)
      material.maxSimultaneousLights = 1
      mesh.layerMask = fixed
      mesh.receiveShadows = true
      material.unlit = false
      material.metallic = 0
      material.metallicF0Factor = 0
      material.lightmapTexture = white
    } else {
      mesh.layerMask = live
      if (!belongsToItem(mesh) && material.albedoColor && !material.unlit) {
        if (!staticMaterials.has(material)) {
          const copy = material.clone(material.name + ' · 미리보기')
          style(copy)
          staticMaterials.set(material, copy)
        }
        mesh.material = staticMaterials.get(material)
      }
    }
  }
  const roomPanels = new Map()
  for (const [id, node] of rooms) {
    const center = node.getAbsolutePosition()
    const score = ({ panel, direction }) => {
      const delta = center.subtract(Vector3.FromArray(panel.position))
      return (
        (panel.energy *
          Math.max(0, Vector3.Dot(delta.normalizeToNew(), direction))) /
        Math.max(1, delta.lengthSquared())
      )
    }
    roomPanels.set(
      id,
      [...panels].sort((a, b) => score(b) - score(a)).slice(0, 4),
    )
  }
  const syncFixtures = roomLights(scene, rooms)
  let membership
  return {
    style(material) {
      if (material.albedoColor && !material.unlit) style(material)
    },
    update(instances, lights, sources, changed) {
      const switched = relighting !== changed
      if (switched) {
        relighting = changed
        for (const [mesh, { raw, baked }] of receivers)
          mesh.material = changed ? raw : baked
        for (const light of importedSources) light.setEnabled(!changed)
        sun.setEnabled(!changed)
      }
      // Tint, slider and metadata edits reuse the same light and caster lists.
      const unchanged =
        membership?.size === instances.size &&
        [...instances.values()].every(
          (node) => membership.get(node) === node.parent,
        )
      const count = syncFixtures(
        changed ? [...lights, ...sources] : lights,
        !unchanged || switched,
        sourceIds,
      )
      if (count !== fixtureSlots) {
        fixtureSlots = count
        for (const material of fixedSurfaces)
          material.maxSimultaneousLights = 1 + count
        for (const material of liveSurfaces)
          material.maxSimultaneousLights = 8 + count
      }
      if (unchanged && !switched) return
      membership = new Map(
        [...instances.values()].map((node) => [node, node.parent]),
      )
      const active = shadow.getShadowMap()
      active.renderList = [...instances.values()].flatMap((node) =>
        node.getChildMeshes(),
      )
      const assigned = new Map(panels.map((p) => [p, []]))
      for (const [id, room] of rooms) {
        const geometry = room
          .getChildMeshes()
          .filter((mesh) => mesh.layerMask === live && mesh.isEnabled())
        for (const panel of roomPanels.get(id))
          assigned.get(panel).push(...geometry)
      }
      for (const [p, list] of assigned) {
        p.light.includedOnlyMeshes = list
        p.light.setEnabled(list.length > 0 && !(changed && p.panel.source))
      }
    },
  }
}
