import { characterLayer } from './studio-characters.js'

// Characters of the published world in the visitor scene. Their files come
// from the list fixed at publication (`state.characters`). Only the room a
// visitor chose moves; the overview moves a few, fewer on touch devices, and
// the rest hold their first pose. A character linked to an event page opens
// it when tapped.

const overviewLimit = () =>
  globalThis.matchMedia?.('(pointer: coarse)').matches ? 8 : 24

export function visitorCharacters(world, state, { onPage } = {}) {
  const sheet = state.characters
  const list = state.layout.characters ?? []
  if (!sheet || !list.length) return null
  let room = null
  const apply = () =>
    layer.setActive(
      room
        ? list.filter((c) => c.room === room).map((c) => c.id)
        : list.slice(0, overviewLimit()).map((c) => c.id),
    )
  const layer = characterLayer(world, {
    fileUrl: (id) => sheet.base + id + '.glb',
    standIn: false,
    shadows: true,
    onLoad() {
      layer.update(state.layout)
      apply()
      world.wake()
    },
  })
  layer.setLibrary({
    models: Object.entries(sheet.models).map(([id, m]) => ({ id, ...m })),
    motions: [],
    fallback: sheet.fallback,
  })
  apply()
  layer.update(state.layout)
  return Object.freeze({
    /** The room the visitor is looking at, or null for the overview. */
    focus(id) {
      room = id ?? null
      apply()
      world.wake()
    },
    /** Character counts for the `?perf` readout. */
    stats: () => layer.stats(),
    /** Opens a tapped character's page; false when it has none. */
    pick(owner) {
      if (owner?.type !== 'character') return false
      const c = list.find((x) => x.id === owner.id)
      if (!c?.page || !onPage) return false
      onPage(c.page, c)
      return true
    },
  })
}
