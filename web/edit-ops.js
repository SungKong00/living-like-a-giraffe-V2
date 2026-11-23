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

// ---- Giraffes ----
export function addGiraffe(layout, { id, room, position = [0, 0, 0] }) {
  const taken = new Set((layout.giraffes ?? []).map((g) => g.label))
  let n = 1
  while (taken.has('기린 ' + n)) n++
  const giraffe = {
    id,
    room,
    label: '기린 ' + n,
    position,
    yaw: 0,
    scale: 1,
  }
  ;(layout.giraffes ??= []).push(giraffe)
  return giraffe
}
export function deleteGiraffe(layout, id) {
  layout.giraffes = (layout.giraffes ?? []).filter((g) => g.id !== id)
  if (!layout.giraffes.length) delete layout.giraffes
  setClay(layout, id, null)
}
/** Clears a giraffe's own value so it follows the world default again. */
export function inheritGiraffe(layout, id, key) {
  const g = find(layout, 'giraffes', id)
  if (g) delete g[key]
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
