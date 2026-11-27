import { characterSheet } from './character-sheet.mjs'
import { characterClips } from './character-route.mjs'
import { randomBytes } from 'node:crypto'
import { getBounds } from '@gltf-transform/core'

export const BUILTIN = 'riragi'
export const BIPED = 'riragi-biped'
const reject = (message) => Object.assign(Error(message), { status: 422 })
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
    // A reduced level dresses with the wearable it stands in for.
    if (lodOf(node)) continue
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
// Reduced levels are meshes with fewer triangles and materials that stand in
// for a node of the model when characters are small on screen: a node named
// `LOD1.<node>` or `LOD2.<node>`, or one with the custom properties `lod`
// (1 or 2) and `lodOf` (the node's name). A level only counts when that node
// exists and both are bound to the same skeleton.
export const lodLevels = Object.freeze([1, 2])
function lodOf(node) {
  const extras = node.getExtras() ?? {}
  const level = Number(extras.lod)
  if (lodLevels.includes(level) && typeof extras.lodOf === 'string')
    return { level, of: extras.lodOf.trim() }
  const named = /^LOD([12])\.(.+)$/.exec(node.getName())
  return named ? { level: Number(named[1]), of: named[2] } : null
}
function lodsOf(doc) {
  const nodes = doc.getRoot().listNodes()
  const lods = []
  const orphans = []
  for (const node of nodes) {
    const lod = lodOf(node)
    if (!lod) continue
    const name = node.getName()
    const original = nodes.find((n) => n.getName() === lod.of && !lodOf(n))
    if (original && original.getSkin() === node.getSkin())
      lods.push({ ...lod, node: name })
    else orphans.push(name)
  }
  return { lods, lodOrphans: orphans }
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
export const modelFacts = (doc) => ({
  joints: jointsOf(doc),
  measured: measure(doc),
  wearables: wearablesOf(doc),
  // Reduced levels the scene may draw, and the nodes that look like one
  // but have no original to stand in for.
  ...lodsOf(doc),
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
export const strideRange = Object.freeze({ min: 0.05, max: 20 })
const cleanName = (name, fallback) =>
  String(name ?? '')
    .trim()
    .slice(0, 100) || fallback

// Clips and the node names they animate, read from a parsed GLB.
export function motionEntry(doc, id, name) {
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

export function characterCatalog({
  read,
  persist,
  store,
  parse,
  bundledEntries,
  isBuiltin,
  layouts,
}) {
  // Node names a motion animates that a model's skeleton has.
  const matching = (motion, joints) =>
    motion.targets.filter((name) => joints.includes(name)).length

  // What the studio sees: no internal joint lists.
  async function view(library = read()) {
    const bundled = await bundledEntries()
    const models = [
      ...bundled.map(({ model }) => ({
        ...model,
        ...(model.id === BUILTIN
          ? library.builtin
          : library.builtins?.[model.id]),
      })),
      ...library.models,
    ]
    const motions = [
      ...bundled.map((entry) => entry.motion).filter(Boolean),
      ...library.motions,
    ]
    return {
      models: models.map((m) => ({
        id: m.id,
        name: m.name,
        file: m.file,
        joints: m.joints.length,
        ...(m.id === BIPED ? { suggestedMotion: BIPED + '/두 발 걷기' } : {}),
        // Height a character at 100% shows, and the height as exported.
        height: m.height ?? m.measured ?? 1,
        measured: m.measured ?? 1,
        // Ground one walk cycle covers at 100%, when the studio set it;
        // otherwise the scene measures it from the walk clip.
        ...(m.stride ? { stride: m.stride } : {}),
        wearables: m.wearables ?? [],
        lods: m.lods ?? [],
        lodOrphans: m.lodOrphans ?? [],
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
          models.map((model) => [
            model.id,
            m.builtin && model.builtin && m.id !== model.id
              ? 0
              : matching(m, model.joints),
          ]),
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
  async function save(library) {
    await persist(library)
    return view(library)
  }
  const protectedId = (id) => {
    if (isBuiltin(id)) throw reject('기본 캐릭터는 지울 수 없습니다.')
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
    for (const layout of await layouts()) {
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

  return {
    list: view,
    sheet: async (layout) => characterSheet(layout, await view()),
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
      if (isBuiltin(id))
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
        (m) => m.model !== id && m.id !== from && m.id !== file,
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
    /** Changes a model's name, the height it shows at 100% or its stride. */
    async updateModel(id, { name, height, stride } = {}) {
      const library = read()
      const model =
        id === BUILTIN
          ? (library.builtin ??= {})
          : id === BIPED && isBuiltin(id)
            ? ((library.builtins ??= {})[id] ??= {})
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
      // null goes back to the stride measured from the walk clip.
      if (stride === null) delete model.stride
      else if (stride !== undefined) {
        const v = Number(stride)
        if (!(v >= strideRange.min && v <= strideRange.max))
          throw reject(
            '걸음 길이는 ' +
              strideRange.min +
              '~' +
              strideRange.max +
              'm 사이로 정하세요.',
          )
        model.stride = round(v)
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
      inUse(
        await usage((c) =>
          characterClips(c).some((clip) => String(clip).startsWith(file + '/')),
        ),
        '동작',
      )

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
      const models = [
        ...(await bundledEntries()).map((e) => e.model),
        ...library.models,
      ]
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
          characterClips(c).some((clip) => String(clip).startsWith(id + '/')),
        ),
        '동작',
      )
      const library = read()
      library.motions = library.motions.filter((m) => m.id !== id)
      return save(library)
    },
  }
}
