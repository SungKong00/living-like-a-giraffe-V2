import {
  sourceDifference,
  sourceValues,
  resolvedSources,
} from '../shared/source-lights.mjs'
import { mergeItems, studioLights } from './layout.mjs'
export function compareHandoff(
  id,
  candidate,
  base,
  baseCatalog,
  draft,
  published,
  choices = {},
) {
  if (base.model !== draft.model)
    throw Object.assign(
      Error(
        '초안의 원본이 바뀌었습니다. 새 원본을 발행한 뒤 다시 내려받으세요.',
      ),
      { status: 409 },
    )
  const lights = mergeItems(
    studioLights.parse(base.layout.lights ?? []),
    studioLights.parse(draft.layout.lights ?? []),
    studioLights.parse(candidate.webLights ?? []),
    Object.fromEntries(
      Object.entries(choices)
        .filter(([key]) => key.startsWith('light:'))
        .map(([key, value]) => [key.slice(6), value]),
    ),
  )
  // The artist owns the existence and shape of native lamps. Merge editable
  // fields by ID on surviving objects; a removed native lamp stays removed.
  const original = baseCatalog.sourceLights
  const changes = (layout) =>
    new Map((layout.sourceLights ?? []).map((e) => [e.id, e]))
  const before = changes(base.layout),
    current = changes(draft.layout)
  const returned = new Map(candidate.sourceLights.map((l) => [l.id, l]))
  const common = original.filter((l) => returned.has(l.id))
  const src = mergeItems(
    common.map((l) => sourceValues(l, before.get(l.id))),
    common.map((l) => sourceValues(l, current.get(l.id))),
    common.map((l) => sourceValues(returned.get(l.id))),
    Object.fromEntries(
      Object.entries(choices)
        .filter(([k]) => k.startsWith('source:'))
        .map(([k, v]) => [k.slice(7), v]),
    ),
  )
  const sourceLights = src.items
    .map((values) => sourceDifference(returned.get(values.id), values))
    .filter(Boolean)
  const removedConflicts = []
  for (const baseline of resolvedSources(original, base.layout.sourceLights)) {
    if (returned.has(baseline.id)) continue
    const native = original.find((l) => l.id === baseline.id)
    const web = sourceValues(native, current.get(baseline.id))
    const key = 'source:' + baseline.id
    if (sourceDifference(baseline, web) && choices[key] !== 'file')
      removedConflicts.push({
        key,
        removedSource: baseline.label,
        web,
        file: null,
      })
  }
  const furniture = mergeItems(
    base.layout.items,
    draft.layout.items,
    candidate.items,
    choices,
  )
  return {
    model: id,
    revision: draft.id,
    publication: published.id,
    rooms: candidate.rooms,
    items: furniture.items,
    lights: lights.items,
    sourceLights,
    sourceCatalog: candidate.sourceLights,
    conflicts: [
      ...furniture.conflicts,
      ...removedConflicts,
      ...src.conflicts.map((c) => ({ ...c, key: 'source:' + c.key })),
      ...lights.conflicts.map((c) => ({ ...c, key: 'light:' + c.key })),
    ],
  }
}
