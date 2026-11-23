import { lightTransform } from './light-transform.js'
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { HighlightLayer } from '@babylonjs/core/Layers/highlightLayer'
import '@babylonjs/core/Layers/effectLayerSceneComponent'
// The glow's post-processes compile synchronously; register their shaders up
// front instead of letting Babylon fetch them from the site root.
import '@babylonjs/core/Shaders/postprocess.vertex'
import '@babylonjs/core/Shaders/pass.fragment'
import '@babylonjs/core/Shaders/rgbdDecode.fragment'
import '@babylonjs/core/Shaders/glowBlurPostProcess.fragment'
import '@babylonjs/core/Shaders/glowMapGeneration.vertex'
import '@babylonjs/core/Shaders/glowMapGeneration.fragment'
import '@babylonjs/core/Shaders/glowMapMerge.vertex'
import '@babylonjs/core/Shaders/glowMapMerge.fragment'
import { snap, round } from './edit-ops.js'

const DRAG_START = 4
const selectedColor = Color3.FromHexString('#8fcf3a')
const hoverColor = Color3.FromHexString('#fff6c8')

// Direct manipulation for the studio scene. The left button selects, drags
// furniture or click-area pins along their floor plane, and pans empty space.
// The right button orbits freely; the wheel zooms.
export function attachCanvas(world, view, hooks) {
  const { scene, camera, rooms, instances } = world
  // Framing a selection translates the orbit without changing its orientation.
  camera.overrideCloneAlphaBetaRadius = true
  const canvas = view.canvas
  const handles = lightTransform(world, canvas, hooks)
  function syncLight() {
    const tool = hooks.lightTool()
    handles.sync(
      tool && selection?.type === 'light' ? hooks.light(selection.id) : null,
      tool,
    )
  }
  const glow = new HighlightLayer('선택 강조', scene, {
    blurHorizontalSize: 0.6,
    blurVerticalSize: 0.6,
  })
  glow.innerGlow = false
  let selection = null,
    hover = null,
    gesture = null

  const point = (e) => {
    const r = canvas.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  // Orthographic rays are parallel. Capture the screen basis at pointer-down
  // so panning does not feed the moving camera back into the next delta.
  function screenDrag(from) {
    const basis = camera.getViewMatrix().clone().invert()
    const xScale = (camera.orthoRight - camera.orthoLeft) / canvas.clientWidth
    const yScale = (camera.orthoTop - camera.orthoBottom) / canvas.clientHeight
    return (at) =>
      Vector3.TransformNormal(
        new Vector3((at.x - from.x) * xScale, (from.y - at.y) * yScale, 0),
        basis,
      )
  }

  function floorDrag(from, origin) {
    const deltaAt = screenDrag(from)
    const normal = camera.getForwardRay().direction
    // Cap depth amplification near the horizon, where an exact intersection
    // with the floor is undefined. Horizontal pointer motion still works.
    const incidence =
      (normal.y > 1e-6 ? 1 : -1) * Math.max(0.15, Math.abs(normal.y))
    return (at) => {
      const delta = deltaAt(at)
      delta.subtractInPlace(normal.scale(delta.y / incidence))
      delta.y = 0
      return origin.add(delta)
    }
  }
  const inverse = (m) => m.clone().invert()

  function paint() {
    glow.removeAllMeshes()
    const add = (id, color) => {
      const node = instances.get(id)
      if (!node) return
      for (const mesh of [node, ...node.getChildMeshes()])
        if (mesh.getTotalVertices?.() > 0)
          try {
            glow.addMesh(mesh, color)
          } catch {
            /* Instanced meshes cannot glow on their own. */
          }
    }
    if (hover && hover !== selection?.id) add(hover, hoverColor)
    if (selection?.type === 'item') add(selection.id, selectedColor)
  }

  function roomAt(p, current) {
    const inside = ([, { min, max }]) =>
      p.x >= min.x && p.x <= max.x && p.z >= min.z && p.z <= max.z
    const bounds = [...world.roomBounds]
    if (bounds.some((b) => b[0] === current && inside(b))) return current
    return bounds.find(inside)?.[0] || current
  }

  function beginItem(id, at, e) {
    const item = hooks.layout().items.find((i) => i.id === id)
    const node = instances.get(id)
    if (!item || !node) return null
    const origin = node.getAbsolutePosition().clone()
    return {
      kind: 'item',
      id,
      item,
      node,
      positionAt: floorDrag(at, origin),
      copy: e.altKey,
      room: item.room,
    }
  }
  function moveItem(g, at, e) {
    const dropped = g.positionAt(at)
    const source = rooms.get(g.item.room).computeWorldMatrix(true)
    const local = Vector3.TransformCoordinates(dropped, inverse(source))
    const fit = hooks.snapping() !== (e.metaKey || e.ctrlKey)
    const align = fit ? snap : round
    local.set(align(local.x), g.item.position[1], align(local.z))

    // Keep the cursor and snapping in the starting plane. The live mesh must
    // belong to the room under it so its light field changes before release.
    const room = roomAt(dropped, g.item.room)
    const changedRoom = room !== g.room
    if (changedRoom) {
      g.node.setParent(rooms.get(room))
      g.room = room
    }
    const position =
      room === g.item.room
        ? local
        : Vector3.TransformCoordinates(
            Vector3.TransformCoordinates(local, source),
            inverse(g.node.parent.computeWorldMatrix(true)),
          )
    if (!changedRoom && g.node.position.equals(position)) return
    g.node.position.copyFrom(position)
    world.itemMoved(changedRoom)
    hooks.itemMoved()
  }
  function dropItem(g) {
    const patch = { position: g.node.position.asArray().map((v) => round(v)) }
    if (g.room !== g.item.room) {
      patch.room = g.room
      patch.rotation = g.node.rotationQuaternion.normalizeToNew().asArray()
      patch.scale = g.node.scaling.asArray().map((v) => round(v))
    }
    hooks.commitItem(g.id, patch, { copy: g.copy })
  }

  function beginLight(id, at) {
    const light = hooks.light(id)
    if (!light) return null
    const space =
      rooms.get(light.room)?.computeWorldMatrix(true) ?? Matrix.Identity()
    const origin = Vector3.TransformCoordinates(
      Vector3.FromArray(light.position),
      space,
    )
    return {
      kind: 'light',
      id,
      start: light.position,
      positionAt: floorDrag(at, origin),
      inverse: inverse(space),
    }
  }
  function moveLight(g, at, e) {
    const local = Vector3.TransformCoordinates(g.positionAt(at), g.inverse)
    const align = hooks.snapping() !== (e.metaKey || e.ctrlKey) ? snap : round
    g.position = [align(local.x), g.start[1], align(local.z)].map((v) =>
      Math.max(-10000, Math.min(10000, v)),
    )
    hooks.previewLight(g.id, { position: g.position })
    syncLight()
  }

  function beginSpot(s, at) {
    const anchor = instances.get(s.anchor) || rooms.get(s.anchor)
    if (!anchor) return null
    const matrix = anchor.computeWorldMatrix(true)
    const origin = Vector3.TransformCoordinates(
      Vector3.FromArray(s.position),
      matrix,
    )
    return {
      kind: 'spot',
      id: s.id,
      spot: s,
      positionAt: floorDrag(at, origin),
      inverse: inverse(matrix),
      start: s.position.slice(),
    }
  }
  function moveSpot(g, at, e) {
    const local = Vector3.TransformCoordinates(g.positionAt(at), g.inverse)
    const fit = hooks.snapping() !== (e.metaKey || e.ctrlKey)
    const f = fit ? snap : round
    // The shown layout is live in the scene, so pins and the box follow.
    g.spot.position = [f(local.x), g.start[1], f(local.z)]
    world.showBox(g.spot)
  }

  function beginPan(at, hit) {
    return {
      kind: 'pan',
      origin: camera.target.clone(),
      deltaAt: screenDrag(at),
      hit,
    }
  }
  function movePan(g, at) {
    camera.target.copyFrom(g.origin.subtract(g.deltaAt(at)))
  }

  function start(g, e) {
    if (!g) return
    gesture = { ...g, pointer: e.pointerId, from: point(e), moved: false }
    addEventListener('pointermove', onMove)
    addEventListener('pointerup', onUp)
    addEventListener('pointercancel', cancelPointer)
  }
  function onMove(e) {
    if (!gesture || gesture.pointer !== e.pointerId) return
    const at = point(e)
    if (
      !gesture.moved &&
      Math.hypot(at.x - gesture.from.x, at.y - gesture.from.y) < DRAG_START
    )
      return
    if (!gesture.moved) {
      gesture.moved = true
      canvas.style.cursor = gesture.kind === 'pan' ? 'move' : 'grabbing'
      hooks.dragging(true, gesture.kind)
    }
    if (gesture.kind === 'item') moveItem(gesture, at, e)
    else if (gesture.kind === 'light') moveLight(gesture, at, e)
    else if (gesture.kind === 'spot') moveSpot(gesture, at, e)
    else movePan(gesture, at)
  }
  function stop() {
    removeEventListener('pointermove', onMove)
    removeEventListener('pointerup', onUp)
    removeEventListener('pointercancel', cancelPointer)
    const g = gesture
    gesture = null
    canvas.style.cursor = ''
    if (g?.moved) hooks.dragging(false, g.kind)
    return g
  }
  function cancelPointer(e) {
    if (gesture?.pointer === e.pointerId) cancel()
  }
  canvas.addEventListener('lostpointercapture', cancelPointer)
  function onUp(e) {
    if (gesture?.pointer !== e.pointerId || e.button !== 0) return
    const g = stop()
    if (!g) return
    if (g.kind === 'item' && g.moved) dropItem(g)
    else if (g.kind === 'light' && g.moved)
      hooks.commitLight(g.id, { position: g.position })
    else if (g.kind === 'spot' && g.moved)
      hooks.commitSpot(g.id, g.spot.position)
    else if (g.kind === 'pan' && !g.moved)
      hooks.select(g.hit?.type === 'room' ? g.hit : null)
  }
  // Escape or a lost pointer puts the dragged object back without an edit.
  function cancel() {
    if (handles.cancel()) return true
    const g = stop()
    if (g?.moved && g.kind !== 'pan') hooks.revert()
    return !!g
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || handles.dragging || gesture) return
    canvas.focus({ preventScroll: true })
    const at = point(e)
    if (hooks.pickLightPoint(at)) return
    const hit = world.pick(at.x, at.y)
    if (hit?.type === 'item') {
      hooks.select(hit)
      start(beginItem(hit.id, at, e), e)
    } else start(beginPan(at, hit), e)
  })
  canvas.addEventListener('contextmenu', (e) => e.preventDefault())
  canvas.addEventListener('dblclick', (e) => {
    const at = point(e)
    const hit = world.pick(at.x, at.y)
    if (hit) frame(hit)
  })
  let pending = null
  canvas.addEventListener('pointermove', (e) => {
    if (gesture || e.buttons) return
    pending = point(e)
  })
  canvas.addEventListener('pointerleave', () => {
    pending = null
    setHover(null)
  })
  function setHover(id) {
    if (id === hover) return
    hover = id
    canvas.style.cursor = id ? 'grab' : ''
    paint()
  }
  hooks.lightDown = (id, e) => {
    if (e.button !== 0 || gesture || handles.dragging) return
    e.preventDefault()
    hooks.select({ type: 'light', id })
    start(beginLight(id, point(e)), e)
    if (gesture) canvas.setPointerCapture(e.pointerId)
  }
  window.addEventListener('blur', cancel)
  scene.onDisposeObservable.addOnce(() =>
    window.removeEventListener('blur', cancel),
  )
  hooks.spotDown = (s, e) => {
    if (e.button !== 0) return
    e.preventDefault()
    start(beginSpot(s, point(e)), e)
  }

  // A toolbar hovers above the selected furniture, like design tools do.
  const toolbar = hooks.toolbar
  view.host.append(toolbar)
  scene.onAfterRenderObservable.add(() => {
    if (pending && !gesture) {
      const hit = world.pick(pending.x, pending.y)
      pending = null
      setHover(hit?.type === 'item' ? hit.id : null)
    }
    const node = selection?.type === 'item' && instances.get(selection.id)
    toolbar.hidden = !node || !!gesture?.moved
    if (toolbar.hidden) return
    // Sit above the furniture's whole on-screen footprint so the toolbar
    // never covers the part the operator wants to grab.
    const { min, max } = node.getHierarchyBoundingVectors(true)
    const width = canvas.clientWidth,
      height = canvas.clientHeight
    const port = camera.viewport.toGlobal(width, height)
    const transform = scene.getTransformMatrix()
    let left = Infinity,
      right = -Infinity,
      top = Infinity
    for (const x of [min.x, max.x])
      for (const y of [min.y, max.y])
        for (const z of [min.z, max.z]) {
          const p = Vector3.Project(
            new Vector3(x, y, z),
            Matrix.Identity(),
            transform,
            port,
          )
          left = Math.min(left, p.x)
          right = Math.max(right, p.x)
          top = Math.min(top, p.y)
        }
    const half = toolbar.offsetWidth / 2
    toolbar.style.left =
      Math.max(half + 8, Math.min(width - half - 8, (left + right) / 2)) + 'px'
    toolbar.style.top = Math.max(toolbar.offsetHeight + 60, top - 10) + 'px'
  })

  function anchorPosition(sel) {
    const layout = hooks.layout()
    if (sel.type === 'item') return instances.get(sel.id)?.getAbsolutePosition()
    if (sel.type === 'room') return rooms.get(sel.id)?.getAbsolutePosition()
    if (sel.type === 'light') {
      const light = hooks.light(sel.id)
      if (light && !light.room) return Vector3.FromArray(light.position)
      if (light)
        return Vector3.TransformCoordinates(
          Vector3.FromArray(light.position),
          rooms.get(light.room).computeWorldMatrix(true),
        )
    }
    if (sel.type === 'spot') {
      const s = layout.spots.find((o) => o.id === sel.id)
      const anchor = s && (instances.get(s.anchor) || rooms.get(s.anchor))
      return (
        anchor &&
        Vector3.TransformCoordinates(
          Vector3.FromArray(s.position),
          anchor.computeWorldMatrix(true),
        )
      )
    }
  }
  function frame(sel) {
    if (sel?.type === 'light' && hooks.isSource(sel.id)) {
      const light = hooks.light(sel.id)
      if (light.room)
        world.look(rooms.get(light.room).getAbsolutePosition(), 2.2)
      else world.overview()
      return
    }
    const target = sel && anchorPosition(sel)
    if (!target) return
    world.look(target, sel.type === 'room' ? 2.2 : Math.max(world.zoomLevel, 4))
  }

  // Maps an arrow key to the room axis that points most nearly that way on
  // screen, so nudging follows what the operator sees on the diagonal view.
  function screenAxis(roomId, key) {
    const want = {
      ArrowUp: [0, 1],
      ArrowDown: [0, -1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
    }[key]
    const room = rooms.get(roomId)
    if (!want || !room) return null
    const toWorld = room.computeWorldMatrix(true)
    const port = camera.viewport.toGlobal(
      canvas.clientWidth,
      canvas.clientHeight,
    )
    const screen = (local) =>
      Vector3.Project(
        Vector3.TransformCoordinates(Vector3.FromArray(local), toWorld),
        Matrix.Identity(),
        scene.getTransformMatrix(),
        port,
      )
    const origin = screen([0, 0, 0])
    // Screen y grows downward; flip it so "up" is positive.
    const dir = (axis) => {
      const p = screen(axis)
      const dx = p.x - origin.x,
        dy = origin.y - p.y
      const length = Math.hypot(dx, dy) || 1
      return [dx / length, dy / length]
    }
    const axes = [
      [1, 0, 0],
      [0, 0, 1],
    ]
    // On a 45° view each room axis is diagonal, so give the four arrows four
    // distinct directions: the axis most to the right, and the other one up.
    const [a, b] = axes.map(dir)
    const flipA = a[0] < 0 ? -1 : 1
    const flipB = b[1] < 0 ? -1 : 1
    const horizontal = Math.abs(a[0]) >= Math.abs(b[0])
    const rightAxis = horizontal
      ? axes[0].map((v) => v * flipA)
      : axes[1].map((v) => v * (b[0] < 0 ? -1 : 1))
    const upAxis = horizontal
      ? axes[1].map((v) => v * flipB)
      : axes[0].map((v) => v * (a[1] < 0 ? -1 : 1))
    const scale = want[0] || want[1]
    return (want[0] ? rightAxis : upAxis).map((v) => v * scale + 0)
  }

  return {
    setSelection(sel) {
      selection = sel
      syncLight()
      paint()
    },
    refreshHighlight: paint,
    frame,
    cancel,
    screenAxis,
    get busy() {
      return !!gesture || handles.dragging
    },
  }
}
