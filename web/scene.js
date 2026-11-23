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
import { PointLight } from '@babylonjs/core/Lights/pointLight'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight'
import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader'
// scene.pick and createPickingRay silently miss without the Ray side effect.
import '@babylonjs/core/Culling/ray'
import '@babylonjs/loaders/glTF/2.0'
import '@babylonjs/loaders/glTF/glTFFileLoader'
import { el } from './ui.js'

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
  { onRoom, onSpot, onSpotDown, onReady } = {},
) {
  const editing = mode === 'editor'
  const draft = mode !== 'visitor'
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
  const center = new Vector3(34, 1, -24)
  const alpha = Math.PI / 4
  const camera = new ArcRotateCamera(
    '관람',
    alpha,
    Math.PI / 2 - 0.62,
    150,
    center.clone(),
    scene,
  )
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA
  camera.lowerAlphaLimit = alpha - Math.PI / 6
  camera.upperAlphaLimit = alpha + Math.PI / 6
  camera.lowerBetaLimit = Math.PI / 9
  camera.upperBetaLimit = (5 * Math.PI) / 12
  camera.lowerRadiusLimit = camera.upperRadiusLimit = 150
  camera.inputs.removeByType('ArcRotateCameraMouseWheelInput')
  camera.panningSensibility = 0
  camera.attachControl(view.canvas, true)
  // The studio keeps the left button for selecting, moving and panning.
  if (editing) camera.inputs.attached.pointers.buttons = [2]
  const fill = new HemisphericLight('환경', new Vector3(0, 1, 0), scene)
  fill.intensity = 0.85
  const sun = new DirectionalLight(
    '편집 조명',
    new Vector3(-0.5, -1, -0.4),
    scene,
  )
  sun.intensity = draft ? 1.5 : 0.65
  sun.position = new Vector3(60, 70, 12)
  if (draft)
    for (const light of state.lights || []) {
      const point = new PointLight('제작 광원', v(light.position), scene)
      point.diffuse = Color3.FromArray(light.color)
      point.intensity = light.energy / (4 * Math.PI)
      point.radius = Math.max(0.1, light.size / 2)
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
  const nodes = [...imported.meshes, ...imported.transformNodes]
  const extras = (n) => n?.metadata?.gltf?.extras || {}
  const rooms = new Map(
    nodes.filter((n) => extras(n).roomId).map((n) => [extras(n).roomId, n]),
  )
  try {
    await addStudioFloor(scene, rooms)
  } catch (error) {
    scene.dispose()
    engine.dispose()
    throw error
  }
  const originals = new Map(
    nodes.filter((n) => extras(n).itemId).map((n) => [extras(n).itemId, n]),
  )
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
  let box,
    chosenSpot = null
  const styled = new Map(),
    materials = new WeakMap(),
    instances = new Map(originals)
  let shadow
  if (draft) {
    const { ShadowGenerator } =
      await import('@babylonjs/core/Lights/Shadows/shadowGenerator')
    await import('@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent')
    // Register the shadow shaders before the generator compiles them.
    await Promise.all([
      import('@babylonjs/core/Shaders/shadowMap.vertex'),
      import('@babylonjs/core/Shaders/shadowMap.fragment'),
    ])
    shadow = new ShadowGenerator(1024, sun)
    shadow.usePercentageCloserFiltering = true
    for (const mesh of imported.meshes) {
      mesh.receiveShadows = true
    }
  }
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
          styled.set(key, mat)
        }
        mesh.material = styled.get(key)
        mesh.receiveShadows = true
      }
    }
    if (shadow)
      shadow.getShadowMap().renderList = [...instances.values()].flatMap((n) =>
        n.getChildMeshes(),
      )
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
    function add(label, pos, action, cls, down) {
      const node = el(
        'button',
        {
          class: 'pin ' + cls,
          type: 'button',
          onclick: action,
          onpointerdown: down,
        },
        label,
      )
      view.overlay.append(node)
      marks.push({
        node,
        pos,
        width: node.offsetWidth,
        height: node.offsetHeight,
      })
    }
    if (!focus && !editing)
      for (const r of state.rooms) {
        const n = rooms.get(r.id)
        if (n)
          add(
            r.label,
            () => n.getAbsolutePosition(),
            () => selectRoom(r.id),
            'room',
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
          'spot' + (s.id === chosenSpot ? ' chosen' : ''),
          editing ? (event) => onSpotDown?.(s, event) : undefined,
        )
      }
  }
  function resize() {
    engine.resize()
    const aspect =
      view.canvas.clientWidth / Math.max(1, view.canvas.clientHeight)
    const width = focus ? 45 : 103
    const half = Math.max(width / aspect, focus ? 33 : 65) / (2 * zoom)
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
    resize()
    markers()
    onRoom?.(id)
  }
  function look(target, nextZoom = zoom) {
    camera.setTarget(target.clone())
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
    }
    zoom = next
    resize()
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
  if (!editing)
    view.canvas.onpointerdown = (e) => {
      if (e.isPrimary) multiTouch = false
      previous.x = e.clientX
      previous.y = e.clientY
    }
  if (!editing)
    view.canvas.onpointerup = (e) => {
      if (multiTouch) return
      if (Math.hypot(e.clientX - previous.x, e.clientY - previous.y) > 6) return
      const mesh = scene.pick(scene.pointerX, scene.pointerY)?.pickedMesh
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
  engine.runRenderLoop(() => {
    if (
      !draft &&
      ready &&
      performance.now() > drawUntil &&
      !camera.inertialAlphaOffset &&
      !camera.inertialBetaOffset
    )
      return
    scene.render()
    const width = view.canvas.clientWidth,
      height = view.canvas.clientHeight
    const port = camera.viewport.toGlobal(width, height)
    const placed = []
    for (const m of marks) {
      const pos = m.pos()
      if (!pos) {
        m.node.hidden = true
        continue
      }
      const p = Vector3.Project(
        pos,
        Matrix.Identity(),
        scene.getTransformMatrix(),
        port,
      )
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
    dispose() {
      gestures.abort()
      redraw.disconnect()
      obs.disconnect()
      scene.dispose()
      engine.dispose()
    },
  }
  if (!editing) return viewer
  // Floor footprints are measured once, before any furniture is added.
  const roomBounds = new Map(
    [...rooms].map(([id, n]) => {
      const { min, max } = n.getHierarchyBoundingVectors(true)
      return [id, { min, max }]
    }),
  )
  return {
    ...viewer,
    scene,
    camera,
    rooms,
    roomBounds,
    instances,
    look,
    get zoomLevel() {
      return zoom
    },
    // Furniture wins over the room that contains it.
    pick(x, y) {
      const mesh = scene.pick(x, y)?.pickedMesh
      const owners = new Map([...instances].map(([id, n]) => [n, id]))
      for (let n = mesh; n; n = n.parent) {
        if (owners.has(n)) return { type: 'item', id: owners.get(n) }
        if (extras(n).roomId) return { type: 'room', id: extras(n).roomId }
      }
      return null
    },
    chooseSpot(id) {
      if (chosenSpot === id) return
      chosenSpot = id
      markers()
    },
    showBox(s) {
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
    update(next) {
      layout = next
      applyItems(next)
      markers()
    },
  }
}
