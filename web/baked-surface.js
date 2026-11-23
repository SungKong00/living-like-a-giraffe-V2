import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader'

// The camera switches geometry layers. Editor nodes stay pickable and keep
// their identity for drag handles, anchors and the selection portrait.
export const editorLayer = 1
const bakedLayer = 2
export function bakedSurface(scene, camera, sun) {
  let cached,
    active = false
  camera.layerMask = editorLayer
  function showBaked(next) {
    if (next === active || (next && !cached)) return
    active = next
    if (active) cached.addAllToScene()
    else cached.removeAllFromScene()
    camera.layerMask = active ? bakedLayer : editorLayer
    sun.intensity = active ? 0.65 : 1.5
    sun.shadowEnabled = !active
  }
  async function loadBaked(url, signal) {
    const response = await fetch(url, { signal })
    if (!response.ok) throw Error('구운 조명 파일을 열 수 없습니다.')
    const bytes = new Uint8Array(await response.arrayBuffer())
    signal.throwIfAborted()
    const container = await LoadAssetContainerAsync(bytes, scene, {
      pluginExtension: '.glb',
    })
    if (signal.aborted) {
      container.dispose()
      signal.throwIfAborted()
    }
    for (const mesh of container.meshes) {
      mesh.layerMask = bakedLayer
      mesh.isPickable = false
    }
    for (const light of container.lights)
      light.includeOnlyWithLayerMask = bakedLayer
    showBaked(false)
    cached?.dispose()
    cached = container
  }
  scene.onDisposeObservable.addOnce(() => cached?.dispose())
  return { loadBaked, showBaked }
}
