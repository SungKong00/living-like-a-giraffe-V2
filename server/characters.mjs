import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { NodeIO, getBounds } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { json, put, root } from './world-files.mjs'

// The character library: rigged character models and motion files made for
// their skeletons. Uploaded files are stored under their content hash and
// listed in library.json. A model keeps its ID when its file is replaced, so
// characters placed with it stay; a motion is named by its file. The bundled
// Riragi clay giraffe is always offered as the built-in model, and its own
// action as a built-in motion. Drafts refer to a model by its ID and to a
// motion as `파일ID/클립이름`. Models and motions a draft uses cannot be
// removed; removing one only unlists it, so uploading the file again
// brings it back.

export const BUILTIN = 'riragi'
const builtinFile = path.resolve(
  'assets-source/characters/riragi-clay/riragi-giraffe.glb',
)
const builtinName = '리라지 점토 기린'

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
const jointsOf = (doc) => [
  ...new Set(
    doc
      .getRoot()
      .listSkins()
      .flatMap((s) => s.listJoints().map((j) => j.getName())),
  ),
]
// Wearables are nodes with a `wearable` custom property (exported as glTF
// extras) or a name starting with `Wear.`. Characters switch them on by ID.
const wearLabels = { cape: '케이프', flower: '꽃' }
function wearablesOf(doc) {
  const found = new Map()
  for (const node of doc.getRoot().listNodes()) {
    const extras = node.getExtras() ?? {}
    const name = node.getName()
    const tag =
      typeof extras.wearable === 'string' && extras.wearable.trim()
        ? extras.wearable.trim()
        : name.startsWith('Wear.')
          ? name.slice(5)
          : null
    if (!tag) continue
    const id = tag.slice(0, 40)
    if (!found.has(id))
      found.set(id, {
        id,
        label: String(extras.label ?? wearLabels[id] ?? id).slice(0, 40),
        nodes: [],
      })
    found.get(id).nodes.push(name)
  }
  return [...found.values()]
}
// Vertices marked to keep their shape under clay (see clay-protect-loader).
const protects = (doc) =>
  doc
    .getRoot()
    .listMeshes()
    .some((m) =>
      m.listPrimitives().some((p) => p.getAttribute('_CLAY_PROTECT')),
    )
// What the studio needs to know about a model file beyond its joints.
const modelFacts = (doc) => ({
  joints: jointsOf(doc),
  measured: measure(doc),
  wearables: wearablesOf(doc),
  protect: protects(doc),
})

// Height of the model as exported, in metres (bind pose).
function measure(doc) {
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]
  if (!scene) return 1
  const { min, max } = getBounds(scene)
  const height = max[1] - min[1]
  return Number.isFinite(height) && height > 0.01 ? round(height) : 1
}
const round = (v) => Math.round(v * 100) / 100
export const heightRange = Object.freeze({ min: 0.1, max: 20 })
const cleanName = (name, fallback) =>
  String(name ?? '')
    .trim()
    .slice(0, 100) || fallback

// Clips and the node names they animate, read from a parsed GLB.
function motionEntry(doc, id, name) {
  const animations = doc.getRoot().listAnimations()
  return {
    id,
    name: String(name).slice(0, 100),
    clips: animations.map((a, i) => ({
      name: a.getName() || '동작 ' + (i + 1),
      duration: Math.max(
        0,
        ...a.listSamplers().map((s) => s.getInput()?.getMax([])?.[0] ?? 0),
      ),
    })),
    targets: [
      ...new Set(
        animations.flatMap((a) =>
          a
            .listChannels()
            .map((c) => c.getTargetNode()?.getName())
            .filter(Boolean),
        ),
      ),
    ],
  }
}

export function characterLibrary(
  dir = path.join(root, 'characters'),
  { builtin = builtinFile, layouts = () => [] } = {},
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

  // The bundled model is read once; it is missing in a bare checkout.
  let bundled
  function builtinEntry() {
    bundled ??= fs.existsSync(builtin)
      ? io.read(builtin).then((doc) => ({
          model: {
            id: BUILTIN,
            file: BUILTIN,
            name: builtinName,
            ...modelFacts(doc),
          },
          motion: doc.getRoot().listAnimations().length
            ? motionEntry(doc, BUILTIN, builtinName)
            : null,
        }))
      : Promise.resolve(null)
    return bundled
  }

  // Node names a motion animates that a model's skeleton has.
  const matching = (motion, joints) =>
    motion.targets.filter((name) => joints.includes(name)).length

  // What the studio sees: no internal joint lists.
  async function view(library = read()) {
    const extra = await builtinEntry()
    const models = [
      ...(extra ? [{ ...extra.model, ...library.builtin, builtin: true }] : []),
      ...library.models,
    ]
    const motions = [
      ...(extra?.motion ? [{ ...extra.motion, builtin: true }] : []),
      ...library.motions,
    ]
    return {
      models: models.map((m) => ({
        id: m.id,
        name: m.name,
        file: m.file,
        joints: m.joints.length,
        // Height a character at 100% shows, and the height as exported.
        height: m.height ?? m.measured ?? 1,
        measured: m.measured ?? 1,
        wearables: m.wearables ?? [],
        // Its own protected vertices; otherwise a giraffe skeleton keeps
        // its face by height and other models have no protection.
        protect: !!m.protect,
        ...(m.bytes ? { bytes: m.bytes } : {}),
        ...(m.builtin ? { builtin: true } : {}),
      })),
      motions: motions.map((m) => ({
        id: m.id,
        name: m.name,
        clips: m.clips,
        targets: m.targets.length,
        ...(m.model ? { model: m.model } : {}),
        // Joints matched per model; 0 means the motion cannot move it.
        matched: Object.fromEntries(
          models.map((model) => [model.id, matching(m, model.joints)]),
        ),
        ...(m.builtin ? { builtin: true } : {}),
      })),
      // The model a character without one shows.
      fallback:
        (library.fallback &&
          models.some((m) => m.id === library.fallback) &&
          library.fallback) ||
        models[0]?.id ||
        null,
    }
  }
  function save(library) {
    put(index, library)
    return view(library)
  }
  function store(buffer) {
    const id = createHash('sha256').update(buffer).digest('hex').slice(0, 16)
    fs.mkdirSync(dir, { recursive: true })
    if (!fs.existsSync(file(id))) fs.writeFileSync(file(id), buffer)
    return id
  }
  const protectedId = (id) => {
    if (id === BUILTIN) throw reject('기본 캐릭터는 지울 수 없습니다.')
  }
  const notFound = () =>
    Object.assign(Error('자료실에 없는 모델입니다.'), { status: 404 })
  function freeId(library) {
    let id
    do id = randomBytes(8).toString('hex')
    while (id === BUILTIN || library.models.some((m) => m.id === id))
    return id
  }
  // Layouts include editable, published and saved versions using the library.
  async function usage(test) {
    const fallback = (await view()).fallback
    let count = 0
    for (const layout of layouts()) {
      const list = layout?.characters ?? layout?.giraffes ?? []
      count += list.filter((c) => test(c, fallback)).length
      const world = layout?.defaults?.character ?? layout?.defaults?.giraffe
      if (test({ motion: world?.motion, model: null, default: true }, fallback))
        count++
    }
    return count
  }
  const inUse = (count, what) => {
    if (count)
      throw Object.assign(
        Error(
          '초안·공개본·버전 기록의 캐릭터 ' +
            count +
            '곳에서 쓰는 ' +
            what +
            '입니다.',
        ),
        { status: 409 },
      )
  }
  // A motion's embedded actions and their checks against a parsed model.
  function rigged(doc) {
    if (!doc.getRoot().listSkins().length)
      throw reject(
        '리깅된 모델이 아닙니다. 아마추어와 스킨이 포함된 GLB를 올리세요.',
      )
    if (!doc.getRoot().listMeshes().length)
      throw reject('모델에 메시가 없습니다.')
  }

  // What a layout's characters need to be drawn outside the studio: the
  // models they show (file, heights, wearables) and every file they read.
  async function sheet(layout) {
    const list = layout?.characters ?? []
    if (!list.length) return null
    const library = await view()
    const models = {}
    for (const c of list) {
      const id = c.model ?? library.fallback
      const m = library.models.find((x) => x.id === id)
      if (m)
        models[id] = {
          file: m.file,
          height: m.height,
          measured: m.measured,
          wearables: m.wearables,
          protect: m.protect,
        }
    }
    const clips = [layout.defaults?.character, ...list].flatMap((c) =>
      c?.motion == null ? [] : [c.motion].flat(),
    )
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
  const publishedDir = path.join(dir, 'published')
  const publishedFile = (id) =>
    /^[\w-]{1,100}$/.test(id) ? path.join(publishedDir, id + '.json') : null

  return Object.freeze({
    list: () => view(),
    /** The characters' files for a layout, read from the library now. */
    sheet,
    /**
     * The characters' files of a published world, fixed the first time it
     * is asked for so library edits wait for the next publication.
     */
    async published(id, layout) {
      const file = publishedFile(id)
      if (!file) return null
      if (fs.existsSync(file)) return json(file)
      const fixed = await sheet(layout)
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
      if (id === BUILTIN) return fs.existsSync(builtin) ? builtin : null
      if (!/^[a-f0-9]{16}$/.test(id)) return null
      // Files are named by content; a model's ID was its first file.
      return fs.existsSync(file(id)) ? file(id) : null
    },
    async addModel(buffer, name = '캐릭터 모델') {
      const doc = await parse(buffer)
      rigged(doc)
      const library = read()
      const file = store(buffer)
      // The same file uploaded again lists the model it already is.
      const known = library.models.find((m) => m.file === file)
      const id =
        known?.id ??
        (library.models.some((m) => m.id === file) ? freeId(library) : file)
      library.models = library.models.filter((m) => m.id !== id)
      library.models.push({
        ...known,
        id,
        file,
        name: cleanName(known ? known.name : name, '캐릭터 모델'),
        ...modelFacts(doc),
        bytes: buffer.length,
      })
      // Actions exported with the model are motions for it too.
      library.motions = library.motions.filter((m) => m.id !== file)
      if (doc.getRoot().listAnimations().length)
        library.motions.unshift({
          ...motionEntry(doc, file, cleanName(name, '캐릭터 모델')),
          model: id,
        })
      return { id, library: await save(library) }
    },
    /**
     * Gives a model a new file and keeps its ID, name and height. Returns the
     * embedded motion's old and new file IDs so the studio can move characters
     * that played it.
     */
    async replaceModel(id, buffer) {
      if (id === BUILTIN)
        throw reject(
          '기본 모델은 교체할 수 없습니다. 새 모델로 올린 뒤 캐릭터의 모델을 바꾸세요.',
        )
      const library = read()
      const model = library.models.find((m) => m.id === id)
      if (!model) throw notFound()
      const doc = await parse(buffer)
      rigged(doc)
      const from = model.file
      const file = store(buffer)
      if (library.models.some((m) => m.id !== id && m.file === file))
        throw reject('자료실의 다른 모델과 같은 파일입니다.')
      Object.assign(model, { file, ...modelFacts(doc), bytes: buffer.length })
      const embedded = library.motions.find(
        (m) => m.model === id || m.id === from,
      )
      library.motions = library.motions.filter(
        (m) => m.model !== id && m.id !== from,
      )
      if (doc.getRoot().listAnimations().length)
        library.motions.unshift({
          ...motionEntry(doc, file, embedded?.name ?? model.name),
          model: id,
        })
      return {
        id,
        motion: embedded ? { from, to: file } : null,
        library: await save(library),
      }
    },
    /** Changes a model's name or the height it shows at 100%. */
    async updateModel(id, { name, height } = {}) {
      const library = read()
      const model =
        id === BUILTIN
          ? (library.builtin ??= {})
          : library.models.find((m) => m.id === id)
      if (!model) throw notFound()
      if (name !== undefined) {
        const clean = String(name).trim().slice(0, 100)
        if (!clean) throw reject('모델 이름을 입력하세요.')
        model.name = clean
      }
      if (height !== undefined) {
        const h = Number(height)
        if (!(h >= heightRange.min && h <= heightRange.max))
          throw reject(
            '기본 키는 ' +
              heightRange.min +
              '~' +
              heightRange.max +
              'm 사이로 정하세요.',
          )
        model.height = round(h)
      }
      return save(library)
    },
    async removeModel(id) {
      protectedId(id)
      const library = read()
      if (!library.models.some((m) => m.id === id)) throw notFound()
      inUse(
        await usage(
          (c, fallback) => !c.default && (c.model ?? fallback) === id,
        ),
        '모델',
      )
      const file = library.models.find((m) => m.id === id).file
      library.models = library.models.filter((m) => m.id !== id)
      // Its embedded actions go with it; separate motion files stay.
      library.motions = library.motions.filter(
        (m) => m.model !== id && m.id !== file,
      )
      if (library.fallback === id) delete library.fallback
      return save(library)
    },
    async addMotion(buffer, name = '동작') {
      const doc = await parse(buffer)
      if (!doc.getRoot().listAnimations().length)
        throw reject(
          '애니메이션이 없습니다. Blender에서 동작(액션)을 포함해 내보내세요.',
        )
      const library = read()
      const motion = motionEntry(doc, store(buffer), name)
      const extra = await builtinEntry()
      const models = [...(extra ? [extra.model] : []), ...library.models]
      // A model file uploaded again as a motion keeps its model link.
      const owner = library.motions.find((m) => m.id === motion.id)?.model
      if (owner) motion.model = owner
      if (models.length && !models.some((m) => matching(motion, m.joints)))
        throw reject(
          '캐릭터 모델의 관절 이름과 맞는 동작이 없습니다. 같은 아마추어에서 만든 동작인지 확인하세요.',
        )
      library.motions = library.motions.filter((m) => m.id !== motion.id)
      library.motions.push(motion)
      return save(library)
    },
    async removeMotion(id) {
      protectedId(id)
      inUse(
        await usage((c) =>
          [c.motion ?? []]
            .flat()
            .some((clip) => String(clip).startsWith(id + '/')),
        ),
        '동작',
      )
      const library = read()
      library.motions = library.motions.filter((m) => m.id !== id)
      return save(library)
    },
  })
}
