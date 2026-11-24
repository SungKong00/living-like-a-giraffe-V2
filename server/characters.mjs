import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { json, put, root } from './world-files.mjs'

// The character library: rigged character models and motion files made for
// their skeletons. Uploaded files are stored under their content hash and
// listed in library.json. The bundled Riragi clay giraffe is always offered
// as the built-in model, and its own action as a built-in motion. Drafts
// refer to a model by its ID and to a motion as `파일ID/클립이름`.

export const BUILTIN = 'riragi'
const builtinFile = path.resolve(
  'assets-source/characters/riragi-clay/riragi-giraffe-base.glb',
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
  { builtin = builtinFile } = {},
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
    if (!stored.models) {
      return {
        models: stored.model ? [stored.model] : [],
        motions: stored.motions ?? [],
        fallback: stored.model?.id,
      }
    }
    return stored
  }

  // The bundled model is read once; it is missing in a bare checkout.
  let bundled
  function builtinEntry() {
    bundled ??= fs.existsSync(builtin)
      ? io.read(builtin).then((doc) => ({
          model: { id: BUILTIN, name: builtinName, joints: jointsOf(doc) },
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
      ...(extra ? [{ ...extra.model, builtin: true }] : []),
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
        joints: m.joints.length,
        ...(m.bytes ? { bytes: m.bytes } : {}),
        ...(m.builtin ? { builtin: true } : {}),
      })),
      motions: motions.map((m) => ({
        id: m.id,
        name: m.name,
        clips: m.clips,
        targets: m.targets.length,
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

  return Object.freeze({
    list: () => view(),
    /** Path of a stored or bundled GLB, or null. */
    file(id) {
      if (id === BUILTIN) return fs.existsSync(builtin) ? builtin : null
      if (!/^[a-f0-9]{16}$/.test(id)) return null
      return fs.existsSync(file(id)) ? file(id) : null
    },
    async addModel(buffer, name = '캐릭터 모델') {
      const doc = await parse(buffer)
      if (!doc.getRoot().listSkins().length)
        throw reject(
          '리깅된 모델이 아닙니다. 아마추어와 스킨이 포함된 GLB를 올리세요.',
        )
      if (!doc.getRoot().listMeshes().length)
        throw reject('모델에 메시가 없습니다.')
      const library = read()
      const id = store(buffer)
      // Actions exported with the model are motions for it too.
      library.motions = library.motions.filter((m) => m.id !== id)
      if (doc.getRoot().listAnimations().length)
        library.motions.unshift(motionEntry(doc, id, name))
      library.models = library.models.filter((m) => m.id !== id)
      library.models.push({
        id,
        name: String(name).slice(0, 100),
        joints: jointsOf(doc),
        bytes: buffer.length,
      })
      return { id, library: await save(library) }
    },
    async removeModel(id) {
      protectedId(id)
      const library = read()
      library.models = library.models.filter((m) => m.id !== id)
      // Its embedded actions go with it; separate motion files stay.
      library.motions = library.motions.filter((m) => m.id !== id)
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
      const library = read()
      library.motions = library.motions.filter((m) => m.id !== id)
      return save(library)
    },
  })
}
