import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera'
import { Camera } from '@babylonjs/core/Cameras/camera'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture'

// The portrait uses the live meshes and lights. Its private camera orbits in
// model space so a placement edit cannot turn the model away from the viewer.
export function selectionPreview(world, canvas, playing) {
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
  const pivot = new TransformNode('선택 보기 기준', scene)
  camera.parent = pivot
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
    selection,
    dirty = false,
    measurePose = false,
    busy = false,
    version = 0,
    lastFrame = 0,
    surfaceFrame = -1,
    framing = 0
  const ctx = canvas.getContext('2d')
  const observer = scene.onAfterRenderObservable.add(async () => {
    if (busy || !selected || selected.isDisposed()) return
    const now = performance.now()
    const animate = playing()
    if (
      !dirty &&
      world.claySurfaceFrame === surfaceFrame &&
      !(animate && now - lastFrame >= 100)
    )
      return
    const meshes = [selected, ...selected.getChildMeshes()].filter(
      (m) =>
        m.isEnabled() &&
        m.isVisible &&
        m.getTotalVertices?.() > 0 &&
        m.material,
    )
    if (!meshes.length) return
    target.renderList = meshes
    if (!target.isReadyForRendering()) return
    dirty = false
    busy = true
    lastFrame = now
    surfaceFrame = world.claySurfaceFrame
    const request = version
    try {
      selected.computeWorldMatrix(true)
      pivot.position.copyFrom(selected.absolutePosition)
      pivot.rotationQuaternion = selected.absoluteRotationQuaternion.clone()
      const toPivot = pivot.computeWorldMatrix(true).clone().invert()
      const min = new Vector3(Infinity, Infinity, Infinity),
        max = min.scale(-1)
      for (const mesh of meshes) {
        mesh.computeWorldMatrix(true)
        if (mesh.skeleton && (measurePose || animate))
          mesh.refreshBoundingInfo(true, true)
        const box = mesh.getBoundingInfo().boundingBox
        for (const corner of box.vectorsWorld) {
          const point = Vector3.TransformCoordinates(corner, toPivot)
          min.minimizeInPlace(point)
          max.maximizeInPlace(point)
        }
      }
      measurePose = false
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
    pivot.dispose()
  })
  return Object.freeze({
    select(node, next) {
      canvas.hidden = !node
      const changed =
        next?.id !== selection?.id || next?.type !== selection?.type
      if (!changed && node === selected) return
      if (changed) {
        camera.alpha = Math.PI / 4
        camera.beta = 1.1
      }
      selection = next
      selected = node
      framing = 0
      version++
      target.renderList = []
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      dirty = measurePose = !!node
      if (node) world.wake()
    },
    orbit(yaw, pitch) {
      if (!selected) return
      camera.alpha += yaw
      camera.beta = Math.max(
        0.01,
        Math.min(Math.PI - 0.01, camera.beta + pitch),
      )
      dirty = true
      world.wake()
    },
    invalidate() {
      // Finish the in-flight thumbnail and draw the latest pose next frame.
      dirty = measurePose = !!selected
      if (selected) world.wake()
    },
  })
}
