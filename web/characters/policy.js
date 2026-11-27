// What a scene spends on its characters. The numbers that bound that work
// live in this file only, and nothing here knows what a motion or a route
// contains.
//
// A policy is { shows(place, reach), idleCheck, level(now) }. `shows` says
// whether a character standing at world point `place`, reaching `reach`
// metres from it, is on screen: only those get a pose. `idleCheck` is how
// many milliseconds may pass, while the scene sleeps, between two looks at
// where the walkers are. `level(now)` is the reduced level every character
// is drawn at (0 is the original), given the level in use now.

// Looks per second at walkers that might enter a sleeping scene.
const IDLE_CHECKS_PER_SECOND = 4

// Below this many pixels per metre characters are drawn at a reduced level.
// The view is orthographic, so every character is the same size on screen
// and one number sets the level for all of them.
const LEVEL_BELOW = Object.freeze({ 1: 30, 2: 8 })
// A level is kept this far past its boundary, so zooming across one does
// not flicker between two levels.
const LEVEL_HOLD = 0.1

/**
 * The reduced level for `pixelsPerMetre`, given the level in use `now`:
 * the level changes only once the zoom is 10% past the boundary it crosses.
 */
export function levelFor(pixelsPerMetre, now = 0) {
  const at = (scale) =>
    pixelsPerMetre < LEVEL_BELOW[2] * scale
      ? 2
      : pixelsPerMetre < LEVEL_BELOW[1] * scale
        ? 1
        : 0
  // Coarser only when clearly below a boundary, finer only when clearly
  // above one.
  const coarser = at(1 - LEVEL_HOLD)
  const finer = at(1 + LEVEL_HOLD)
  return now < coarser ? coarser : now > finer ? finer : now
}

/**
 * Characters on screen move, on every device and however many there are.
 * A character's own height is the margin around the screen, so one that
 * walks in is already moving when its first limb shows. With `lods` the
 * characters are drawn at the reduced level their size on screen allows;
 * without, always as the original (the studio's editing scene).
 */
export function screenPolicy(world, { lods = false } = {}) {
  return Object.freeze({
    shows: (place, reach) => world.onScreen(place, reach),
    idleCheck: 1000 / IDLE_CHECKS_PER_SECOND,
    level: (now) => (lods ? levelFor(world.pixelsPerMetre(), now) : 0),
  })
}
