import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector'
import { PointLight } from '@babylonjs/core/Lights/pointLight'
import { RectAreaLight } from '@babylonjs/core/Lights/rectAreaLight'
import { SpotLight } from '@babylonjs/core/Lights/spotLight'
import { Light } from '@babylonjs/core/Lights/light'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { lightWithDefaults } from '../shared/studio-lights.mjs'

const emitters = {
  point: {
    create: (scene) => new PointLight('점광원', Vector3.Zero(), scene),
    update: (lamp, { energy }) => {
      lamp.intensity = energy / (4 * Math.PI)
    },
  },
  spot: {
    create: (scene) =>
      new SpotLight(
        '스포트라이트',
        Vector3.Zero(),
        new Vector3(0, 0, -1),
        Math.PI / 4,
        1,
        scene,
      ),
    update(lamp, { energy, shape }) {
      lamp.falloffType = Light.FALLOFF_GLTF
      lamp.angle = (shape.angle * Math.PI) / 180
      lamp.innerAngle = lamp.angle * (1 - shape.blend)
      lamp.intensity = energy / (4 * Math.PI)
    },
  },
  area: {
    create: (scene) => new RectAreaLight('면광원', Vector3.Zero(), 1, 1, scene),
    update(lamp, { energy, shape }) {
      lamp.width = shape.width
      lamp.height = shape.height
      lamp.intensity = energy / (Math.PI * shape.width * shape.height)
    },
  },
}

// A room-local mount orients every emitter along its own -Z, as in Blender.
// Rebuild membership only when geometry or room ownership changes.
export function roomLights(scene, rooms) {
  const fixtures = new Map()
  return (rows, membershipChanged) => {
    const ids = new Set(rows.map(({ id }) => id))
    for (const [id, fixture] of fixtures) {
      if (ids.has(id)) continue
      fixture.mount.dispose()
      fixtures.delete(id)
    }
    const counts = new Map()
    for (const row of rows) {
      const light = lightWithDefaults(row)
      const type = light.shape.type
      const room = rooms.get(light.room)
      if (light.enabled) counts.set(room, (counts.get(room) ?? 0) + 1)
      let f = fixtures.get(light.id)
      if (f?.type !== type) {
        f?.mount.dispose()
        f = {
          type,
          mount: new TransformNode(light.id, scene),
          lamp: emitters[type].create(scene),
        }
        f.lamp.parent = f.mount
        f.lamp.renderPriority = 2
        fixtures.set(light.id, f)
      }
      if (membershipChanged || f.mount.parent !== room) {
        f.mount.parent = room
        f.lamp.includedOnlyMeshes = room
          .getChildMeshes()
          .filter((m) => m.isEnabled())
      }
      f.mount.position.copyFromFloats(...light.position)
      if (light.shape.rotation)
        f.mount.rotationQuaternion = Quaternion.FromArray(light.shape.rotation)
      f.lamp.setEnabled(light.enabled && f.lamp.includedOnlyMeshes.length > 0)
      f.lamp.diffuse = Color3.FromHexString(light.color).toLinearSpace()
      f.lamp.specular.copyFrom(f.lamp.diffuse)
      emitters[type].update(f.lamp, light)
    }
    // Materials can be shared between rooms. Reserve slots for the room with
    // most enabled fixtures in addition to its authored lights and shadow.
    return Math.max(0, ...counts.values())
  }
}
