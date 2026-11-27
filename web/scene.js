import { clayMotion } from './clay-motion.js'
import { resolvedSources } from '../shared/source-lights.mjs'
import { MeshoptCompression } from '@babylonjs/core/Meshes/Compression/meshoptCompression'
import decoderURL from '../node_modules/meshoptimizer/meshopt_decoder.cjs?url'
MeshoptCompression.Configuration.decoder.url = decoderURL
import { Engine } from '@babylonjs/core/Engines/engine'
import { Scene } from '@babylonjs/core/scene'
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera'
import { Camera } from '@babylonjs/core/Cameras/camera'
import { Vector3, Quaternion, Matrix } from '@babylonjs/core/Maths/math.vector'
import { addStudioFloor, floorBackground } from './studio-floor.js'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight'
import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader'
// scene.pick and createPickingRay silently miss without the Ray side effect.
import '@babylonjs/core/Culling/ray'
import '@babylonjs/loaders/glTF/2.0'
import '@babylonjs/loaders/glTF/glTFFileLoader'
import { IconButton, Pin } from './ds/index.js'

const v = (arr) => Vector3.FromArray(arr)
export function openVisitorScene(view, state, actions) {
  return openScene(view, state, 'visitor', actions)
}
export function openEditorScene(view, state, actions) {
  return openScene(view, state, 'editor', actions)
}
export function openLayoutPreview(view, state, actions) {
  return openScene(view, state, 'layout', actions)
}

async function openScene(
  view,
  state,
  mode,
  {
    onRoom,
    onSpot,
    onSpotDown,
    onLight,
    onLightDown,
    onReady,
    // Visitor taps on a registered owner (a character); true when handled.
    onPick,
  } = {},
) {
  const editing = mode === 'editor'
  const studioCamera = editing
  const draft = editing || mode === 'layout'
  if (state.render !== (draft ? 'editor' : 'visitor'))
    throw Error('이 화면에 맞는 월드 모델을 다시 불러오세요.')
  const engine = new Engine(
    view.canvas,
    true,
    { stencil: true, preserveDrawingBuffer: false },
    false,
  )
  const scene = new Scene(engine)
  scene.useRightHandedSystem = true
  scene.clearColor = floorBackground
  const center = Vector3.Zero()
  const alpha = Math.PI / 4,
    beta = Math.PI / 2 - 0.62
  const camera = new ArcRotateCamera(
    '관람',
    alpha,
    beta,
    150,
    center.clone(),
    scene,
  )
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA
  if (studioCamera) {
    camera.lowerBetaLimit = null
    camera.upperBetaLimit = null
    camera.allowUpsideDown = true
  } else {
    // Visitors and the layout preview only pan and zoom. Equal limits hold
    // the direction through every retarget, and no camera input is attached.
    camera.lowerAlphaLimit = camera.upperAlphaLimit = alpha
    camera.lowerBetaLimit = camera.upperBetaLimit = beta
  }
  camera.lowerRadiusLimit = camera.upperRadiusLimit = 150
  // The studio keeps the left button for selecting, moving and panning.
  if (studioCamera) {
    camera.inputs.removeByType('ArcRotateCameraMouseWheelInput')
    camera.panningSensibility = 0
    camera.attachControl(view.canvas, true, true, -1)
    camera.inputs.attached.pointers.buttons = [2]
    camera.movement.input.addEntry({
      source: 'pointer',
      button: 2,
      interaction: 'rotate',
    })
  }
  if (!draft) {
    const fill = new HemisphericLight('환경', new Vector3(0, 1, 0), scene)
    fill.intensity = 0.85
    const sun = new DirectionalLight(
      '관람 조명',
      new Vector3(-0.5, -1, -0.4),
      scene,
    )
    sun.intensity = 0.65
    sun.position = new Vector3(60, 70, 12)
  }
  let imported
  try {
    imported = await ImportMeshAsync(state.asset, scene, {
      pluginExtension: '.glb',
      pluginOptions: { gltf: { createInstances: !draft } },
    })
  } catch (e) {
    scene.dispose()
    engine.dispose()
    throw e
  }
  const motion = clayMotion(scene, camera)
  motion.set(state.layout.defaults?.clayMotion)
  for (const mesh of imported.meshes) motion.include(mesh)
  const nodes = [...imported.meshes, ...imported.transformNodes]
  const extras = (n) => n?.metadata?.gltf?.extras || {}
  const rooms = new Map(
    nodes.filter((n) => extras(n).roomId).map((n) => [extras(n).roomId, n]),
  )
  // Frame the imported rooms before the studio floor expands the scene bounds.
  const bounds = scene.getWorldExtends()
  center.copyFrom(bounds.min.add(bounds.max).scale(0.5))
  camera.setTarget(center.clone())
  const worldSize = bounds.max.subtract(bounds.min)
  // Visitors pan until the edge of the world reaches the middle of the
  // screen: the floor point the camera looks at stays inside the world.
  camera.getViewMatrix(true)
  const sight = center.subtract(camera.position).normalize()
  const onFloor = (point) =>
    point.add(sight.scale((bounds.min.y - point.y) / sight.y))
  const panMin = Vector3.Minimize(bounds.min, onFloor(center)),
    panMax = Vector3.Maximize(bounds.max, onFloor(center))
  function keepInWorld() {
    if (studioCamera) return
    const at = onFloor(camera.target)
    camera.target.x += Math.min(panMax.x, Math.max(panMin.x, at.x)) - at.x
    camera.target.z += Math.min(panMax.z, Math.max(panMin.z, at.z)) - at.z
  }
  const overviewWidth = 1.18 * Math.hypot(worldSize.x, worldSize.z)
  const overviewHeight =
    overviewWidth * Math.sin(0.62) + worldSize.y * Math.cos(0.62)
  try {
    const floor = await addStudioFloor(scene, rooms)
    if (studioCamera && floor)
      scene.onBeforeRenderObservable.add(() => {
        floor.isVisible = camera.position.y >= floor.position.y
      })
  } catch (error) {
    scene.dispose()
    engine.dispose()
    throw error
  }
  const originals = new Map(
    nodes.filter((n) => extras(n).itemId).map((n) => [extras(n).itemId, n]),
  )
  let illumination
  if (draft) {
    try {
      const { studioIllumination } = await import('./studio-illumination.js')
      illumination = studioIllumination(
        scene,
        rooms,
        imported.meshes,
        state.sourceLights ?? [],
      )
    } catch (error) {
      scene.dispose()
      engine.dispose()
      throw error
    }
  }
  const templates = new Map()
  if (draft) {
    for (const node of originals.values()) {
      const kind = extras(node).kind
      if (templates.has(kind)) continue
      const copy = node.clone('기준 ' + kind, node.parent)
      copy.setEnabled(false)
      templates.set(kind, copy)
    }
  }
  let layout = state.layout,
    focus = null,
    zoom = 1,
    marks = []
  const guide = editing
    ? (await import('./light-guide.js')).lightGuide(scene, rooms)
    : null
  let sourceRows = []
  function updateIllumination(next) {
    sourceRows = resolvedSources(state.sourceLights ?? [], next.sourceLights)
    illumination.update(
      instances,
      next.lights ?? [],
      sourceRows,
      !!next.sourceLights?.length,
    )
  }
  const activeLight = () =>
    (layout.lights ?? []).find((l) => l.id === selectedLight) ||
    sourceRows.find((l) => l.id === selectedLight)
  let selectedLight
  const pickOwners = new Map()
  const styledExtra = new WeakSet()
  let box,
    chosenSpot = null
  const styled = new Map(),
    materials = new WeakMap(),
    instances = new Map(originals)
  function applyItems(next) {
    for (const [id, n] of instances)
      if (!next.items.some((i) => i.id === id)) {
        n.dispose()
        instances.delete(id)
      }
    for (const i of next.items) {
      let n = instances.get(i.id)
      if (!n) {
        n = templates.get(i.kind)?.clone(i.label, rooms.get(i.room))
        if (!n) continue
        n.setEnabled(true)
        instances.set(i.id, n)
        for (const mesh of [n, ...n.getChildMeshes()])
          if (mesh.getTotalVertices) motion.include(mesh)
      }
      n.parent = rooms.get(i.room)
      n.position.copyFromFloats(...i.position)
      n.scaling.copyFromFloats(...i.scale)
      n.rotationQuaternion = Quaternion.FromArray(i.rotation)
      for (const mesh of [n, ...n.getChildMeshes()].filter(
        (mesh) => mesh.material,
      )) {
        if (!materials.has(mesh)) materials.set(mesh, mesh.material)
        const base = materials.get(mesh)
        if (!base) continue
        const key = [base.uniqueId, i.color, i.finish].join('/')
        if (!styled.has(key)) {
          const mat = base.clone(key)
          if (i.color !== 'original' && mat.albedoColor)
            mat.albedoColor = Color3.FromHexString(i.color).toLinearSpace()
          if (i.finish !== 'original')
            mat.roughness = i.finish === 'matte' ? 0.88 : 0.22
          illumination.style(mat)
          styled.set(key, mat)
        }
        mesh.material = styled.get(key)
        mesh.receiveShadows = true
      }
    }
    updateIllumination(next)
  }
  // Anchors are independent of baked triangles and survive material batching.
  function spotWorld(s) {
    // While editing, follow the live node so a dragged item carries its pins.
    const live = editing && instances.get(s.anchor)
    if (live)
      return Vector3.TransformCoordinates(
        v(s.position),
        live.computeWorldMatrix(true),
      )
    const item = layout.items.find((i) => i.id === s.anchor)
    const room = rooms.get(item?.room || s.anchor)
    if (!room) return null
    let p = v(s.position)
    if (item)
      p = Vector3.TransformCoordinates(
        p,
        Matrix.Compose(
          v(item.scale),
          Quaternion.FromArray(item.rotation),
          v(item.position),
        ),
      )
    return Vector3.TransformCoordinates(p, room.computeWorldMatrix(true))
  }
  function markers() {
    view.overlay.replaceChildren()
    marks = []
    function add(label, pos, action, tone, down, selected = false) {
      const node = Pin({
        label,
        tone,
        selected,
        onClick: action,
        onPointerDown: down,
      })
      view.overlay.append(node)
      marks.push({
        node,
        pos,
        width: node.offsetWidth,
        height: node.offsetHeight,
      })
    }
    if (editing) {
      for (const lamp of [...(layout.lights ?? []), ...sourceRows]) {
        const id = lamp.id,
          label = '조명 · ' + lamp.label
        const selected = id === selectedLight
        const node = IconButton({
          label,
          icon: 'light',
          size: 'sm',
          variant: selected ? 'primary' : 'secondary',
          className: 'studio-light-pin',
          pressed: selected,
          onClick: () => onLight?.(id),
        })
        node.addEventListener('pointerdown', (e) => onLightDown?.(id, e))
        view.overlay.append(node)
        marks.push({
          node,
          light: id,
          width: node.offsetWidth,
          height: node.offsetHeight,
          pos: () => {
            const current = id === selectedLight ? activeLight() : lamp
            if (!current) return null
            const room = rooms.get(current.room)
            return room
              ? Vector3.TransformCoordinates(
                  v(current.position),
                  room.getWorldMatrix(),
                )
              : v(current.position)
          },
        })
      }
    }
    if (!focus && !editing)
      for (const r of state.rooms) {
        const n = rooms.get(r.id)
        if (n)
          add(
            r.label,
            () => n.getAbsolutePosition(),
            () => selectRoom(r.id),
            'place',
          )
      }
    else
      for (const s of layout.spots) {
        if (
          !editing &&
          s.anchor !== focus &&
          !layout.items.some((i) => i.id === s.anchor && i.room === focus)
        )
          continue
        add(
          s.label,
          () => spotWorld(s),
          () => onSpot?.(s),
          'event',
          editing ? (event) => onSpotDown?.(s, event) : undefined,
          s.id === chosenSpot,
        )
      }
  }
  function resize() {
    engine.resize()
    const aspect =
      view.canvas.clientWidth / Math.max(1, view.canvas.clientHeight)
    const width = focus ? 45 : overviewWidth
    const half =
      Math.max(width / aspect, focus ? 33 : overviewHeight) / (2 * zoom)
    camera.orthoTop = half
    camera.orthoBottom = -half
    camera.orthoLeft = -half * aspect
    camera.orthoRight = half * aspect
  }
  function selectRoom(id) {
    focus = id
    zoom = 1
    wake()
    camera.setTarget(
      rooms.get(id)?.getAbsolutePosition()?.clone() || center.clone(),
    )
    keepInWorld()
    resize()
    markers()
    onRoom?.(id)
  }
  function look(target, nextZoom = zoom) {
    wake()
    camera.setTarget(target.clone())
    keepInWorld()
    zoom = Math.min(10, Math.max(0.5, nextZoom))
    resize()
  }
  function magnify(factor, point) {
    const next = Math.min(10, Math.max(0.5, zoom * factor))
    if (point && next !== zoom) {
      // Keep the point under the pointer stationary as the orthographic window shrinks.
      const rect = view.canvas.getBoundingClientRect()
      const x =
        ((2 * (point.x - rect.left)) / rect.width - 1) * camera.orthoRight
      const y = (1 - (2 * (point.y - rect.top)) / rect.height) * camera.orthoTop
      const offset = Vector3.TransformNormal(
        new Vector3(x, y, 0),
        camera.getViewMatrix().clone().invert(),
      )
      camera.target.addInPlace(offset.scale(1 - zoom / next))
      keepInWorld()
    }
    zoom = next
    resize()
    wake()
  }
  /** Moves the view by a pointer's travel in CSS pixels. */
  function pan(dx, dy) {
    // A pixel is the same length everywhere in an orthographic view, so the
    // floor under the pointer follows it exactly.
    const unit = (2 * camera.orthoTop) / Math.max(1, view.canvas.clientHeight)
    camera.target.addInPlace(
      Vector3.TransformNormal(
        new Vector3(-dx * unit, dy * unit, 0),
        camera.getViewMatrix().clone().invert(),
      ),
    )
    keepInWorld()
    wake()
  }
  const gestures = new AbortController()
  view.canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault()
      const unit =
        event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? view.canvas.clientHeight
            : 1
      magnify(
        Math.exp(-Math.max(-500, Math.min(500, event.deltaY * unit)) * 0.002),
        { x: event.clientX, y: event.clientY },
      )
    },
    { passive: false, signal: gestures.signal },
  )
  let pinchDistance = 0,
    multiTouch = false
  function span(touches) {
    return Math.hypot(
      touches[0].clientX - touches[1].clientX,
      touches[0].clientY - touches[1].clientY,
    )
  }
  for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
    view.canvas.addEventListener(
      type,
      (event) => {
        const t = event.touches
        if (t.length !== 2) {
          pinchDistance = 0
          return
        }
        multiTouch = true
        const distance = span(t)
        if (type === 'touchmove' && pinchDistance > 0 && distance > 0) {
          event.preventDefault()
          magnify(distance / pinchDistance, {
            x: (t[0].clientX + t[1].clientX) / 2,
            y: (t[0].clientY + t[1].clientY) / 2,
          })
        }
        pinchDistance = distance
      },
      { passive: false, signal: gestures.signal },
    )
  }
  const obs = new ResizeObserver(resize)
  obs.observe(view.host)
  const previous = { x: 0, y: 0 }
  // The primary pointer's last place while it may pan; null otherwise.
  let drag = null
  if (!studioCamera) {
    view.canvas.onpointerdown = (e) => {
      // A second finger makes the gesture a pinch until every finger lifts.
      multiTouch = !e.isPrimary
      drag = null
      if (!e.isPrimary) return
      previous.x = e.clientX
      previous.y = e.clientY
      if (e.button !== 0) return
      drag = { x: e.clientX, y: e.clientY, moved: false }
      view.canvas.setPointerCapture(e.pointerId)
    }
    view.canvas.onpointermove = (e) => {
      if (!drag || !e.isPrimary || multiTouch) return
      // Under the tap threshold nothing moves, so a press never shifts the view.
      if (
        !drag.moved &&
        Math.hypot(e.clientX - previous.x, e.clientY - previous.y) <= 6
      )
        return
      drag.moved = true
      pan(e.clientX - drag.x, e.clientY - drag.y)
      drag.x = e.clientX
      drag.y = e.clientY
    }
    view.canvas.onpointercancel = () => {
      drag = null
    }
  }
  if (!studioCamera)
    view.canvas.onpointerup = (e) => {
      if (e.isPrimary) drag = null
      if (multiTouch) return
      if (Math.hypot(e.clientX - previous.x, e.clientY - previous.y) > 6) return
      const mesh = scene.pick(scene.pointerX, scene.pointerY)?.pickedMesh
      for (let n = mesh; n; n = n.parent)
        if (pickOwners.has(n)) {
          if (onPick?.(pickOwners.get(n))) return
          break
        }
      for (let n = mesh; n; n = n.parent) {
        if (extras(n).roomId && !focus) {
          selectRoom(extras(n).roomId)
          return
        }
      }
      if (focus) {
        const ray = scene.createPickingRay(
          scene.pointerX,
          scene.pointerY,
          Matrix.Identity(),
          camera,
        )
        // Test in anchor-local coordinates so the box rotates and scales with its owner.
        let nearest
        for (const s of layout.spots) {
          const item = layout.items.find((i) => i.id === s.anchor)
          if ((item?.room || s.anchor) !== focus) continue
          const room = rooms.get(focus).getWorldMatrix()
          const matrix = item
            ? Matrix.Compose(
                v(item.scale),
                Quaternion.FromArray(item.rotation),
                v(item.position),
              ).multiply(room)
            : room
          const local = ray.constructor.Transform(ray, matrix.clone().invert())
          const half = v(s.size).scale(0.5),
            point = v(s.position)
          if (
            local.intersectsBoxMinMax(point.subtract(half), point.add(half))
          ) {
            const distance = Vector3.Distance(ray.origin, spotWorld(s))
            if (!nearest || distance < nearest.distance)
              nearest = { s, distance }
          }
        }
        if (nearest) onSpot?.(nearest.s)
      }
    }
  if (draft) applyItems(layout)
  markers()
  resize()
  view.loading.hidden = true
  let drawUntil = performance.now() + 1200,
    ready = false
  const wake = () => {
    drawUntil = performance.now() + 1250
  }
  for (const event of ['pointerdown', 'pointermove', 'wheel', 'touchend'])
    view.host.addEventListener(event, wake, { passive: true })
  const redraw = new ResizeObserver(wake)
  redraw.observe(view.host)
  engine.onContextRestoredObservable.add(wake)
  scene.executeWhenReady(() => {
    ready = true
    wake()
    scene.onAfterRenderObservable.addOnce(() => onReady?.())
    performance.mark('riragi-world-ready')
  })
  // Something playing an animation (a giraffe's motion) keeps the scene
  // drawing; otherwise it sleeps until the next interaction.
  let animating = () => false
  engine.runRenderLoop(() => {
    if (view.host.inert) return
    const motionFrame = motion.advance(performance.now())
    if (
      ready &&
      !motionFrame &&
      !animating() &&
      performance.now() > drawUntil &&
      !camera.inertialAlphaOffset &&
      !camera.inertialBetaOffset
    )
      return
    scene.render()
    const width = view.canvas.clientWidth,
      height = view.canvas.clientHeight
    const port = camera.viewport.toGlobal(width, height)
    const project = (pos) =>
      Vector3.Project(
        pos,
        Matrix.IdentityReadOnly,
        scene.getTransformMatrix(),
        port,
      )
    const activePin =
      selectedLight && marks.find((m) => m.light === selectedLight)
    const anchor = activePin?.pos()
    const handle = anchor && project(anchor)
    const placed = []
    for (const m of marks) {
      const pos = m.pos()
      if (!pos) {
        m.node.hidden = true
        continue
      }
      const p = project(pos)
      if (handle && m !== activePin) {
        // A nearby HTML pin would swallow the tip of a 3D arrow or rotation
        // ring. Give the selected tool its screen space until deselection.
        const dx = Math.max(0, Math.abs(p.x - handle.x) - m.width / 2)
        const middle = m.light ? p.y : p.y - m.height / 2
        const dy = Math.max(0, Math.abs(middle - handle.y) - m.height / 2)
        if (Math.hypot(dx, dy) < 78) {
          m.node.hidden = true
          continue
        }
      }
      if (
        m.light &&
        (p.x < 0 ||
          p.x > width ||
          p.y < 0 ||
          p.y > height ||
          p.z < 0 ||
          p.z > 1)
      ) {
        m.node.hidden = true
        continue
      }
      m.node.hidden = false
      const x = Math.max(m.width / 2, Math.min(width - m.width / 2, p.x))
      let y = p.y
      if (focus) {
        for (const bounds of placed) {
          if (
            Math.abs(x - bounds.x) < (m.width + bounds.width) / 2 + 6 &&
            Math.abs(y - bounds.y) < m.height + 12
          )
            y = bounds.y + m.height + 12
        }
        placed.push({ x, y, width: m.width })
      }
      m.node.style.left = x + 'px'
      m.node.style.top = y + 'px'
    }
  })
  const viewer = {
    selectRoom,
    zoom: magnify,
    // What placed characters need, in the visitor scene too.
    wake,
    scene,
    rooms,
    // Other things in the scene (characters) register their nodes here as
    // node → selection so a click on them selects or opens them.
    owners: pickOwners,
    includeClayGiraffe: motion.includeGiraffe,
    // Clay motion over a whole mesh; marked vertices still keep their shape.
    includeClay: (mesh) => motion.include(mesh),
    /** Lights a material added by the studio like the room's furniture. */
    // Each material is styled once; meshes of a model often share one.
    styleMaterial(material) {
      if (!material?.albedoColor || material.unlit || styledExtra.has(material))
        return
      styledExtra.add(material)
      illumination?.style(material)
    },
    /** `fn()` returns true while something animates and needs frames. */
    keepDrawing(fn) {
      animating = fn
      wake()
    },
    dispose() {
      gestures.abort()
      redraw.disconnect()
      obs.disconnect()
      scene.dispose()
      engine.dispose()
    },
  }
  if (!studioCamera && mode !== 'layout') return viewer
  const cameraView = {
    pose: () => ({
      target: camera.target.asArray(),
      alpha: camera.alpha,
      beta: camera.beta,
      zoom,
      focus,
    }),
    restorePose(pose) {
      camera.setTarget(v(pose.target))
      camera.alpha = pose.alpha
      camera.beta = pose.beta
      camera.inertialAlphaOffset = camera.inertialBetaOffset = 0
      zoom = pose.zoom
      focus = pose.focus
      resize()
      markers()
      wake()
    },
  }

  // Floor footprints are measured once, before any furniture is added.
  const roomBounds = new Map(
    [...rooms].map(([id, n]) => {
      const { min, max } = n.getHierarchyBoundingVectors(true)
      return [id, { min, max }]
    }),
  )
  return {
    ...viewer,
    ...cameraView,
    camera,
    roomBounds,
    overview: () => look(center, 1),
    instances,
    get claySurfaceFrame() {
      return motion.surfaceFrame
    },
    setClayMotion(settings) {
      motion.set(settings)
      wake()
    },
    look,
    get zoomLevel() {
      return zoom
    },
    // Furniture wins over the room that contains it.
    pick(x, y) {
      const mesh = scene.pick(
        x,
        y,
        (mesh) => mesh.isPickable && mesh.isEnabled() && mesh.isVisible,
      )?.pickedMesh
      const owners = new Map([...instances].map(([id, n]) => [n, id]))
      for (let n = mesh; n; n = n.parent) {
        if (pickOwners.has(n)) return pickOwners.get(n)
        if (owners.has(n)) return { type: 'item', id: owners.get(n) }
        if (extras(n).roomId) return { type: 'room', id: extras(n).roomId }
      }
      return null
    },
    roomPoint(x, y, id) {
      const room = rooms.get(id)
      const hit = scene.pick(
        x,
        y,
        (mesh) =>
          mesh.isPickable &&
          mesh.isEnabled() &&
          mesh.isVisible &&
          // A character never stands on itself or on another character.
          !pickOwners.has(mesh) &&
          (room
            ? mesh.isDescendantOf(room)
            : [...rooms.values()].some((r) => mesh.isDescendantOf(r))),
      )
      if (!hit?.pickedPoint) return null
      if (!room) return hit.pickedPoint.asArray()
      return Vector3.TransformCoordinates(
        hit.pickedPoint,
        room.getWorldMatrix().clone().invert(),
      ).asArray()
    },
    /**
     * Where the pointer's ray meets the floor plane of the room under it, as
     * `{ room, point }` in that room's own coordinates, or null when the ray
     * misses every room. Walls and props in front of the floor are ignored,
     * so a character is placed where the operator sees the floor.
     */
    floorPoint(x, y, prefer) {
      const ray = scene.createPickingRay(x, y, Matrix.Identity(), camera)
      if (Math.abs(ray.direction.y) < 1e-6) return null
      const at = (height) =>
        ray.origin.add(
          ray.direction.scale((height - ray.origin.y) / ray.direction.y),
        )
      const inside = (p, id) => {
        const { min, max } = roomBounds.get(id)
        return p.x >= min.x && p.x <= max.x && p.z >= min.z && p.z <= max.z
      }
      const ids = [...rooms.keys()]
      const order = prefer
        ? [prefer, ...ids.filter((id) => id !== prefer)]
        : ids
      for (const id of order) {
        const room = rooms.get(id)
        const matrix = room.computeWorldMatrix(true)
        const p = at(matrix.getTranslation().y)
        if (!inside(p, id)) continue
        return {
          room: id,
          point: Vector3.TransformCoordinates(
            p,
            matrix.clone().invert(),
          ).asArray(),
        }
      }
      return null
    },
    chooseLight(id) {
      if (selectedLight === id) return
      selectedLight = id
      guide?.(activeLight())
      markers()
      wake()
    },
    chooseSpot(id) {
      if (chosenSpot === id) return
      chosenSpot = id
      markers()
    },
    showBox(s) {
      wake()
      if (!box) {
        box = MeshBuilder.CreateBox('클릭 범위', { size: 1 }, scene)
        box.isPickable = false
        const mat = new StandardMaterial('클릭 영역', scene)
        mat.emissiveColor = new Color3(0.5, 0.9, 0.18)
        mat.alpha = 0.28
        box.material = mat
      }
      box.setEnabled(!!s)
      if (s) {
        box.parent = instances.get(s.anchor) || rooms.get(s.anchor)
        box.position = v(s.position)
        box.scaling = v(s.size)
      }
    },
    itemMoved(changedRoom) {
      wake()
      if (changedRoom) {
        updateIllumination(layout)
      }
    },
    updateLights(next) {
      layout = next
      updateIllumination(next)
      guide(activeLight())
      wake()
    },
    update(next) {
      wake()
      layout = next
      motion.set(next.defaults?.clayMotion)
      applyItems(next)
      guide?.(activeLight())
      markers()
    },
  }
}
