import { giraffeDimensions } from '../shared/giraffe-proportions.mjs'
import { sourceDifference, sourceValues } from '../shared/source-lights.mjs'
import { lightLimit, lightWithDefaults } from '../shared/studio-lights.mjs'
import { z } from 'zod'
import { isDeepStrictEqual as equal } from 'node:util'

const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
const number = z.number().finite().min(-10000).max(10000)
const vector = z.tuple([number, number, number])
const scale = vector.refine((v) => v.every((n) => n >= 0.01 && n <= 100))
const rotation = z
  .tuple([number, number, number, number])
  .refine((q) => Math.abs(Math.hypot(...q) - 1) < 0.001)
const title = z.string().trim().min(1).max(100)
const item = z.strictObject({
  id,
  room: id,
  kind: id,
  label: title,
  position: vector,
  rotation,
  scale,
  color: z.string().regex(/^(original|#[0-9a-f]{6})$/),
  finish: z.enum(['original', 'matte', 'gloss']),
})
const link = z.url({ protocol: /^https?$/ }).max(2048)
const action = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('page'), page: id }),
  z.strictObject({ type: z.literal('url'), url: link }),
])
const hotspot = z.strictObject({
  id,
  anchor: id,
  label: title,
  position: vector,
  size: scale,
  action,
})
const page = z.strictObject({
  id,
  title,
  summary: z.string().max(500),
  body: z.string().max(16000),
  url: z.union([link, z.literal('')]),
})
const lightShape = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('point') }),
  z.strictObject({
    type: z.literal('spot'),
    rotation,
    angle: z.number().min(1).max(180),
    blend: z.number().min(0).max(1),
  }),
  z.strictObject({
    type: z.literal('area'),
    rotation,
    width: z.number().min(0.01).max(100),
    height: z.number().min(0.01).max(100),
  }),
])
const light = z
  .strictObject({
    id,
    room: id,
    label: title,
    position: vector,
    color: z.string().regex(/^#[0-9a-f]{6}$/),
    energy: z.number().min(0).max(10000),
    enabled: z.boolean().optional(),
    shape: lightShape.optional(),
  })
  .transform(lightWithDefaults)
export const studioLights = z.array(light).max(lightLimit)
const sourceEdit = z.strictObject({
  id,
  enabled: z.boolean().optional(),
  position: vector.optional(),
  rotation: rotation.optional(),
  energy: z.number().min(0).max(10000000).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/)
    .optional(),
})
// Clay look shared by the world default and per-object overrides.
const percent = z.number().min(0).max(100)
const clay = z.strictObject({
  strength: percent,
  depth: percent,
  width: percent,
})
// One default per kind of thing: the rooms' own geometry, movable furniture
// and characters. Drafts saved before the split held a single value for all.
const clayDefaults = z.union([
  clay.transform((v) => ({ world: v, objects: v, characters: v })),
  z.strictObject({
    world: clay.optional(),
    objects: clay.optional(),
    characters: clay.optional(),
  }),
])
// A library file: an uploaded file's content hash or the bundled model.
const fileId = '(?:[a-f0-9]{16}|riragi(?:-biped)?)'
// `동작파일ID/클립이름`; null means "standing still" when it overrides. A
// list plays its clips one after another in `order`.
const clip = z
  .string()
  .min(3)
  .max(200)
  .regex(new RegExp('^' + fileId + '\\/.+$', 's'))
const motion = z.union([clip, z.array(clip).min(1).max(8)]).nullable()
const order = z.enum(['sequence', 'random'])
const speed = z.number().min(0.1).max(3)
// Characters never round-trip through Blender, so their own motion and speed
// overrides live on the character. A missing field follows
// defaults.character; a missing model shows the library's fallback model.
const character = z.strictObject({
  id,
  room: id,
  label: title,
  model: z
    .string()
    .regex(new RegExp('^' + fileId + '$'))
    .optional(),
  position: vector,
  yaw: z.number().min(-360).max(360),
  scale: z.number().min(0.1).max(5),
  proportions: z
    .strictObject(
      Object.fromEntries(
        Object.entries(giraffeDimensions).map(([key, { min, max }]) => [
          key,
          z.number().min(min).max(max).optional(),
        ]),
      ),
    )
    .optional(),
  motion: motion.optional(),
  order: order.optional(),
  speed: speed.optional(),
  // A page opened when a visitor taps the character.
  page: id.optional(),
  // Wearables of the model switched on (IDs from the library).
  wear: z.array(z.string().min(1).max(40)).max(20).optional(),
})
const layout = z.strictObject({
  // World-wide values every object follows unless it overrides them.
  defaults: z
    .strictObject({
      clay: clayDefaults.optional(),
      clayMotion: z
        .strictObject({
          enabled: z.boolean(),
          strength: percent,
          style: z.enum(['surface', 'screen']).optional(),
          hatch: percent.optional(),
        })
        .optional(),
      character: z
        .strictObject({
          motion: motion.optional(),
          order: order.optional(),
          speed: speed.optional(),
        })
        .optional(),
    })
    .optional(),
  // Per-object overrides kept apart from items: furniture fields are merged
  // key by key with Blender, and a separate map survives that untouched.
  overrides: z.strictObject({ clay: z.record(id, clay).optional() }).optional(),
  characters: z.array(character).max(50).optional(),
  sourceLights: z.array(sourceEdit).optional(),
  lights: studioLights.optional(),
  items: z.array(item).max(500),
  spots: z.array(hotspot).max(1000),
  pages: z.array(page).max(500),
})

/**
 * Reads drafts saved while characters were called giraffes: `giraffes`,
 * `defaults.giraffe` and the `giraffes` clay default move to their new names.
 * Returns a new layout; anything else is left as it is.
 */
export function migrate(input) {
  if (!input || typeof input !== 'object') return input
  const out = { ...input }
  if ('giraffes' in out) {
    out.characters ??= out.giraffes
    delete out.giraffes
  }
  if (out.defaults && typeof out.defaults === 'object') {
    const defaults = (out.defaults = { ...out.defaults })
    if ('giraffe' in defaults) {
      defaults.character ??= defaults.giraffe
      delete defaults.giraffe
    }
    const clay = defaults.clay
    if (clay && typeof clay === 'object' && 'giraffes' in clay) {
      const { giraffes, ...rest } = clay
      defaults.clay = { ...rest, characters: rest.characters ?? giraffes }
    }
  }
  return out
}

export function validate(input, catalog) {
  const data = layout.parse(migrate(input))
  if (data.sourceLights) {
    const originals = new Map(
      (catalog.sourceLights ?? []).map((l) => [l.id, l]),
    )
    const seen = new Set()
    data.sourceLights = data.sourceLights.flatMap((edit) => {
      const base = originals.get(edit.id)
      if (!base || seen.has(edit.id) || (edit.rotation && !base.shape.rotation))
        throw Error('원본 조명의 ID 또는 방향을 확인하세요.')
      seen.add(edit.id)
      const difference = sourceDifference(base, sourceValues(base, edit))
      return difference ? [difference] : []
    })
    if (!data.sourceLights.length) delete data.sourceLights
  }
  const rooms = catalog.rooms.map((r) => r.id)
  const kinds = new Set(catalog.items.map((i) => i.kind))
  const ids = [...rooms, ...data.items.map((i) => i.id)]
  const characterIds = (data.characters ?? []).map((g) => g.id)
  const pages = data.pages.map((p) => p.id)
  for (const keys of [
    [...ids, ...characterIds],
    pages,
    (data.lights ?? []).map((l) => l.id),
    data.spots.map((s) => s.id),
  ]) {
    if (new Set(keys).size !== keys.length) throw Error('중복된 ID가 있습니다.')
  }
  for (const light of data.lights ?? [])
    if (
      !rooms.includes(light.room) ||
      catalog.sourceLights?.some((l) => l.id === light.id)
    )
      throw Error(light.label + '의 방을 확인하세요.')
  for (const i of data.items)
    if (!rooms.includes(i.room) || !kinds.has(i.kind))
      throw Error(i.label + '의 방 또는 종류를 확인하세요.')
  for (const i of data.items) {
    const allowed = catalog.options?.[i.kind]
    if (
      allowed &&
      ((!allowed.colors.includes('*') && !allowed.colors.includes(i.color)) ||
        !allowed.finishes.includes(i.finish))
    )
      throw Error(i.label + '에서 사용할 수 없는 옵션입니다.')
    const original = catalog.items.find((o) => o.id === i.id)
    if (original && original.kind !== i.kind)
      throw Error(i.label + '의 모델 종류를 변경할 수 없습니다.')
  }
  for (const g of data.characters ?? []) {
    if (!rooms.includes(g.room)) throw Error(g.label + '의 방을 확인하세요.')
    // A removed page leaves the character without a link.
    if (g.page && !pages.includes(g.page)) delete g.page
  }
  // An object removed here or by a Blender handoff takes its overrides along.
  if (data.overrides?.clay) {
    const owners = new Set([
      ...rooms,
      ...data.items.map((i) => i.id),
      ...characterIds,
    ])
    for (const key of Object.keys(data.overrides.clay))
      if (!owners.has(key)) delete data.overrides.clay[key]
    if (!Object.keys(data.overrides.clay).length) delete data.overrides.clay
  }
  if (data.overrides && !Object.keys(data.overrides).length)
    delete data.overrides
  if (data.characters && !data.characters.length) delete data.characters
  for (const s of data.spots)
    if (
      !ids.includes(s.anchor) ||
      (s.action.type === 'page' && !pages.includes(s.action.page))
    )
      throw Error(s.label + '의 연결 대상을 확인하세요.')
  return data
}

function sameValue(key, a, b) {
  if (equal(a, b)) return true
  if (key.endsWith('.shape') && a && b && a.type === b.type)
    return Object.keys(a).every((prop) =>
      sameValue(key + '.' + prop, a[prop], b[prop]),
    )
  if (typeof a === 'number' && typeof b === 'number')
    return Math.abs(a - b) < 0.00002
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length)
    return false
  const near = (sign) => a.every((v, i) => Math.abs(v - sign * b[i]) <= 0.00002)
  return near(1) || (key.endsWith('.rotation') && near(-1))
}
export function mergeItems(base, current, incoming, choices = {}) {
  const maps = [base, current, incoming].map(
    (rows) => new Map(rows.map((i) => [i.id, i])),
  )
  const conflicts = []
  function choose(key, b, w, f) {
    if (sameValue(key, w, f) || sameValue(key, b, f)) return w
    if (sameValue(key, b, w)) return f
    if (choices[key] === 'web') return w
    if (choices[key] === 'file') return f
    conflicts.push({ key, web: w ?? null, file: f ?? null })
    return w
  }
  const items = []
  for (const id of new Set(maps.flatMap((m) => [...m.keys()]))) {
    const [b, w, f] = maps.map((m) => m.get(id))
    const result =
      b && w && f
        ? Object.fromEntries(
            Object.keys(b).map((k) => [
              k,
              choose(id + '.' + k, b[k], w[k], f[k]),
            ]),
          )
        : choose(id, b, w, f)
    if (result) items.push(result)
  }
  return { items, conflicts }
}

export function seed(catalog) {
  const pages = [
    {
      id: 'mental-sauna',
      title: '멘탈 사우나',
      summary: '사우나의 과정을 빌려 감정과 스트레스를 마주하고 비워내는 체험.',
      body: '연희예술극장에서 수건과 라커 키를 받고 입장합니다. 사운드 배스와 마음 세신, 함께 움직이는 시간을 거쳐 간식과 대화로 마무리합니다.',
      url: 'https://www.instagram.com/p/DX6zjVmk2Yg/',
    },
    {
      id: 'sports-day',
      title: '나를 찾는 ㅊㅊㅊ 운동회',
      summary: '몸과 생각, 감각과 마음을 움직이며 나를 발견하는 운동회.',
      body: '누부크에서 열린 리라지의 운동회입니다. 몸풀기와 두뇌·마음 종목, 신체 활동과 게더링을 통해 협동과 소통을 경험합니다.',
      url: 'https://www.instagram.com/p/Db5UwdEEaVs/',
    },
  ]
  const spots = pages.map((p, index) => ({
    id: p.id,
    anchor: index ? 'sports' : 'sauna-bench',
    label: p.title,
    position: [0, 1, 0],
    size: [2, 2, 2],
    action: { type: 'page', page: p.id },
  }))
  const initial = { items: catalog.items, pages, spots }
  if (catalog.webLights?.length) initial.lights = catalog.webLights
  return validate(initial, catalog)
}
