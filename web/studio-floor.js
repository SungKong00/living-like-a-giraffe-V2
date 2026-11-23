import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color'

const paper = '#eeeae3'
export const floorBackground = Color4.FromHexString(paper + 'ff')

// The overhead plate covers 240 Blender metres around the v06 Backdrop origin.
export async function addStudioFloor(scene, rooms) {
  const plate = new Image()
  plate.src = '/images/studio-floor.jpg'
  try {
    await plate.decode()
  } catch {
    return // Keep the warm scene background when the plate cannot be loaded.
  }
  const span = 240
  const size = 1024
  const scale = size / span
  const floor = MeshBuilder.CreateGround(
    '스튜디오 바닥',
    { width: span, height: span },
    scene,
  )
  floor.position.set(32, -0.31, -24)
  floor.isPickable = false
  const texture = new DynamicTexture('바닥 조명', size, scene, true)
  const ctx = texture.getContext()
  ctx.drawImage(plate, 0, 0, size, size)
  const fade = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  )
  fade.addColorStop(0, 'rgba(238,234,227,0.17)')
  fade.addColorStop(0.48, 'rgba(238,234,227,0.35)')
  fade.addColorStop(1, paper)
  ctx.fillStyle = fade
  ctx.fillRect(0, 0, size, size)
  // World-space contact shadows follow each room's footprint, including reimports.
  for (const room of rooms.values()) {
    const { min, max } = room.getHierarchyBoundingVectors(true)
    const w = (max.x - min.x) * scale
    const h = (max.z - min.z) * scale
    if (!(w > 0 && h > 0)) continue
    ctx.save()
    ctx.shadowColor = 'rgba(41,32,21,0.26)'
    ctx.shadowBlur = 2 * scale
    ctx.shadowOffsetX = scale
    ctx.shadowOffsetY = scale
    ctx.fillStyle = 'rgba(57,48,38,0.26)'
    ctx.fillRect(
      size / 2 + (min.x - floor.position.x) * scale,
      size / 2 + (min.z - floor.position.z) * scale,
      w,
      h,
    )
    ctx.restore()
  }
  texture.update(false)
  const mat = new StandardMaterial('스튜디오 배경', scene)
  mat.disableLighting = true
  mat.diffuseColor = Color3.Black()
  mat.specularColor = Color3.Black()
  mat.emissiveTexture = texture
  mat.backFaceCulling = false
  floor.material = mat
  return floor
}
