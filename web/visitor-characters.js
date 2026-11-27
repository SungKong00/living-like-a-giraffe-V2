import { characterLayer, screenPolicy } from './characters/index.js'

// Characters of the published world in the visitor scene. Their files come
// from the list fixed at publication (`state.characters`). Every character on
// screen moves (characters/policy.js). A character linked to an event page
// opens it when tapped.

export function visitorCharacters(world, state, { onPage } = {}) {
  const sheet = state.characters
  const list = state.layout.characters ?? []
  if (!sheet || !list.length) return null
  const layer = characterLayer(world, {
    fileUrl: (id) => sheet.base + id + '.glb',
    standIn: false,
    shadows: true,
    // Small on screen, a character is drawn at a reduced level.
    policy: screenPolicy(world, { lods: true }),
    onLoad() {
      layer.update(state.layout)
      world.wake()
    },
  })
  layer.setLibrary({
    models: Object.entries(sheet.models).map(([id, m]) => ({ id, ...m })),
    motions: [],
    fallback: sheet.fallback,
  })
  layer.update(state.layout)
  return Object.freeze({
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
