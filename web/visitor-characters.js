import { characterLayer, visitorPolicy } from './characters/index.js'

// Characters of the published world in the visitor scene. Their files come
// from the list fixed at publication (`state.characters`). Which of them move
// is the visitor policy's rule (characters/policy.js); the rest hold their
// first pose. A character linked to an event page opens it when tapped.

export function visitorCharacters(world, state, { onPage } = {}) {
  const sheet = state.characters
  const list = state.layout.characters ?? []
  if (!sheet || !list.length) return null
  const policy = visitorPolicy(list)
  const layer = characterLayer(world, {
    fileUrl: (id) => sheet.base + id + '.glb',
    standIn: false,
    shadows: true,
    policy,
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
    /** The room the visitor is looking at, or null for the overview. */
    focus(id) {
      policy.focus(id)
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
