import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader'
import '@babylonjs/loaders/glTF/2.0'

// The library's files as loaded: models and motion files. Each is read once,
// when a character first needs it, and kept until the library drops it. This
// module does not know which characters stand in the scene.

/**
 * `fileUrl(id)` gives a library file's address; `onLoad()` runs when a model
 * finishes loading (or fails), so characters can respawn.
 */
export function characterAssets(scene, { fileUrl, onLoad }) {
  const models = new Map()
  const motions = new Map()
  let library = { models: [], motions: [], fallback: null }
  const load = (id) =>
    LoadAssetContainerAsync(fileUrl(id), scene, { pluginExtension: '.glb' })

  const info = (id) => library.models.find((m) => m.id === id)
  function motionFile(id) {
    if (!motions.has(id))
      motions.set(
        id,
        load(id).catch((e) => {
          motions.delete(id)
          throw e
        }),
      )
    return motions.get(id)
  }
  return {
    /** The library in use. */
    get library() {
      return library
    },
    /** Uses a new library and frees the models that left it. */
    setLibrary(next) {
      library = next
      for (const [file, slot] of models)
        if (!next.models.some((m) => m.file === file)) {
          slot.loading.then(() => slot.container?.dispose())
          models.delete(file)
        }
    },
    /** The library's entry for a model ID, or undefined. */
    info,
    /**
     * The loaded file of a model, keyed by file so a replaced file reloads:
     * { file, container, failed } once settled; container is null until
     * then. null when the library has no such model.
     */
    model(id) {
      const m = id && info(id)
      if (!m) return null
      let slot = models.get(m.file)
      if (!slot) {
        slot = { file: m.file, container: null, failed: false }
        slot.loading = load(m.file)
          .then((container) => (slot.container = container))
          .catch(() => (slot.failed = true))
          .finally(() => onLoad?.())
        models.set(m.file, slot)
      }
      return slot
    },
    /** The clip `file/name` as its motion file holds it, or null. */
    async clip(motion) {
      const [file, ...rest] = motion.split('/')
      const name = rest.join('/')
      const container = await motionFile(file).catch(() => null)
      return container?.animationGroups.find((a) => a.name === name) ?? null
    },
  }
}
