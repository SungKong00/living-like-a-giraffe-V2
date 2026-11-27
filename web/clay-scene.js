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
import { giraffeProportions } from './giraffe-proportions.js'
import {
  LoadAssetContainerAsync,
  ImportMeshAsync,
} from '@babylonjs/core/Loading/sceneLoader'
import '@babylonjs/loaders/glTF/2.0'
import '@babylonjs/loaders/glTF/glTFFileLoader'
import { clayMotion } from './clay-motion.js'
import { characterClayField } from './clay-field.js'
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

function compareMesh(
  original,
  deforms,
  wearable = null,
  characterField,
  sample = original.clone(original.name + ' 점토', original.parent, true),
) {
  original.layerMask = 1
  sample.layerMask = 2
  original.isPickable = sample.isPickable = false
  let deform
  if (deforms) {
    sample.makeGeometryUnique()
    for (const attribute of ['position', 'normal'])
      sample.setVerticesData(
        attribute,
        sample.getVerticesData(attribute).slice(),
        true,
      )
    deform = clayDeformer(sample, characterField)
  }
  return { original, sample, deform, wearable }
}

async function loadBench(scene) {
  const bench = await ImportMeshAsync('/api/admin/clay-samples', scene, {
    pluginExtension: '.glb',
    pluginOptions: { gltf: { createInstances: false, animationStartMode: 0 } },
  })
  const pieces = bench.meshes.filter((mesh) => mesh.getTotalVertices())
  for (const mesh of pieces) {
    mesh.computeWorldMatrix(true)
    mesh.increaseVertices(23)
  }
  const original = Mesh.MergeMeshes(pieces, true, true, undefined, false, true)
  return { parts: [compareMesh(original, true)] }
}

async function loadCharacter(scene, kind) {
  const biped = kind === 'biped'
  const giraffe = await LoadAssetContainerAsync(
    biped
      ? '/api/admin/characters/files/riragi-biped.glb'
      : '/api/admin/clay-giraffe',
    scene,
    {
      pluginExtension: '.glb',
      pluginOptions: {
        gltf: { createInstances: false, animationStartMode: 0 },
      },
    },
  )
  giraffe.addAllToScene()
  const copy = giraffe.instantiateModelsToScene((name) => name, false, {
    doNotInstantiate: true,
  })
  const nodes = new Map(
    copy.rootNodes
      .flatMap((root) => [root, ...root.getDescendants()])
      .map((node) => [node.name, node]),
  )
  const proportions = giraffeProportions(scene, nodes)
  // A single clock drives both independent rigs so clothing and pose match.
  const glance = giraffe.animationGroups.find(
    (g) => g.name === (biped ? '두 발 걷기' : 'LookAround'),
  )
  for (const group of copy.animationGroups) {
    if (group.name === glance?.name)
      for (const track of group.targetedAnimations)
        glance.addTargetedAnimation(track.animation, track.target)
    group.dispose()
  }
  const rest = glance?.targetedAnimations.map(({ target, animation }) => {
    const property = animation.targetProperty
    return { target, property, value: target[property].clone() }
  })
  function setMoving(active) {
    if (!glance || active === glance.isPlaying) return
    if (active) glance.play(true)
    else {
      glance.stop()
      for (const { target, property, value } of rest)
        target[property] = value.clone()
    }
  }
  // The studio asset's skinned vertex buffers share one ground-based rest space.
  const min = new Vector3(Infinity, Infinity, Infinity)
  const max = min.scale(-1)
  for (const mesh of giraffe.meshes) {
    if (!mesh.skeleton || !mesh.getTotalVertices()) continue
    const box = mesh.getBoundingInfo().boundingBox
    min.minimizeInPlace(box.minimum)
    max.maximizeInPlace(box.maximum)
  }
  const characterField = characterClayField(
    { min: min.asArray(), max: max.asArray() },
    'riragi',
  )
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
      return compareMesh(
        m,
        wearable !== 'flower',
        wearable,
        characterField,
        nodes.get(m.name),
      )
    })
  return {
    parts,
    setMoving,
    proportions,
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
  const motion = clayMotion(scene, twin)
  const models = {},
    loading = new Map()
  let extraHeight = 0,
    outfit = 'none',
    moving = false
  let selected = 'bench'
  const resize = new ResizeObserver(() => engine.resize())
  resize.observe(canvas)
  function dispose() {
    resize.disconnect()
    for (const model of Object.values(models)) {
      model.proportions?.dispose()
      for (const part of model.parts) part.deform?.dispose()
    }
    scene.dispose()
    engine.dispose()
  }
  function frame() {
    const bench = selected === 'bench'
    camera.inertialAlphaOffset =
      camera.inertialBetaOffset =
      camera.inertialRadiusOffset =
        0
    camera.setTarget(
      new Vector3(0, bench ? 0.32 : 2.05 + extraHeight / 2, bench ? 0 : 0.1),
    )
    camera.alpha = bench ? 0.66 : 1.01
    camera.beta = bench ? 1.02 : 1.32
    camera.radius = 10
  }
  function refresh() {
    for (const [id, { parts, setMoving }] of Object.entries(models)) {
      for (const { original, sample, wearable } of parts) {
        const visible =
          id === selected &&
          (!wearable || outfit === wearable || outfit === 'both')
        original.isVisible = sample.isVisible = visible
      }
      setMoving?.(selected === id && moving)
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
    scene.onBeforeCameraRenderObservable.add((drawing) => {
      if (drawing === twin) {
        twin.alpha = camera.alpha
        twin.beta = camera.beta
        twin.radius = camera.radius
        twin.target.copyFrom(camera.target)
        twin.getViewMatrix(true)
      }
      const aspect =
        engine.getRenderWidth(true) / (2 * engine.getRenderHeight(true))
      const bench = selected === 'bench'
      const height =
        (Math.max(
          bench ? 1.85 : 2.52 + extraHeight / 2,
          (bench ? 3.72 : 1.38) / aspect,
        ) *
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
    engine.runRenderLoop(() => {
      motion.advance(performance.now())
      scene.render()
    })
    return {
      async show(kind) {
        show(kind)
        if (models[kind]) return
        if (!loading.has(kind)) {
          const request =
            kind === 'bench' ? loadBench(scene) : loadCharacter(scene, kind)
          loading.set(
            kind,
            request
              .then((model) => {
                models[kind] = model
                if (kind === 'bench') motion.include(model.parts[0].sample)
                else
                  motion.includeGiraffe(
                    model.parts
                      .filter((p) => p.wearable !== 'flower')
                      .map((p) => p.sample),
                  )
                refresh()
              })
              .finally(() => loading.delete(kind)),
          )
        }
        await loading.get(kind)
        await scene.whenReadyAsync()
      },
      get proportionDimensions() {
        return models[selected]?.proportions?.dimensions ?? []
      },
      setMotion: motion.set,
      setProportions(values) {
        models[selected]?.proportions?.set(values)
        extraHeight = Math.max(
          0,
          ((values.legs ?? 1) - 1) * 1.32 +
            ((values.neck ?? 1) - 1) * 1.5 +
            ((values.head ?? 1) - 1) * 0.7 +
            ((values.body ?? 1) - 1) * 0.32,
        )
        if (selected !== 'bench') camera.target.y = 2.05 + extraHeight / 2
      },
      apply: (settings) => {
        for (const part of models[selected]?.parts ?? [])
          part.deform?.apply(settings)
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
