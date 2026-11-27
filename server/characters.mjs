import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { json, put, root } from './world-files.mjs'

import {
  BUILTIN,
  BIPED,
  characterCatalog,
  modelFacts,
  motionEntry,
} from '../shared/character-library.mjs'
export { BUILTIN, heightRange } from '../shared/character-library.mjs'
const builtinFile = path.resolve(
  'assets-source/characters/riragi-clay/riragi-giraffe.glb',
)
const bipedFile = path.resolve(
  'assets-source/characters/riragi-clay/riragi-biped.glb',
)

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const reject = (message) => Object.assign(Error(message), { status: 422 })

async function parse(buffer) {
  try {
    return await io.readBinary(new Uint8Array(buffer))
  } catch {
    throw reject(
      'GLB 파일을 읽을 수 없습니다. Blender에서 glTF 바이너리(.glb)로 내보내세요.',
    )
  }
}
export function characterLibrary(
  dir = path.join(root, 'characters'),
  {
    builtin = builtinFile,
    biped = builtin === builtinFile ? bipedFile : null,
    layouts = () => [],
  } = {},
) {
  // Libraries made before characters were named giraffes.
  const legacyDir = path.join(path.dirname(dir), 'giraffes')
  if (!fs.existsSync(dir) && fs.existsSync(legacyDir))
    fs.renameSync(legacyDir, dir)
  const index = path.join(dir, 'library.json')
  const file = (id) => path.join(dir, id + '.glb')
  function read() {
    const stored = fs.existsSync(index) ? json(index) : {}
    // One `model` before several models could be kept. Characters saved
    // then show it until they choose another.
    const library = stored.models
      ? stored
      : {
          models: stored.model ? [stored.model] : [],
          motions: stored.motions ?? [],
          fallback: stored.model?.id,
        }
    // Models listed before they could change file were stored under their ID.
    for (const m of library.models) m.file ??= m.id
    library.builtin ??= {}
    return library
  }

  const bundledFiles = new Map([
    [BUILTIN, builtin],
    [BIPED, biped],
  ])
  let bundled
  function bundledEntries() {
    return (bundled ??= Promise.all(
      [...bundledFiles]
        .filter(([, path]) => path && fs.existsSync(path))
        .map(async ([id, path]) => {
          const doc = await io.read(path)
          const name = id === BIPED ? '두발 점토 기린' : '리라지 점토 기린'
          return {
            model: { id, file: id, name, ...modelFacts(doc), builtin: true },
            motion: doc.getRoot().listAnimations().length
              ? { ...motionEntry(doc, id, name), builtin: true }
              : null,
          }
        }),
    ))
  }

  function store(buffer) {
    const id = createHash('sha256').update(buffer).digest('hex').slice(0, 16)
    fs.mkdirSync(dir, { recursive: true })
    if (!fs.existsSync(file(id))) fs.writeFileSync(file(id), buffer)
    return id
  }
  const publishedDir = path.join(dir, 'published')
  const publishedFile = (id) =>
    /^[\w-]{1,100}$/.test(id) ? path.join(publishedDir, id + '.json') : null

  const catalog = characterCatalog({
    read,
    persist: (library) => put(index, library),
    store,
    parse,
    layouts,
    bundledEntries,
    isBuiltin: (id) => bundledFiles.has(id),
  })
  return Object.freeze({
    ...catalog,
    /**
     * The characters' files of a published world, fixed the first time it
     * is asked for so library edits wait for the next publication.
     */
    async published(id, layout) {
      const file = publishedFile(id)
      if (!file) return null
      if (fs.existsSync(file)) return json(file)
      const fixed = await catalog.sheet(layout)
      put(file, fixed)
      return fixed
    },
    /** True when one of these published worlds reads library file `name`. */
    servesPublished(ids, name) {
      return ids.some((id) => {
        const file = id && publishedFile(id)
        return (
          !!file && fs.existsSync(file) && !!json(file)?.files?.includes(name)
        )
      })
    },
    /** Path of a stored or bundled GLB, or null. */
    file(id) {
      if (bundledFiles.has(id)) {
        const bundled = bundledFiles.get(id)
        return bundled && fs.existsSync(bundled) ? bundled : null
      }
      if (!/^[a-f0-9]{16}$/.test(id)) return null
      // Files are named by content; a model's ID was its first file.
      return fs.existsSync(file(id)) ? file(id) : null
    },
  })
}
