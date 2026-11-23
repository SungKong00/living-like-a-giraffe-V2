import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { json, put, root } from './world-files.mjs'

// The giraffe library: one rigged giraffe model and any number of motion
// files made for its skeleton. Files are stored under their content hash and
// listed in library.json. Drafts refer to a motion as `파일ID/클립이름`.

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const reject = (message) => Object.assign(Error(message), { status: 422 })

export function giraffeLibrary(dir = path.join(root, 'giraffes')) {
  const index = path.join(dir, 'library.json')
  const read = () =>
    fs.existsSync(index) ? json(index) : { model: null, motions: [] }
  const file = (id) => path.join(dir, id + '.glb')

  async function parse(buffer) {
    try {
      return await io.readBinary(new Uint8Array(buffer))
    } catch {
      throw reject(
        'GLB 파일을 읽을 수 없습니다. Blender에서 glTF 바이너리(.glb)로 내보내세요.',
      )
    }
  }
  function store(buffer) {
    const id = createHash('sha256').update(buffer).digest('hex').slice(0, 16)
    fs.mkdirSync(dir, { recursive: true })
    if (!fs.existsSync(file(id))) fs.writeFileSync(file(id), buffer)
    return id
  }
  // Names of the nodes a motion animates that the model's skeleton has.
  const matching = (motion, joints) =>
    motion.targets.filter((name) => joints.includes(name)).length

  function save(library) {
    const joints = library.model?.joints ?? []
    for (const m of library.motions) m.matched = matching(m, joints)
    put(index, library)
    return view(library)
  }
  // What the studio sees: no internal joint lists.
  function view(library) {
    return {
      model: library.model && {
        id: library.model.id,
        name: library.model.name,
        joints: library.model.joints.length,
        bytes: library.model.bytes,
      },
      motions: library.motions.map((m) => ({
        id: m.id,
        name: m.name,
        clips: m.clips,
        matched: m.matched,
        targets: m.targets.length,
      })),
    }
  }

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

  return Object.freeze({
    list: () => view(read()),
    file(id) {
      if (!/^[a-f0-9]{16}$/.test(id)) return null
      return fs.existsSync(file(id)) ? file(id) : null
    },
    async setModel(buffer, name = '기린 모델') {
      const doc = await parse(buffer)
      const skins = doc.getRoot().listSkins()
      if (!skins.length)
        throw reject(
          '리깅된 모델이 아닙니다. 아마추어와 스킨이 포함된 GLB를 올리세요.',
        )
      if (!doc.getRoot().listMeshes().length)
        throw reject('모델에 메시가 없습니다.')
      const joints = [
        ...new Set(
          skins.flatMap((s) => s.listJoints().map((j) => j.getName())),
        ),
      ]
      const library = read()
      const id = store(buffer)
      // Actions exported with the model are motions for it too.
      if (doc.getRoot().listAnimations().length) {
        library.motions = library.motions.filter((m) => m.id !== id)
        library.motions.unshift(motionEntry(doc, id, name))
      }
      library.model = {
        id,
        name: String(name).slice(0, 100),
        joints,
        bytes: buffer.length,
      }
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
      if (library.model && !matching(motion, library.model.joints))
        throw reject(
          '기린 모델의 관절 이름과 맞는 동작이 없습니다. 같은 아마추어에서 만든 동작인지 확인하세요.',
        )
      library.motions = library.motions.filter((m) => m.id !== motion.id)
      library.motions.push(motion)
      return save(library)
    },
    removeMotion(id) {
      const library = read()
      library.motions = library.motions.filter((m) => m.id !== id)
      return save(library)
    },
  })
}
