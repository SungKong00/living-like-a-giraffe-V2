// Pure layout edits shared by the studio UI and node tests. Each function
// mutates the draft passed by EditHistory.change and never touches the scene.

export const GRID = 0.25
export const ROTATE_STEP = 15

export const snap = (value, step = GRID) =>
  Math.round(Math.round(value / step) * step * 1000) / 1000
export const round = (value, digits = 3) =>
  Math.round(value * 10 ** digits) / 10 ** digits

export function normalize(q) {
  const length = Math.hypot(...q) || 1
  return q.map((v) => v / length)
}
function multiply([ax, ay, az, aw], [bx, by, bz, bw]) {
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ]
}
const yawQuaternion = (deg) => {
  const half = (deg * Math.PI) / 360
  return [0, Math.sin(half), 0, Math.cos(half)]
}
// Heading around the room's up axis, in degrees within (-180, 180].
export function yawOf([x, y, z, w]) {
  const deg =
    (Math.atan2(2 * (x * z + w * y), 1 - 2 * (x * x + y * y)) * 180) / Math.PI
  const r = round(deg, 2)
  return r <= -180 ? 180 : r
}
// Rotating around the room's up axis keeps any tilt the maker gave the model.
export function rotateBy(q, deg) {
  return normalize(multiply(yawQuaternion(deg), q))
}
export function withYaw(q, deg) {
  return rotateBy(q, deg - yawOf(q))
}

export const find = (layout, list, id) => layout[list]?.find((o) => o.id === id)
export const spotsOn = (layout, anchor) =>
  layout.spots.filter((s) => s.anchor === anchor)

export function duplicateItem(layout, id, newId, offset = [1, 0, 1]) {
  const source = find(layout, 'items', id)
  if (!source) return null
  const copy = {
    ...structuredClone(source),
    id: newId,
    label: copyLabel(layout, source.label),
    position: source.position.map((v, i) => round(v + offset[i])),
  }
  layout.items.splice(layout.items.indexOf(source) + 1, 0, copy)
  const clay = layout.overrides?.clay?.[id]
  if (clay) layout.overrides.clay[newId] = { ...clay }
  return copy
}
function copyLabel(layout, label) {
  const base = label.replace(/ \d+$/, '')
  const taken = new Set(layout.items.map((i) => i.label))
  for (let n = 2; ; n++) {
    const next = (base + ' ' + n).slice(0, 100)
    if (!taken.has(next)) return next
  }
}

export function addItem(
  layout,
  { id, kind, label, room, position = [0, 0, 0] },
) {
  const item = {
    id,
    room,
    kind,
    label: copyLabel(layout, label),
    position,
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
    color: 'original',
    finish: 'original',
  }
  layout.items.push(item)
  return item
}

// Removing furniture also removes the click areas attached to it, so the
// draft always stays publishable. Undo restores both in one step.
export function deleteItem(layout, id) {
  const removed = spotsOn(layout, id).length
  layout.items = layout.items.filter((i) => i.id !== id)
  layout.spots = layout.spots.filter((s) => s.anchor !== id)
  setClay(layout, id, null)
  return removed
}

// ---- Overrides ----
/** Sets an object's clay override, or removes it with `null`. */
export function setClay(layout, id, settings) {
  if (settings) {
    layout.overrides ??= {}
    layout.overrides.clay ??= {}
    layout.overrides.clay[id] = { ...settings }
    return
  }
  if (!layout.overrides?.clay) return
  delete layout.overrides.clay[id]
  if (!Object.keys(layout.overrides.clay).length) delete layout.overrides.clay
  if (!Object.keys(layout.overrides).length) delete layout.overrides
}
/** Sets a world default, or removes it with `undefined`. */
export function setDefault(layout, scope, key, value) {
  layout.defaults ??= {}
  layout.defaults[scope] ??= {}
  if (key === null) layout.defaults[scope] = value
  else if (value === undefined) delete layout.defaults[scope][key]
  else layout.defaults[scope][key] = value
  if (!layout.defaults[scope] || !Object.keys(layout.defaults[scope]).length)
    delete layout.defaults[scope]
  if (!Object.keys(layout.defaults).length) delete layout.defaults
}

// ---- Characters ----
/** A free spot beside the room's other characters; the first at the origin. */
export function freeSpot(layout, room) {
  const neighbours = (layout.characters ?? []).filter((c) => c.room === room)
  for (let slot = 0; ; slot++) {
    const column = slot % 7
    const x = (column % 2 ? 1 : -1) * Math.ceil(column / 2) * 2
    const position = [x || 0, 0, 2 * Math.floor(slot / 7)]
    if (
      !neighbours.some(
        (c) =>
          Math.hypot(c.position[0] - position[0], c.position[2] - position[2]) <
          1.5,
      )
    )
      return position
  }
}
/** Next free `name N` label, e.g. 리라지 점토 기린 2. */
function nextLabel(layout, name) {
  const taken = new Set((layout.characters ?? []).map((c) => c.label))
  let n = 1
  while (taken.has(name + ' ' + n)) n++
  return (name + ' ' + n).slice(0, 120)
}
export function addCharacter(
  layout,
  { id, room, model, name = '캐릭터', position = freeSpot(layout, room) },
) {
  const character = {
    id,
    room,
    label: nextLabel(layout, name),
    ...(model ? { model } : {}),
    position,
    yaw: 0,
    scale: 1,
  }
  ;(layout.characters ??= []).push(character)
  return character
}
// Keep a compatible motion or playlist when changing rigs. A new biped walks
// by default, while an explicit still pose from the character or world wins.
export function selectCharacterModel(layout, character, model, library) {
  character.model = model
  const current =
    character.motion === undefined
      ? layout.defaults?.character?.motion
      : character.motion
  const suggested = library.models.find((m) => m.id === model)?.suggestedMotion
  if (current === undefined && suggested) character.motion = suggested
  if (current == null) return
  const clips = [current].flat()
  const compatible = clips.filter(
    (clip) =>
      library.motions.find((m) => m.id === clip.split('/')[0])?.matched[model],
  )
  if (compatible.length !== clips.length)
    character.motion =
      compatible.length > 1 ? compatible : (compatible[0] ?? suggested ?? null)
}

/** A copy beside the original with its own clay override, if any. */
export function duplicateCharacter(layout, id, next) {
  const source = find(layout, 'characters', id)
  const copy = structuredClone(source)
  copy.id = next
  copy.label = nextLabel(layout, source.label.replace(/ \d+$/, ''))
  copy.position = freeSpot(layout, source.room)
  layout.characters.push(copy)
  const clay = layout.overrides?.clay?.[id]
  if (clay) setClay(layout, next, clay)
  return copy
}
export function deleteCharacter(layout, id) {
  layout.characters = (layout.characters ?? []).filter((c) => c.id !== id)
  if (!layout.characters.length) delete layout.characters
  setClay(layout, id, null)
}
/** Clears a character's own value so it follows the world default again. */
/** Switches a wearable of a character's model on or off. */
export function setWear(layout, id, wear, on) {
  const c = find(layout, 'characters', id)
  if (!c) return
  const list = (c.wear ?? []).filter((w) => w !== wear)
  if (on) list.push(wear)
  if (list.length) c.wear = list
  else delete c.wear
}

export function inheritCharacter(layout, id, key) {
  const c = find(layout, 'characters', id)
  if (c) delete c[key]
}

/** Where in its loop (0–1) a character starts, fixed by its ID. */
export function motionPhase(id) {
  let h = 2166136261
  for (const ch of String(id)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return (h >>> 0) / 2 ** 32
}

/**
 * Points motions of file `from` at file `to` where the new file has the same
 * clip, after a model's file was replaced. Returns how many changed.
 */
export function moveMotionFile(layout, from, to, clips) {
  let moved = 0
  const swap = (motion) => {
    if (typeof motion !== 'string' || !motion.startsWith(from + '/'))
      return motion
    const clip = motion.slice(from.length + 1)
    if (!clips.includes(clip)) return motion
    moved++
    return to + '/' + clip
  }
  for (const owner of [
    layout.defaults?.character,
    ...(layout.characters ?? []),
  ])
    if (owner?.motion != null)
      owner.motion = Array.isArray(owner.motion)
        ? owner.motion.map(swap)
        : swap(owner.motion)
  return moved
}

export function deleteSpot(layout, id) {
  layout.spots = layout.spots.filter((s) => s.id !== id)
}

export function deletePage(layout, id) {
  const linked = layout.spots.filter(
    (s) => s.action.type === 'page' && s.action.page === id,
  ).length
  layout.pages = layout.pages.filter((p) => p.id !== id)
  layout.spots = layout.spots.filter(
    (s) => !(s.action.type === 'page' && s.action.page === id),
  )
  // Characters stay; only their link goes.
  for (const c of layout.characters ?? []) if (c.page === id) delete c.page
  return linked
}

// A click area always starts linked to a page; the caller creates one first
// when the draft has none.
export function addSpot(layout, { id, anchor, page }) {
  const spot = {
    id,
    anchor,
    label: page.title,
    position: [0, 1, 0],
    size: [2, 2, 2],
    action: { type: 'page', page: page.id },
  }
  layout.spots.push(spot)
  return spot
}

export function addPage(layout, { id, title = '새 행사' }) {
  const page = { id, title, summary: '', body: '', url: '' }
  layout.pages.push(page)
  return page
}

// Moving through the inspector puts furniture on the new room's origin, keeping
// its height, heading, size and options.
export function moveToRoom(layout, id, room) {
  const item = find(layout, 'items', id)
  if (!item || item.room === room) return
  item.room = room
  item.position = [0, item.position[1], 0]
}

export const clampScale = (v) => Math.min(100, Math.max(0.01, round(v)))
export const clampPosition = (v) => Math.min(10000, Math.max(-10000, round(v)))

// These mirror the server's zod rules so the inspector can explain a rejected
// value before it reaches the draft.
export function labelError(value) {
  const text = String(value).trim()
  if (!text) return '이름을 입력하세요.'
  if (text.length > 100) return '100자 이내로 입력하세요.'
  return null
}
export function urlError(value, { optional = false } = {}) {
  if (optional && value === '') return null
  try {
    const url = new URL(value)
    if (!/^https?:$/.test(url.protocol) || value.length > 2048) throw Error()
    return null
  } catch {
    return 'http:// 또는 https://로 시작하는 주소를 입력하세요.'
  }
}
