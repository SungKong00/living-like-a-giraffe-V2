// A character's route: floor points in its room walked in order, round and
// round or there and back. A point is passed (the corner is rounded) or it
// is a stop: arrive, turn to face, play its motion, wait, turn, leave.
//
// The route unrolls into a timetable of segments once the lengths of its
// clips are known. `routeAt(timetable, t)` then gives the place, the facing
// and the clips to blend at any time, so the studio and the visitor scene
// show the same walk and tests can check it without a scene.

export const routeLimits = Object.freeze({
  points: { min: 2, max: 12 },
  speed: { min: 0.2, max: 3 },
  repeat: { min: 1, max: 5 },
  wait: { min: 0, max: 60 },
})
export const routeDefaults = Object.freeze({ mode: 'loop', speed: 0.8 })

const list = (motion) => (motion == null ? [] : [motion].flat())

/** Every clip a route plays: its walk, its standing clip and its stops'. */
export function routeClips(route) {
  if (!route) return []
  return [
    route.walk,
    route.idle,
    ...(route.points ?? []).flatMap((p) => list(p.stop?.motion)),
  ].filter(Boolean)
}

/** Every clip a character (or the world default) plays, route included. */
export const characterClips = (c) => [
  ...list(c?.motion),
  ...routeClips(c?.route),
]

/** The same route with clips of file `from` read from file `to`. */
export function retargetRoute(route, from, to, has = () => true) {
  let changed = 0
  const swap = (clip) => {
    if (typeof clip !== 'string' || !clip.startsWith(from + '/')) return clip
    const next = to + clip.slice(from.length)
    if (!has(next)) return clip
    changed++
    return next
  }
  const next = {
    ...route,
    walk: swap(route.walk),
    ...(route.idle ? { idle: swap(route.idle) } : {}),
    points: route.points.map((p) =>
      p.stop?.motion == null
        ? p
        : {
            ...p,
            stop: {
              ...p.stop,
              motion: Array.isArray(p.stop.motion)
                ? p.stop.motion.map(swap)
                : swap(p.stop.motion),
            },
          },
    ),
  }
  return changed ? next : route
}

const deg = 180 / Math.PI
/** The shortest turn from yaw `a` to yaw `b`, in degrees (-180, 180]. */
export const turnBetween = (a, b) => {
  const d = (((b - a) % 360) + 540) % 360
  return d === 0 ? 180 : d - 180
}

/**
 * The timetable of `route`. `duration(clip)` gives a clip's length in
 * seconds (0 or undefined when it cannot play). `radius` rounds the corners
 * of passed points, `forward` is the yaw a model faces when it walks toward
 * +Z, `turnRate` is degrees a second, `blend` the seconds a change of
 * clip takes and `walkRate` how fast the walk clip plays for the speed.
 */
export function routeTimeline(
  route,
  {
    duration = () => 0,
    radius = 0.6,
    forward = 0,
    turnRate = 180,
    blend = 0.3,
    walkRate = 1,
  } = {},
) {
  const points = route.points
  const count = points.length
  const order = [...points.keys()]
  // There and back visits the inner points again on the way home.
  if (route.mode === 'pingpong' && count > 2)
    for (let i = count - 2; i > 0; i--) order.push(i)
  const stations = order.map((index, i) => {
    const at = points[index].at
    const to = points[order[(i + 1) % order.length]].at
    const dx = to[0] - at[0]
    const dz = to[1] - at[1]
    return {
      index,
      at,
      stop: points[index].stop ?? null,
      dx,
      dz,
      length: Math.hypot(dx, dz),
    }
  })
  const walkable = stations.filter((s) => s.length > 1e-6)
  const speed = route.speed ?? routeDefaults.speed
  if (!walkable.length || !(speed > 0))
    return {
      duration: 0,
      walk: 0,
      rate: walkRate,
      segments: [],
      origin: points[0].at,
    }
  // A leg of no length borrows the heading of the next one that moves.
  const m = stations.length
  for (let i = m - 1, pass = 0; pass < 2 * m; i = (i - 1 + m) % m, pass++) {
    const s = stations[i]
    s.heading =
      s.length > 1e-6
        ? Math.atan2(s.dx, s.dz) * deg + forward
        : (stations[(i + 1) % m].heading ?? s.heading)
  }
  // How much of each leg a rounded corner takes at this station.
  for (let i = 0; i < m; i++) {
    const s = stations[i]
    const before = stations[(i - 1 + m) % m]
    s.arrive = before.heading
    s.turn = turnBetween(before.heading, s.heading)
    const angle = Math.abs(s.turn)
    s.round = 0
    // A stop and a turn back on itself are made standing on the point.
    if (s.stop || angle > 150 || angle < 0.5) continue
    const half = Math.tan(angle / 2 / deg)
    s.round = Math.min(radius * half, 0.45 * before.length, 0.45 * s.length)
    s.radius = s.round / half
  }

  const segments = []
  let time = 0
  let walked = 0
  const push = (segment) => {
    if (!(segment.duration > 1e-6)) return
    segment.start = time
    segment.walked = walked
    time += segment.duration
    if (segment.pace) walked += segment.duration * segment.pace
    segments.push(segment)
  }
  const turn = (at, from, to) => {
    const by = turnBetween(from, to)
    if (Math.abs(by) < 0.5 || Math.abs(Math.abs(by) - 360) < 0.5) return
    push({
      kind: 'turn',
      clip: route.walk,
      pace: 0.5,
      at,
      from,
      by,
      duration: Math.abs(by) / turnRate,
    })
  }
  for (let i = 0; i < m; i++) {
    const s = stations[i]
    const next = stations[(i + 1) % m]
    if (s.round > 0) {
      // Leave the point's corner: an arc from the leg before onto this one.
      const a = s.arrive / deg - forward / deg
      const origin = [
        s.at[0] - Math.sin(a) * s.round,
        s.at[1] - Math.cos(a) * s.round,
      ]
      push({
        kind: 'arc',
        clip: route.walk,
        pace: 1,
        origin,
        radius: s.radius,
        from: s.arrive,
        by: s.turn,
        forward,
        duration: (s.radius * Math.abs(s.turn)) / deg / speed,
      })
    } else if (s.stop) {
      const face = s.stop.face ?? 'next'
      const facing = face === 'next' ? s.heading : face
      turn(s.at, s.arrive, facing)
      const clips = list(s.stop.motion)
      for (let n = 0; n < (s.stop.repeat ?? 1); n++)
        for (const clip of clips)
          push({
            kind: 'act',
            clip,
            at: s.at,
            yaw: facing,
            duration: duration(clip) || 0,
          })
      push({
        kind: 'wait',
        clip: route.idle ?? null,
        at: s.at,
        yaw: facing,
        duration: s.stop.wait ?? 0,
      })
      turn(s.at, facing, s.heading)
    } else turn(s.at, s.arrive, s.heading)
    const length = s.length - s.round - next.round
    const h = s.heading / deg - forward / deg
    const from = [
      s.at[0] + Math.sin(h) * s.round,
      s.at[1] + Math.cos(h) * s.round,
    ]
    push({
      kind: 'line',
      clip: route.walk,
      pace: 1,
      from,
      dir: [Math.sin(h), Math.cos(h)],
      yaw: s.heading,
      speed,
      duration: length / speed,
    })
  }
  // A clip that follows another one fades in from that one's last pose.
  segments.forEach((segment, i) => {
    const before = segments[(i - 1 + segments.length) % segments.length]
    const same =
      before.clip === segment.clip && (segment.pace || before.kind === 'act')
    if (same || segments.length === 1) return
    segment.fade = Math.min(blend, segment.duration)
    segment.before = before
  })
  return {
    duration: time,
    walk: walked,
    rate: walkRate,
    segments,
    origin: points[0].at,
  }
}

const smooth = (x) => x * x * (3 - 2 * x)
// The clock a segment's clip reads `into` the segment, on lap `lap`.
const clipTime = (timeline, segment, into, lap) =>
  segment.pace
    ? (lap * timeline.walk + segment.walked + into * segment.pace) *
      timeline.rate
    : into
// A motion plays once and holds its end; walking and standing go round.
const layer = (timeline, segment, into, lap, weight) => ({
  clip: segment.clip,
  time: clipTime(timeline, segment, into, lap),
  weight,
  loop: segment.kind !== 'act',
})

/**
 * Where the character is at time `t` (seconds, any size): `x`·`z` in the
 * room, `yaw` in degrees and `layers`, the clips to blend as
 * `{ clip, time, weight, loop }` (two while one fades into the next). A null
 * clip is the rest pose. Walking clips read a clock that keeps running from
 * lap to lap so their steps never jump.
 */
export function routeAt(timeline, t) {
  const { segments, duration } = timeline
  if (!segments.length || !(duration > 0))
    return {
      x: timeline.origin[0],
      z: timeline.origin[1],
      yaw: null,
      layers: [],
    }
  const lap = Math.floor(t / duration)
  const at = t - lap * duration
  let lo = 0
  let hi = segments.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (segments[mid].start <= at) lo = mid
    else hi = mid - 1
  }
  const s = segments[lo]
  const into = Math.min(Math.max(at - s.start, 0), s.duration)
  const f = into / s.duration
  let x, z, yaw
  if (s.kind === 'line') {
    x = s.from[0] + s.dir[0] * s.speed * into
    z = s.from[1] + s.dir[1] * s.speed * into
    yaw = s.yaw
  } else if (s.kind === 'arc') {
    yaw = s.from + s.by * f
    const a0 = (s.from - s.forward) / deg
    const a = (yaw - s.forward) / deg
    const side = Math.sign(s.by) * s.radius
    x = s.origin[0] - side * (Math.cos(a) - Math.cos(a0))
    z = s.origin[1] + side * (Math.sin(a) - Math.sin(a0))
  } else {
    ;[x, z] = s.at
    yaw = s.kind === 'turn' ? s.from + s.by * f : s.yaw
  }
  const layers = [layer(timeline, s, into, lap, 1)]
  if (s.fade && into < s.fade) {
    const w = smooth(into / s.fade)
    const b = s.before
    layers[0].weight = w
    // The segment before the first one ended on the lap before.
    layers.unshift(layer(timeline, b, b.duration, lo ? lap : lap - 1, 1 - w))
  }
  return { x, z, yaw, layers, kind: s.kind }
}

/**
 * Ground covered in one cycle of a walk that plays in place, from the joint
 * positions sampled evenly over the cycle (`samples[i]` is a list of
 * `[x, y, z]`, one per joint, the last sample one step before the first
 * repeats). The lowest moving joint is the foot on the ground, and the
 * ground moves under the body as fast as that foot slides back. Feet trade
 * places unevenly, so the stride is the usual slide between two samples (the
 * median) over the whole cycle rather than the sum of every slide.
 */
export function strideFromSamples(samples) {
  if (!samples.length) return 0
  // A joint that never rises (a root or a target on the floor) is no foot.
  const range = samples[0].map((_, j) => {
    const heights = samples.map((joints) => joints[j][1])
    return Math.max(...heights) - Math.min(...heights)
  })
  const most = Math.max(...range)
  const feet = range.flatMap((r, j) => (r > most * 0.02 ? [j] : []))
  if (!feet.length) return 0
  const lowest = (joints) =>
    feet.reduce((best, j) => (joints[j][1] < joints[best][1] ? j : best))
  const slides = []
  for (let i = 0; i < samples.length; i++) {
    const a = samples[i]
    const b = samples[(i + 1) % samples.length]
    const foot = lowest(a)
    if (lowest(b) !== foot) continue
    slides.push(Math.hypot(b[foot][0] - a[foot][0], b[foot][2] - a[foot][2]))
  }
  if (!slides.length) return 0
  slides.sort((x, y) => x - y)
  return slides[slides.length >> 1] * samples.length
}
