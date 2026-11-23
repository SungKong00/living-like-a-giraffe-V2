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
const layout = z.strictObject({
  items: z.array(item).max(500),
  spots: z.array(hotspot).max(1000),
  pages: z.array(page).max(500),
})

export function validate(input, catalog) {
  const data = layout.parse(input)
  const rooms = catalog.rooms.map((r) => r.id)
  const kinds = new Set(catalog.items.map((i) => i.kind))
  const ids = [...rooms, ...data.items.map((i) => i.id)]
  const pages = data.pages.map((p) => p.id)
  for (const keys of [ids, pages, data.spots.map((s) => s.id)]) {
    if (new Set(keys).size !== keys.length) throw Error('중복된 ID가 있습니다.')
  }
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
  for (const s of data.spots)
    if (
      !ids.includes(s.anchor) ||
      (s.action.type === 'page' && !pages.includes(s.action.page))
    )
      throw Error(s.label + '의 연결 대상을 확인하세요.')
  return data
}

export function mergeItems(base, current, incoming, choices = {}) {
  const maps = [base, current, incoming].map(
    (rows) => new Map(rows.map((i) => [i.id, i])),
  )
  const conflicts = []
  function choose(key, b, w, f) {
    if (equal(w, f) || equal(b, f)) return w
    if (equal(b, w)) return f
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
  return validate({ items: catalog.items, pages, spots }, catalog)
}
