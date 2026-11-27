// Which characters may move. The numbers that bound the work a scene does
// for its characters live in this file only, and nothing here knows what a
// motion or a route contains.
//
// A policy is { moves(id), watch(fn) }: `moves` says whether a character may
// move now, and `watch` calls `fn` whenever that answer may have changed and
// returns a function that stops the calls.

// Characters that move in the visitor's overview.
const OVERVIEW_LIMIT = { touch: 8, other: 24 }

/** Every character moves: the studio's rule. */
export const everyoneMoves = Object.freeze({
  moves: () => true,
  watch: () => () => {},
})

/**
 * The visitor's rule over the published `characters`: those of the room the
 * visitor chose move; the overview moves the first few, fewer on touch
 * devices. `focus(room)` chooses a room, or the overview with null.
 */
export function visitorPolicy(characters) {
  const watchers = new Set()
  const allowed = (room) =>
    new Set(
      (room
        ? characters.filter((c) => c.room === room)
        : characters.slice(
            0,
            globalThis.matchMedia?.('(pointer: coarse)').matches
              ? OVERVIEW_LIMIT.touch
              : OVERVIEW_LIMIT.other,
          )
      ).map((c) => c.id),
    )
  let active = allowed(null)
  return Object.freeze({
    moves: (id) => active.has(id),
    focus(room) {
      active = allowed(room ?? null)
      for (const fn of watchers) fn()
    },
    watch(fn) {
      watchers.add(fn)
      return () => watchers.delete(fn)
    },
  })
}
