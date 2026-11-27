import { motionPhase } from '../edit-ops.js'
import {
  blendChannels,
  clipGroup,
  clipTracks,
  measureStride,
  restChannels,
  writePose,
} from './pose.js'
import {
  routeAt,
  routeClips,
  routeDefaults,
  routeTimeline,
} from '../../shared/character-route.mjs'

// What every character is doing: where it is on its route, its clock, which
// motion it plays and how motions follow each other. Each one starts its
// motion at its own point so copies do not move in step. A list of motions
// plays each clip once, in order or at random, blending between them.
//
// A character with a route walks it instead. Its place, facing and pose come
// from the route's timetable (shared/character-route.mjs) at the character's
// own clock, so the cast writes the clips' values itself, blended, rather
// than starting animation groups. The clock is read from the time, not
// added up frame by frame: a character walks on while it is off screen or
// the scene sleeps, and shows up where its route has taken it by then.
//
// The policy says which characters are on screen. Only those get a pose: an
// off-screen walker still moves along its route but its joints are left
// alone, and an off-screen motion is paused until it shows again.
//
// The cast moves a character's root node and joints; how the character is
// drawn belongs to the view.

// Yaw a model shows when it walks toward +Z of its room.
const FORWARD = 0
const radians = Math.PI / 180

/**
 * The character's motion, play order and speed, or the world default where
 * it has none. `motion` is null (still), one clip or a list of clips.
 */
export function characterMotion(layout, c) {
  const world = layout.defaults?.character ?? {}
  return {
    motion: c.motion !== undefined ? c.motion : (world.motion ?? null),
    order: c.order ?? world.order ?? 'sequence',
    speed: c.speed ?? world.speed ?? 1,
  }
}

/** A motion value as a list of clips (empty when still). */
export const motionList = (motion) => (motion == null ? [] : [motion].flat())

/** The model a character shows: its own, else the library's fallback. */
export const characterModel = (library, c) => c.model ?? library.fallback

/**
 * `assets` reads the clips and `policy` says which characters are on screen;
 * `onRoute(id)` runs when a character's route has read its clips and can
 * walk. `now()` is the time in milliseconds (the page's clock by default).
 */
export function characterCast(
  world,
  assets,
  policy,
  { onRoute, now = () => performance.now() } = {},
) {
  const { scene } = world
  const cast = new Map()
  const born = now()
  // Seconds since the cast began: what every route's clock is read from.
  const time = () => (now() - born) / 1000
  // The studio's selected character: it stands at its first point, or walks
  // its route from the start while `playing`.
  let rehearsal = null
  const held = (entry) => rehearsal?.id === entry.id && !rehearsal.playing
  const walking = (entry) => entry.route?.timeline?.duration > 0 && !held(entry)
  const posing = (entry) =>
    entry.shown && (!!entry.group?.isPlaying || walking(entry))
  // A route starts at the character's own point of the lap, or at the
  // beginning the moment the studio rehearses it.
  const routeStart = (entry, route) =>
    rehearsal?.id === entry.id
      ? time()
      : -motionPhase(entry.id) * (route.timeline?.duration ?? 0)

  // Moves every walker to where its route has it now and asks the policy
  // which characters are on screen. Joints are not touched here.
  let surveyed = -Infinity
  function survey() {
    surveyed = now()
    for (const entry of cast.values()) {
      if (walking(entry)) {
        const route = entry.route
        route.at = routeAt(route.timeline, time() - route.start)
        settle(entry, route.at.x, route.at.z, route.at.yaw ?? route.base.yaw)
      }
      // The character the studio rehearses always shows.
      entry.shown =
        rehearsal?.id === entry.id ||
        policy.shows(entry.root.getAbsolutePosition(), entry.reach)
      // An off-screen motion holds its pose and plays on when it shows.
      if (!entry.group) continue
      if (!entry.shown) entry.group.pause()
      else if (!entry.group.isPlaying)
        entry.group.play(entry.groups.length === 1)
    }
  }
  const step = scene.onBeforeAnimationsObservable.add(() => {
    survey()
    for (const entry of cast.values()) {
      const route = entry.route
      if (!route) continue
      if (walking(entry)) {
        if (entry.shown) writePose(route, route.at.layers)
      } else if (route.dirty) stand(entry)
      route.dirty = false
    }
  })
  scene.onDisposeObservable.addOnce(() =>
    scene.onBeforeAnimationsObservable.remove(step),
  )

  // ---- Routes ----
  // One clip's tracks on this character's nodes, read once per character.
  function tracks(entry, motion) {
    if (!entry.tracks.has(motion))
      entry.tracks.set(
        motion,
        assets
          .clip(motion)
          .then((source) => source && clipTracks(entry.nodes, source)),
      )
    return entry.tracks.get(motion)
  }
  function settle(entry, x, z, yaw) {
    const { position } = entry.route.base
    entry.root.position.set(position[0] + x, position[1], position[2] + z)
    entry.root.rotation.y = yaw * radians
  }
  // At the first point as placed, standing.
  function stand(entry) {
    const route = entry.route
    settle(entry, 0, 0, route.base.yaw)
    writePose(route, [{ clip: route.idle, time: 0, weight: 1, loop: true }])
  }
  function stride(entry, route, name, clip) {
    if (!entry.strides.has(name))
      entry.strides.set(name, measureStride(entry.root, route, name, clip))
    return entry.strides.get(name)
  }
  // Puts the nodes a route moved back and lets a motion play again.
  function leave(entry) {
    const route = entry.route
    if (!route) return
    restChannels(route.channels)
    entry.route = null
    entry.root.rotationQuaternion = null
  }
  async function walk(entry, c, m) {
    const key = JSON.stringify([c.route, c.scale, m?.stride, m?.height])
    const base = { position: c.position, yaw: c.yaw }
    if (entry.route?.key === key) {
      entry.route.base = base
      entry.route.dirty = true
      return
    }
    // The motion it played where it stood stops.
    for (const group of entry.groups) group.dispose()
    entry.groups = []
    entry.group = null
    entry.motionKey = null
    const before = entry.route
    const route = (entry.route = {
      key,
      base,
      idle: c.route.idle ?? null,
      clips: new Map(),
      channels: before?.channels ?? [],
      timeline: null,
      start: 0,
      at: null,
      dirty: true,
    })
    if (!entry.file) return
    const names = [...new Set(routeClips(c.route))]
    const loaded = await Promise.all(names.map((n) => tracks(entry, n)))
    // A newer edit may have replaced this one while the files loaded.
    if (entry.route !== route || cast.get(entry.id) !== entry) return
    names.forEach((name, i) => loaded[i] && route.clips.set(name, loaded[i]))
    route.channels = blendChannels(route.clips, entry.rest, before?.channels)
    route.dirty = true
    world.wake()
    const steps = route.clips.get(c.route.walk)
    route.loaded = true
    // Without its walk it would slide, so it stays at the first point.
    if (!steps) return void onRoute?.(entry.id)
    const fit = m ? m.height / m.measured : 1
    route.measured = stride(entry, route, c.route.walk, steps) * fit
    const length = m?.stride ?? route.measured
    // Speed at which the feet do not slide, for this character's size.
    route.natural = (length * c.scale) / steps.duration
    const known = route.natural > 0.01
    route.speed = c.route.speed ?? (known ? route.natural : routeDefaults.speed)
    route.pace = known ? route.speed / route.natural : 1
    route.timeline = routeTimeline(
      { ...c.route, speed: route.speed },
      {
        duration: (clip) => route.clips.get(clip)?.duration,
        radius: 0.6 * c.scale,
        forward: FORWARD,
        walkRate: Math.min(2, Math.max(0.5, route.pace)),
      },
    )
    route.start = routeStart(entry, route)
    onRoute?.(entry.id)
  }

  async function play(entry, { motion, order, speed }) {
    const list = motionList(motion)
    const key = entry.file ? JSON.stringify([list, order, speed]) : null
    if (entry.motionKey === key) return
    entry.motionKey = key
    for (const group of entry.groups) group.dispose()
    entry.groups = []
    entry.group = null
    if (!key || !list.length) return
    const loaded = await Promise.all(
      list.map((m) =>
        assets
          .clip(m)
          .then(
            (source) =>
              source && clipGroup(scene, entry.id, entry.nodes, source),
          ),
      ),
    )
    const groups = loaded.filter(Boolean)
    // A newer edit may have replaced this one while the files loaded.
    if (entry.motionKey !== key || cast.get(entry.id) !== entry) {
      for (const group of groups) group.dispose()
      return
    }
    if (!groups.length) return
    entry.groups = groups
    const phase = motionPhase(entry.id)
    const start = (index, at) => {
      const group = groups[index]
      entry.group = group
      group.start(groups.length === 1, speed)
      if (at !== undefined)
        group.goToFrame(group.from + (group.to - group.from) * at)
    }
    if (groups.length > 1)
      groups.forEach((group, index) => {
        group.enableBlending = true
        group.blendingSpeed = 0.05
        group.onAnimationGroupEndObservable.add(() => {
          if (entry.groups !== groups) return
          let next = (index + 1) % groups.length
          if (order === 'random') {
            next = Math.floor(Math.random() * (groups.length - 1))
            if (next >= index) next++
          }
          start(next)
        })
      })
    // Copies start at different points: in the clip, or in the list.
    if (groups.length === 1) start(0, phase)
    else start(Math.floor(phase * groups.length), (phase * groups.length) % 1)
    if (entry.shown === false) entry.group.pause()
  }

  return {
    get: (id) => cast.get(id),
    entries: () => cast.values(),
    /** Takes a spawned character (the view's `body`) into the cast. */
    add(id, body) {
      const entry = {
        id,
        ...body,
        groups: [],
        group: null,
        motionKey: null,
        // Route clips read for this character and strides measured from them.
        tracks: new Map(),
        strides: new Map(),
        route: null,
        // How far from its place the character can reach, for the policy.
        reach: 0,
        // Whether it is on screen; unknown until the first survey.
        shown: undefined,
      }
      cast.set(id, entry)
      return entry
    },
    /** Stops what the character does and forgets it. */
    remove(entry) {
      for (const group of entry.groups) group.dispose()
      if (cast.get(entry.id) === entry) cast.delete(entry.id)
    },
    /**
     * Starts what character `c` does where it was just placed: its route,
     * else `motion` (see characterMotion). `info` is its model's entry and
     * `height` how tall the character stands in the scene, in metres.
     */
    perform(entry, c, info, motion, height) {
      entry.reach = height
      if (c.route) walk(entry, c, info)
      else {
        leave(entry)
        play(entry, motion)
      }
    },
    /**
     * True while a character on screen needs frames. While the scene
     * sleeps the walkers are still followed, a few times a second, so one
     * that walks into view starts the drawing again.
     */
    animating() {
      if (now() - surveyed >= policy.idleCheck) survey()
      for (const entry of cast.values()) if (posing(entry)) return true
      return false
    },
    rehearse(id, playing = false) {
      const before = rehearsal
      if (before ? before.id === id && before.playing === playing : !id) return
      rehearsal = id ? { id, playing } : null
      for (const entry of cast.values()) {
        const route = entry.route
        if (!route || (entry.id !== id && entry.id !== before?.id)) continue
        route.dirty = true
        route.start = routeStart(entry, route)
      }
      world.wake()
    },
    route(id) {
      const route = cast.get(id)?.route
      if (!route) return null
      return {
        loaded: !!route.loaded,
        ready: !!route.timeline,
        speed: route.speed,
        natural: route.natural,
        pace: route.pace,
        stride: route.measured,
        duration: route.timeline?.duration ?? 0,
      }
    },
    stats() {
      let posed = 0
      for (const entry of cast.values()) if (posing(entry)) posed++
      return { total: cast.size, posed }
    },
    playing(id) {
      const entry = cast.get(id)
      return !!entry && posing(entry)
    },
  }
}
