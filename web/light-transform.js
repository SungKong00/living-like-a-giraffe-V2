import { Vector3, Quaternion, Matrix } from '@babylonjs/core/Maths/math.vector'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { PositionGizmo } from '@babylonjs/core/Gizmos/positionGizmo'
import { RotationGizmo } from '@babylonjs/core/Gizmos/rotationGizmo'
import { UtilityLayerRenderer } from '@babylonjs/core/Rendering/utilityLayerRenderer'
import { PointerEventTypes } from '@babylonjs/core/Events/pointerEvents'
import { round, snap } from './edit-ops.js'

// Babylon edits a unit-scale proxy in world space. The actual light keeps its
// Blender hierarchy, including rotated or scaled room parents.
export function lightTransform(world, canvas, hooks) {
  const layer = new UtilityLayerRenderer(world.scene)
  layer.setRenderCamera(world.camera)
  const proxy = new TransformNode('조명 조작 기준', world.scene)
  proxy.rotationQuaternion = Quaternion.Identity()
  const tools = new Map()
  let light, mode, drag
  const listeners = new AbortController()
  function frame(lamp) {
    const matrix =
      world.rooms.get(lamp.room)?.computeWorldMatrix(true) ?? Matrix.Identity()
    const rotation = Quaternion.Identity()
    matrix.decompose(undefined, rotation)
    return { matrix, rotation: rotation.normalize() }
  }

  function pose() {
    if (!light) return
    const space = frame(light)
    proxy.position.copyFrom(
      Vector3.TransformCoordinates(
        Vector3.FromArray(light.position),
        space.matrix,
      ),
    )
    const local = light.shape?.rotation
    proxy.rotationQuaternion.copyFrom(
      local
        ? space.rotation.multiply(Quaternion.FromArray(local)).normalize()
        : Quaternion.Identity(),
    )
    proxy.computeWorldMatrix(true)
  }

  function cancel() {
    if (!drag) return false
    const past = drag
    drag = null
    for (const axis of axes(tools.get(mode))) axis.dragBehavior.releaseDrag()
    if (past.previewed) hooks.revert()
    light = hooks.light(past.light.id)
    pose()
    return true
  }

  function axes(tool) {
    return [tool.xGizmo, tool.yGizmo, tool.zGizmo]
  }

  function build(kind) {
    const tool =
      kind === 'move'
        ? new PositionGizmo(layer, 2)
        : new RotationGizmo(layer, 32, false, 2)
    tool.updateGizmoRotationToMatchAttachedMesh = kind === 'rotate'
    for (const axis of axes(tool)) {
      axis.dragBehavior.dragButtons = [0]
      axis.dragBehavior.detachCameraControls = false
    }
    tool.onDragStartObservable.add((e) => {
      if (!light || drag) return
      const space = frame(light)
      drag = {
        light: structuredClone(light),
        inverse: space.matrix.clone().invert(),
        rotation: space.rotation.conjugate(),
        start: proxy.position.clone(),
        pointer: e.pointerId,
      }
      canvas.focus({ preventScroll: true })
      if (e.pointerId >= 0) canvas.setPointerCapture(e.pointerId)
    })
    tool.onDragObservable.add((e) => {
      if (!drag) return
      const original = drag.light
      let patch
      if (kind === 'move') {
        const delta = proxy.position.subtract(drag.start)
        const pointer = e.pointerInfo?.event
        if (hooks.snapping() !== !!(pointer?.metaKey || pointer?.ctrlKey))
          delta.set(snap(delta.x), snap(delta.y), snap(delta.z))
        const position = Vector3.TransformCoordinates(
          drag.start.add(delta),
          drag.inverse,
        )
          .asArray()
          .map((v, i) =>
            Math.abs(v - original.position[i]) < 0.0001
              ? original.position[i]
              : Math.max(-10000, Math.min(10000, round(v))),
          )
        if (position.some((v, i) => v !== original.position[i]))
          patch = { position }
      } else {
        const q = drag.rotation.multiply(proxy.rotationQuaternion).normalize()
        if (
          Math.abs(
            Quaternion.Dot(
              q,
              Quaternion.FromArray(original.shape.rotation).normalize(),
            ),
          ) <
          1 - 1e-10
        )
          patch = { shape: { ...original.shape, rotation: q.asArray() } }
      }
      if (patch) hooks.previewLight(original.id, patch)
      else if (drag.patch) hooks.revert()
      drag.patch = patch
      drag.previewed ||= !!patch
    })
    tool.onDragEndObservable.add(() => {
      if (!drag) return
      const past = drag
      drag = null
      if (past.patch) hooks.commitLight(past.light.id, past.patch)
      light = hooks.light(past.light.id)
      pose()
    })
    tools.set(kind, tool)
    return tool
  }
  const pre = world.scene.onPrePointerObservable.add(
    (info) => {
      // Utility-layer picks normally consume all buttons, including camera orbit.
      layer.pickingEnabled =
        !!light &&
        (info.type !== PointerEventTypes.POINTERDOWN || info.event.button === 0)
    },
    -1,
    true,
  )
  function sizeHandles() {
    if (mode)
      tools.get(mode).scaleRatio = 680 / Math.max(1, canvas.clientHeight)
  }
  const resize = new ResizeObserver(sizeHandles)
  resize.observe(canvas)
  const opts = { signal: listeners.signal, capture: true }
  window.addEventListener('blur', cancel, opts)
  for (const name of ['pointercancel', 'lostpointercapture'])
    canvas.addEventListener(
      name,
      (e) => {
        if (drag?.pointer === e.pointerId) cancel()
      },
      opts,
    )
  world.scene.onDisposeObservable.addOnce(() => {
    listeners.abort()
    resize.disconnect()
    world.scene.onPrePointerObservable.remove(pre)
    drag = null
    for (const tool of tools.values()) tool.dispose()
    proxy.dispose()
  })
  layer.shouldRender = layer.pickingEnabled = false
  return {
    sync(next, requested) {
      const kind =
        next &&
        (requested === 'rotate' && next.shape?.rotation ? 'rotate' : 'move')
      if (light?.id !== next?.id || mode !== kind) {
        world.wake()
        cancel()
        if (mode) tools.get(mode).attachedNode = null
      }
      light = next
      mode = kind
      layer.shouldRender = !!next
      layer.pickingEnabled = !!next
      if (!next || drag) return
      pose()
      const tool = tools.get(kind) ?? build(kind)
      // Keep the handles usable at every orthographic zoom and viewport size.
      sizeHandles()
      if (tool.attachedNode !== proxy) tool.attachedNode = proxy
    },
    get dragging() {
      return !!drag
    },
    cancel,
  }
}
