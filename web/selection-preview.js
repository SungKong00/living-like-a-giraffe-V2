import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera'
import { Camera } from '@babylonjs/core/Cameras/camera'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture'

// A read-only projection of the live editor meshes. No model download, material
// copy or second WebGL context. Render only when the selection or layout changes.
export function selectionPreview(world, canvas) {
  const { scene } = world
  const camera = new ArcRotateCamera(
    '선택 보기',
    Math.PI / 4,
    1.1,
    10,
    Vector3.Zero(),
    scene,
  )
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA
  camera.overrideCloneAlphaBetaRadius = true
  camera.minZ = 0.01
  const target = new RenderTargetTexture(
    '선택 보기',
    { width: canvas.width, height: canvas.height },
    scene,
  )
  target.activeCamera = camera
  target.clearColor = scene.clearColor
  target.renderParticles = false
  target.renderSprites = false
  let selected,
    dirty = false,
    busy = false,
    version = 0,
    framing = 0
  const ctx = canvas.getContext('2d')
  const observer = scene.onAfterRenderObservable.add(async () => {
    if (!dirty || busy || !selected) return
    const meshes = [selected, ...selected.getChildMeshes()].filter(
      (m) => m.isEnabled() && m.getTotalVertices?.() > 0 && m.material,
    )
    if (!meshes.length) return
    target.renderList = meshes
    if (!target.isReadyForRendering()) return
    dirty = false
    busy = true
    const request = version
    try {
      const min = new Vector3(Infinity, Infinity, Infinity),
        max = min.scale(-1)
      for (const mesh of meshes) {
        mesh.computeWorldMatrix(true)
        const box = mesh.getBoundingInfo().boundingBox
        min.minimizeInPlace(box.minimumWorld)
        max.maximizeInPlace(box.maximumWorld)
      }
      const radius = Math.max(0.1, Vector3.Distance(min, max) / 2)
      camera.setTarget(min.add(max).scale(0.5))
      camera.radius = radius * 3
      const view = camera.getViewMatrix(true)
      const aspect = canvas.width / canvas.height
      let extent = 0.01
      for (const mesh of meshes) {
        for (const corner of mesh.getBoundingInfo().boundingBox.vectorsWorld) {
          const point = Vector3.TransformCoordinates(corner, view)
          extent = Math.max(
            extent,
            Math.abs(point.x) / aspect,
            Math.abs(point.y),
          )
        }
      }
      framing ||= extent * 1.3
      const halfHeight = Math.max(framing, extent * 1.04)
      camera.orthoTop = halfHeight
      camera.orthoBottom = -halfHeight
      camera.orthoRight = (halfHeight * canvas.width) / canvas.height
      camera.orthoLeft = -camera.orthoRight
      target.render()
      const pixels = await target.readPixels()
      if (request === version && pixels) {
        ctx.putImageData(
          new ImageData(
            new Uint8ClampedArray(
              pixels.buffer,
              pixels.byteOffset,
              pixels.byteLength,
            ),
            canvas.width,
            canvas.height,
          ),
          0,
          0,
        )
      }
    } finally {
      busy = false
    }
  })
  scene.onDisposeObservable.addOnce(() => {
    version++
    scene.onAfterRenderObservable.remove(observer)
    target.dispose()
    camera.dispose()
  })
  return Object.freeze({
    select(selection) {
      const node =
        selection?.type === 'item'
          ? world.instances.get(selection.id)
          : selection?.type === 'room'
            ? world.rooms.get(selection.id)
            : null
      canvas.hidden = !node
      if (node === selected) return
      selected = node
      framing = 0
      version++
      target.renderList = []
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      dirty = !!node
    },
    invalidate() {
      version++
      dirty = !!selected
    },
  })
}
