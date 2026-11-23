import { Engine } from '@babylonjs/core/Engines/engine'
import { Scene } from '@babylonjs/core/scene'
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera'
import { Camera } from '@babylonjs/core/Cameras/camera'
import { Viewport } from '@babylonjs/core/Maths/math.viewport'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color'
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight'
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader'
import '@babylonjs/loaders/glTF/2.0'
import '@babylonjs/loaders/glTF/glTFFileLoader'
import { clayDeformer } from './clay-geometry.js'

function contactShadow(scene) {
  const ground = MeshBuilder.CreateGround(
    '바닥 그림자',
    { width: 1, height: 1 },
    scene,
  )
  const texture = new DynamicTexture('부드러운 접지 그림자', 128, scene)
  const ctx = texture.getContext()
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 63)
  gradient.addColorStop(0, 'rgba(75,53,34,0.34)')
  gradient.addColorStop(0.53, 'rgba(75,53,34,0.17)')
  gradient.addColorStop(1, 'rgba(75,53,34,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 128, 128)
  texture.hasAlpha = true
  texture.update()
  const material = new StandardMaterial('그림자', scene)
  material.disableLighting = true
  material.emissiveColor = Color3.White()
  material.diffuseTexture = texture
  material.useAlphaFromDiffuseTexture = true
  ground.material = material
  ground.isPickable = false
  ground.position.y = -0.02
  return ground
}

function compareMesh(original, kind, deforms, wearable = null) {
  const sample = original.clone(original.name + ' 점토', original.parent, true)
  original.layerMask = 1
  sample.layerMask = 2
  original.isPickable = sample.isPickable = false
  sample.skeleton = original.skeleton
  let deform
  if (deforms) {
    sample.makeGeometryUnique()
    for (const attribute of ['position', 'normal'])
      sample.setVerticesData(
        attribute,
        sample.getVerticesData(attribute).slice(),
        true,
      )
    deform = clayDeformer(sample, kind)
  }
  return { original, sample, deform, wearable }
}

async function loadComparison(scene) {
  const load = (url) =>
    ImportMeshAsync(url, scene, {
      pluginExtension: '.glb',
      pluginOptions: {
        gltf: { createInstances: false, animationStartMode: 0 },
      },
    })
  const [bench, giraffe] = await Promise.all([
    load('/api/admin/clay-samples'),
    load('/api/admin/clay-giraffe'),
  ])
  const pieces = bench.meshes.filter((mesh) => mesh.getTotalVertices())
  for (const mesh of pieces) {
    mesh.computeWorldMatrix(true)
    mesh.increaseVertices(23)
  }
  const original = Mesh.MergeMeshes(pieces, true, true, undefined, false, true)
  const parts = giraffe.meshes
    .filter((m) => m.getTotalVertices())
    .map((m) => {
      let name = m.name
      let parent = m.parent
      while (parent && !name.startsWith('Wear.')) {
        if (parent.name.startsWith('Wear.')) name = parent.name
        parent = parent.parent
      }
      const wearable = name.startsWith('Wear.Cape')
        ? 'cape'
        : name.startsWith('Wear.Flower')
          ? 'flower'
          : null
      // The clip's geometry is local to a bone socket. Its attachment is rigid.
      return compareMesh(m, 'giraffe', wearable !== 'flower', wearable)
    })
  return {
    parts: { bench: [compareMesh(original, 'bench', true)], giraffe: parts },
    glance: giraffe.animationGroups.find(
      (group) => group.name === 'LookAround',
    ),
  }
}

export async function clayScene(canvas) {
  const engine = new Engine(canvas, true, { stencil: true })
  const scene = new Scene(engine)
  scene.useRightHandedSystem = true
  scene.clearColor = Color4.FromHexString('#eeeae3ff')
  const cameras = [1, 2].map((mask, i) => {
    const camera = new ArcRotateCamera(
      '비교 ' + i,
      0,
      1,
      10,
      Vector3.Zero(),
      scene,
    )
    camera.viewport = new Viewport(i / 2, 0, 0.5, 1)
    camera.layerMask = mask
    camera.mode = Camera.ORTHOGRAPHIC_CAMERA
    camera.lowerRadiusLimit = 3
    camera.upperRadiusLimit = 20
    camera.upperBetaLimit = Math.PI / 2 - 0.02
    camera.panningSensibility = 0
    camera.wheelDeltaPercentage = 0.012
    return camera
  })
  const [camera, twin] = cameras
  scene.activeCameras = cameras
  scene.activeCamera = camera
  camera.attachControl(canvas, true)
  const sky = new HemisphericLight('천장 반사광', new Vector3(0, 1, 0), scene)
  sky.intensity = 0.8
  sky.groundColor = Color3.FromHexString('#b4a696')
  const key = new DirectionalLight(
    '왼쪽 위 조명',
    new Vector3(-0.5, -0.85, -0.65),
    scene,
  )
  key.intensity = 2.0
  const shadow = contactShadow(scene)
  let models = {},
    glance,
    outfit = 'none',
    moving = false
  let selected = 'bench'
  const resize = new ResizeObserver(() => engine.resize())
  resize.observe(canvas)
  function dispose() {
    resize.disconnect()
    for (const part of Object.values(models).flat()) part.deform?.dispose()
    scene.dispose()
    engine.dispose()
  }
  function frame() {
    const bench = selected === 'bench'
    camera.inertialAlphaOffset =
      camera.inertialBetaOffset =
      camera.inertialRadiusOffset =
        0
    camera.setTarget(new Vector3(0, bench ? 0.32 : 1.85, bench ? 0 : 0.1))
    camera.alpha = bench ? 0.66 : 1.01
    camera.beta = bench ? 1.02 : 1.32
    camera.radius = 10
  }
  function refresh() {
    for (const [id, parts] of Object.entries(models)) {
      for (const { original, sample, wearable } of parts) {
        const visible =
          id === selected &&
          (!wearable || outfit === wearable || outfit === 'both')
        original.isVisible = sample.isVisible = visible
      }
    }
    if (glance) {
      if (selected === 'giraffe' && moving) {
        if (!glance.isPlaying) glance.play(true)
      } else {
        if (!glance.isStarted) glance.start(true)
        glance.goToFrame(glance.from)
        glance.pause()
      }
    }
  }
  function show(kind) {
    selected = kind
    refresh()
    const bench = kind === 'bench'
    shadow.scaling.set(bench ? 3.4 : 2.35, 1, bench ? 9 : 3.55)
    key.intensity = bench ? 2.0 : 1.7
    sky.intensity = bench ? 0.8 : 0.76
    frame()
  }
  try {
    const comparison = await loadComparison(scene)
    models = comparison.parts
    glance = comparison.glance
    show(selected)
    scene.onBeforeCameraRenderObservable.add((drawing) => {
      if (drawing === twin) {
        twin.alpha = camera.alpha
        twin.beta = camera.beta
        twin.radius = camera.radius
        twin.target.copyFrom(camera.target)
        twin.getViewMatrix(true)
      }
      const aspect = engine.getRenderWidth() / (2 * engine.getRenderHeight())
      const bench = selected === 'bench'
      const height =
        (Math.max(bench ? 1.85 : 2.34, (bench ? 3.72 : 1.38) / aspect) *
          camera.radius) /
        10
      drawing.orthoTop = height
      drawing.orthoBottom = -height
      drawing.orthoLeft = -height * aspect
      drawing.orthoRight = height * aspect
      drawing.getProjectionMatrix(true)
      scene.setTransformMatrix(
        drawing.getViewMatrix(),
        drawing.getProjectionMatrix(),
      )
    })
    engine.runRenderLoop(() => scene.render())
    return {
      show,
      apply: (settings) => {
        for (const part of models[selected]) part.deform?.apply(settings)
      },
      dress(value) {
        outfit = value
        refresh()
      },
      pose(value) {
        moving = value === 'look'
        refresh()
      },
      frame,
      dispose,
    }
  } catch (error) {
    dispose()
    throw error
  }
}
