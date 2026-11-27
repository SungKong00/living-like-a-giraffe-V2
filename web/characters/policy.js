// What a scene spends on its characters. The numbers that bound that work
// live in this file only, and nothing here knows what a motion or a route
// contains.
//
// A policy is { shows(place, reach), idleCheck }. `shows` says whether a
// character standing at world point `place`, reaching `reach` metres from
// it, is on screen: only those get a pose. `idleCheck` is how many
// milliseconds may pass, while the scene sleeps, between two looks at where
// the walkers are.

// Looks per second at walkers that might enter a sleeping scene.
const IDLE_CHECKS_PER_SECOND = 4

/**
 * Characters on screen move, on every device and however many there are.
 * A character's own height is the margin around the screen, so one that
 * walks in is already moving when its first limb shows.
 */
export function screenPolicy(world) {
  return Object.freeze({
    shows: (place, reach) => world.onScreen(place, reach),
    idleCheck: 1000 / IDLE_CHECKS_PER_SECOND,
  })
}
