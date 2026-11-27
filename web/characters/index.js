import { characterAssets } from './assets.js'
import { characterCast, characterModel, characterMotion } from './cast.js'
import { characterView } from './view.js'

// Characters in a scene, assembled from what each part owns (ADR 0006):
// `assets` reads and keeps the library's files, `cast` holds what every
// character is doing, `pose` turns clips into joint values and `view` draws
// them. Code outside this folder imports this file only.

export { characterModel, characterMotion, motionList } from './cast.js'

const adminFile = (id) => '/api/admin/characters/files/' + id + '.glb'

/**
 * `onLoad()` runs when a model finishes loading so characters can respawn;
 * `onRoute(id)` when a character's route has read its clips and can walk.
 * `fileUrl(id)` gives a library file's address (the studio's by default);
 * `standIn` draws a placeholder while a model loads or is missing; `shadows`
 * lays a soft round shadow under each character.
 */
export function characterLayer(
  world,
  {
    onLoad,
    onRoute,
    fileUrl = adminFile,
    standIn = true,
    shadows = false,
  } = {},
) {
  const assets = characterAssets(world.scene, { fileUrl, onLoad })
  const view = characterView(world, { standIn, shadows })
  const cast = characterCast(world, assets, { onRoute })
  world.keepDrawing(cast.animating)
  function release(entry) {
    cast.remove(entry)
    view.release(entry)
  }

  return Object.freeze({
    /** Uses a new library; characters whose model left it respawn. */
    setLibrary: assets.setLibrary,
    update(layout) {
      const list = layout.characters ?? []
      for (const entry of [...cast.entries()])
        if (!list.some((c) => c.id === entry.id)) release(entry)
      for (const c of list) {
        const m = assets.info(characterModel(assets.library, c))
        const slot = assets.model(m?.id)
        const container = slot?.container ?? null
        let entry = cast.get(c.id)
        // Respawn when the model or its file changed or finished loading.
        if (entry && entry.file !== (container ? slot.file : null)) {
          release(entry)
          entry = null
        }
        entry ??= cast.add(c.id, view.spawn(c, slot?.file, container, m))
        view.place(entry, c, m)
        cast.perform(entry, c, m, characterMotion(layout, c))
      }
    },
    /** The node that carries a character's placement, or undefined. */
    root: (id) => cast.get(id)?.root,
    /**
     * 'ready' once the character shows its model, 'loading' while it loads,
     * 'missing' when the model is gone from the library or failed to load.
     */
    state(layout, c) {
      const slot = assets.model(characterModel(assets.library, c))
      if (!slot || slot.failed) return 'missing'
      return cast.get(c.id)?.file === slot.file ? 'ready' : 'loading'
    },
    proportionDimensions: (id) => cast.get(id)?.proportions?.dimensions,
    /** Lets only these character IDs move (null: all); others hold still. */
    setActive: cast.setActive,
    /**
     * The studio's selected character `id` stands at its first point, or
     * walks its route from the start while `playing`. null lets every
     * character walk again from its own starting point.
     */
    rehearse: cast.rehearse,
    /**
     * How a character's route plays, or null without one: `loaded` once its
     * clips are read, `ready` when it can walk (false when the walk clip
     * cannot move the model), `speed` and `natural` in m/s, `pace` the walk
     * clip's rate before it is kept between ×0.5 and ×2, `stride` measured
     * in metres at 100% and `duration` of one lap in seconds.
     */
    route: cast.route,
    /**
     * How clay keeps the face: 'vertices' (the model's marked vertices),
     * 'giraffe' (by height on a giraffe skeleton) or null.
     */
    protection: (id) => cast.get(id)?.protection ?? null,
    /** True when clay keeps the character's face by the giraffe rule. */
    head: (id) => !!cast.get(id)?.head,
    /** How many characters there are and how many compute a pose each frame. */
    stats: cast.stats,
    /** True while the character is playing a clip (for tests and the inspector). */
    playing: cast.playing,
  })
}
