import { MeshoptCompression } from '@babylonjs/core/Meshes/Compression/meshoptCompression'
import decoderURL from '../node_modules/meshoptimizer/meshopt_decoder.cjs?url'
MeshoptCompression.Configuration.decoder.url = decoderURL
import { Engine } from '@babylonjs/core/Engines/engine'
import { Scene } from '@babylonjs/core/scene'
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera'
import { Camera } from '@babylonjs/core/Cameras/camera'
import { Vector3, Quaternion, Matrix } from '@babylonjs/core/Maths/math.vector'
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color'
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight'
import { PointLight } from '@babylonjs/core/Lights/pointLight'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight'
import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader'
import '@babylonjs/loaders/glTF/2.0'
import '@babylonjs/loaders/glTF/glTFFileLoader'
import { el } from './ui.js'

const v = (arr) => Vector3.FromArray(arr)
export async function createScene(
  view,
  state,
  { editing = false, preview = false, onRoom, onSpot, onItem } = {},
) {
  const draft = editing || preview
  const engine = new Engine(
    view.canvas,
    true,
    { stencil: true, preserveDrawingBuffer: false },
    false,
  )
  const scene = new Scene(engine)
  scene.useRightHandedSystem = true
  scene.clearColor = new Color4(0.895, 0.895, 0.842, 1)
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
  camera.lowerAlphaLimit = alpha - 0.175
  camera.upperAlphaLimit = alpha + 0.175
  camera.lowerBetaLimit = camera.upperBetaLimit = camera.beta
  camera.lowerRadiusLimit = camera.upperRadiusLimit = 150
  camera.inputs.removeByType('ArcRotateCameraMouseWheelInput')
  camera.panningSensibility = 0
  camera.attachControl(view.canvas, true)
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
  let box
  const styled = new Map(),
    materials = new WeakMap(),
    instances = new Map(originals)
  let shadow
  if (draft) {
    const { ShadowGenerator } =
      await import('@babylonjs/core/Lights/Shadows/shadowGenerator')
    await import('@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent')
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
    function add(label, pos, action, cls) {
      const node = el(
        'button',
        { class: 'pin ' + cls, type: 'button', onclick: action },
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
          'spot',
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
  const obs = new ResizeObserver(resize)
  obs.observe(view.host)
  const previous = { x: 0, y: 0 }
  view.canvas.onpointerdown = (e) => {
    previous.x = e.clientX
    previous.y = e.clientY
  }
  view.canvas.onpointerup = (e) => {
    if (Math.hypot(e.clientX - previous.x, e.clientY - previous.y) > 6) return
    const mesh = scene.pick(scene.pointerX, scene.pointerY)?.pickedMesh
    for (let n = mesh; n; n = n.parent) {
      const entry = [...instances].find(([, obj]) => n === obj)
      if (editing && entry) {
        onItem?.(entry[0])
        return
      }
      if (extras(n).roomId && !editing && !focus) {
        selectRoom(extras(n).roomId)
        return
      }
    }
    if (!editing && focus) {
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
        if (local.intersectsBoxMinMax(point.subtract(half), point.add(half))) {
          const distance = Vector3.Distance(ray.origin, spotWorld(s))
          if (!nearest || distance < nearest.distance) nearest = { s, distance }
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
  return {
    scene,
    camera,
    instances,
    selectRoom,
    resize,
    showBox(s) {
      if (!editing) return
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
    zoom(delta) {
      wake()
      zoom = Math.min(2, Math.max(0.75, zoom + delta))
      resize()
    },
    update(next) {
      layout = next
      if (draft) applyItems(next)
      markers()
    },
    dispose() {
      redraw.disconnect()
      obs.disconnect()
      scene.dispose()
      engine.dispose()
    },
  }
}
