// Clay look for any object: a deterministic field that presses thumb-sized
// dents into the surface and warps it with slow, hand-made undulation.
//
// Pure functions only — no DOM and no Babylon — so the studio can apply the
// look live and a later publish step can apply the same look on the server.
// The same object id, bounds and settings always produce the same shape.

export const CLAY_ORIGINAL = Object.freeze({ strength: 0, depth: 0, width: 50 })
export const clayPresets = Object.freeze({
  original: CLAY_ORIGINAL,
  light: Object.freeze({ strength: 28, depth: 24, width: 50 }),
  medium: Object.freeze({ strength: 58, depth: 55, width: 50 }),
  strong: Object.freeze({ strength: 94, depth: 90, width: 50 }),
})

/** The preset a value matches, or 'custom'. */
export function clayPresetOf(settings) {
  for (const [name, preset] of Object.entries(clayPresets))
    if (
      preset.strength === settings.strength &&
      preset.depth === settings.depth &&
      preset.width === settings.width
    )
      return name
  return 'custom'
}

/** The world default, unless the object overrides it. */
export function clayFor(layout, id) {
  return (
    (id && layout.overrides?.clay?.[id]) ||
    layout.defaults?.clay ||
    CLAY_ORIGINAL
  )
}

export const isOriginalClay = (s) => s.strength === 0 && s.depth === 0

// ---- Deterministic noise ----
function hashString(text) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
function random(seed) {
  let t = seed >>> 0
  return () => {
    t = (t + 0x6d2b79f5) >>> 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}
function lattice(seed, x, y, z) {
  let h = seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263)
  h = Math.imul(h ^ Math.imul(z, 2147483647), 1274126177)
  h ^= h >>> 13
  h = Math.imul(h, 1103515245)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
const fade = (t) => t * t * (3 - 2 * t)
// Smooth value noise in [-1, 1].
function noise(seed, x, y, z) {
  const xi = Math.floor(x),
    yi = Math.floor(y),
    zi = Math.floor(z)
  const u = fade(x - xi),
    v = fade(y - yi),
    w = fade(z - zi)
  const at = (a, b, c) => lattice(seed, xi + a, yi + b, zi + c)
  const lerp = (a, b, t) => a + (b - a) * t
  const x0 = lerp(
    lerp(at(0, 0, 0), at(1, 0, 0), u),
    lerp(at(0, 1, 0), at(1, 1, 0), u),
    v,
  )
  const x1 = lerp(
    lerp(at(0, 0, 1), at(1, 0, 1), u),
    lerp(at(0, 1, 1), at(1, 1, 1), u),
    v,
  )
  return lerp(x0, x1, w) * 2 - 1
}

/**
 * Prepares the field for one object. `bounds` is `{ min, max }` in the
 * object's own space (metres); `seed` is usually the object id.
 */
export function clayField(bounds, seed) {
  const [x0, y0, z0] = bounds.min
  const [x1, y1, z1] = bounds.max
  const size = [x1 - x0, y1 - y0, z1 - z0]
  const span = Math.max(...size, 0.01)
  const centre = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]
  // Flat things (benches, tables) are pressed from above, tall things (a
  // giraffe, a shelf) from the side.
  const flat = size[1] < Math.max(size[0], size[2])
  const key = hashString(String(seed))
  const rand = random(key)
  const count = Math.max(3, Math.min(9, Math.round(span / 0.6)))
  const presses = Array.from({ length: count }, () =>
    flat
      ? [
          x0 + size[0] * (0.15 + 0.7 * rand()),
          z0 + size[2] * (0.15 + 0.7 * rand()),
        ]
      : [
          x0 + size[0] * (0.15 + 0.7 * rand()),
          y0 + size[1] * (0.25 + 0.65 * rand()),
        ],
  )
  const offsets = [0, 1, 2].map(() => [rand() * 50, rand() * 50, rand() * 50])

  /** Writes the clay position of [x, y, z] into `out` (length 3). */
  return function displace(x, y, z, settings, out) {
    if (isOriginalClay(settings)) {
      out[0] = x
      out[1] = y
      out[2] = z
      return out
    }
    const radius = Math.max(0.08, span * 0.12) * (0.55 + settings.width / 100)
    const freq = 0.44 / radius
    const amplitude = (settings.strength / 100) * Math.min(0.19, span * 0.05)
    const pressure = (settings.depth / 100) * Math.min(0.19, span * 0.05)
    // Keep the base on the floor: displacement grows away from the bottom.
    const lifted = Math.max(0, y - y0)
    const grounded = lifted / (lifted + Math.min(0.18, size[1] * 0.25 + 0.01))
    let dent = 0
    for (const [a, b] of presses) {
      const u = (x - a) / radius
      const v = ((flat ? z : y) - b) / (radius * 0.82)
      dent += Math.exp(-1.7 * (u * u + v * v))
    }
    const press = dent * pressure
    const n = (o) =>
      noise(key, x * freq + o[0], y * freq + o[1], z * freq + o[2])
    out[0] = x + amplitude * n(offsets[0]) * grounded
    out[1] = y + (amplitude * n(offsets[1]) - (flat ? press : 0)) * grounded
    out[2] = z + amplitude * n(offsets[2]) * grounded
    if (!flat) {
      // Push sideways toward the vertical axis, as a thumb would.
      const dx = x - centre[0],
        dz = z - centre[2]
      const d = Math.hypot(dx, dz) || 1
      out[0] -= (dx / d) * press * grounded
      out[2] -= (dz / d) * press * grounded
    }
    return out
  }
}

/** Deforms a flat [x, y, z, …] array; returns a new Float32Array. */
export function clayPositions(rest, field, settings) {
  const next = new Float32Array(rest.length)
  const out = [0, 0, 0]
  for (let i = 0; i < rest.length; i += 3) {
    field(rest[i], rest[i + 1], rest[i + 2], settings, out)
    next[i] = out[0]
    next[i + 1] = out[1]
    next[i + 2] = out[2]
  }
  return next
}
