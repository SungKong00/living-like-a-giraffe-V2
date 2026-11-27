import { characterClips } from './character-route.mjs'

export function characterSheet(layout, library) {
  const list = layout?.characters ?? []
  if (!list.length) return null
  const models = {}
  for (const c of list) {
    const id = c.model ?? library.fallback
    const m = library.models.find((x) => x.id === id)
    if (m)
      models[id] = {
        file: m.file,
        height: m.height,
        measured: m.measured,
        ...(m.stride ? { stride: m.stride } : {}),
        wearables: m.wearables,
        lods: m.lods ?? [],
        protect: m.protect,
      }
  }
  const clips = [layout.defaults?.character, ...list].flatMap(characterClips)
  const motionFiles = [...new Set(clips.map((clip) => clip.split('/')[0]))]
  return {
    models,
    fallback: library.fallback,
    files: [
      ...new Set([
        ...Object.values(models).map((m) => m.file),
        ...motionFiles.filter((f) => library.motions.some((m) => m.id === f)),
      ]),
    ],
  }
}
