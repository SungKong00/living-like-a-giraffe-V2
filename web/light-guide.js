import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector'
import { CreateLineSystem } from '@babylonjs/core/Meshes/Builders/linesBuilder'

function outline(shape) {
  const origin = Vector3.Zero()
  const lines = [[origin, new Vector3(0, 0, -2)]]
  if (shape.type === 'area') {
    const x = shape.width / 2,
      y = shape.height / 2
    if (['disk', 'ellipse'].includes(shape.form)) {
      const rim = Array.from(
        { length: 33 },
        (_, i) =>
          new Vector3(
            x * Math.cos((i * Math.PI) / 16),
            y * Math.sin((i * Math.PI) / 16),
            0,
          ),
      )
      return [...lines, rim]
    }
    const corners = [
      [-x, -y],
      [x, -y],
      [x, y],
      [-x, y],
    ].map(([a, b]) => new Vector3(a, b, 0))
    return [...lines, [...corners, corners[0]]]
  }
  const half = (shape.angle * Math.PI) / 360
  const ring = Array.from({ length: 32 }, (_, i) => {
    const t = (i * Math.PI) / 16,
      r = 2 * Math.sin(half)
    return new Vector3(r * Math.cos(t), r * Math.sin(t), -2 * Math.cos(half))
  })
  return [
    ...lines,
    [...ring, ring[0]],
    ...[0, 8, 16, 24].map((i) => [origin, ring[i]]),
  ]
}

// This wire belongs only to the active editor selection. The studio camera can
// see and orbit it, but neither picking nor the visitor preview can include it.
export function lightGuide(scene, rooms) {
  let mesh, key
  return (light) => {
    const shape = light?.shape
    if (!shape || shape.type === 'point') {
      mesh?.dispose()
      mesh = key = null
      return
    }
    const geometry = [
      shape.type,
      shape.angle,
      shape.form,
      shape.width,
      shape.height,
    ].join('/')
    if (geometry !== key) {
      mesh?.dispose()
      mesh = CreateLineSystem('조명 방향', { lines: outline(shape) }, scene)
      mesh.isPickable = false
      mesh.color = Color3.FromHexString('#ffc067')
      key = geometry
    }
    mesh.parent = rooms.get(light.room) ?? null
    mesh.position.copyFromFloats(...light.position)
    mesh.rotationQuaternion = Quaternion.FromArray(shape.rotation)
  }
}
