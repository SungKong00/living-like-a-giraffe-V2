// Adds reduced levels to a character model.
//
//   node scripts/character-lods.mjs <model.glb> [<output.glb>]
//
// Blender (scripts/character-lods.py) joins the body meshes, removes
// triangles and bakes the colours onto one image per level. This script puts
// those meshes into the model, bound to the model's own skin, so the meshes,
// materials and clips the model already had are not touched. Levels a model
// already carries are replaced. Without <output.glb> the model is rewritten.

import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { copyToDocument } from '@gltf-transform/functions'
import { modelFacts } from '../shared/character-library.mjs'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const [source, output = source] = process.argv.slice(2)
if (!source) {
  console.error('node scripts/character-lods.mjs <model.glb> [<output.glb>]')
  process.exit(1)
}
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const triangles = (node) =>
  node
    .getMesh()
    .listPrimitives()
    .reduce((sum, p) => sum + (p.getIndices()?.getCount() ?? 0) / 3, 0)

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'character-lods-'))
try {
  const built = path.join(work, 'levels.glb')
  execFileSync(
    path.resolve('.venv/bin/python'),
    ['scripts/character-lods.py', path.resolve(source), built],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  )
  const model = await io.read(source)
  const levels = await io.read(built)
  const root = model.getRoot()
  const scene = root.getDefaultScene() ?? root.listScenes()[0]
  const [skin] = root.listSkins()
  if (!skin || root.listSkins().length !== 1)
    throw Error('스킨이 하나인 모델만 다룹니다.')
  const joints = skin.listJoints().map((joint) => joint.getName())

  // Levels from an earlier run go, with the meshes and images only they used.
  const isLevel = (node) =>
    /^LOD[12]\./.test(node.getName()) || 'lod' in (node.getExtras() ?? {})
  for (const node of root.listNodes().filter(isLevel)) {
    const mesh = node.getMesh()
    node.dispose()
    if (mesh && !mesh.listParents().some((p) => p.propertyType === 'Node')) {
      const parts = mesh.listPrimitives()
      const materials = parts.map((p) => p.getMaterial())
      mesh.dispose()
      for (const p of parts) {
        const accessors = [p.getIndices(), ...p.listAttributes()]
        p.dispose()
        for (const accessor of accessors)
          if (accessor?.listParents().length === 1) accessor.dispose()
      }
      for (const material of materials) {
        if (!material || material.listParents().length > 1) continue
        const texture = material.getBaseColorTexture()
        material.dispose()
        if (texture && texture.listParents().length === 1) texture.dispose()
      }
    }
  }

  for (const from of levels.getRoot().listNodes()) {
    if (!from.getMesh()) continue
    // The same bones by name: Blender wrote its own skin in its own order.
    const order = from
      .getSkin()
      .listJoints()
      .map((joint) => joints.indexOf(joint.getName()))
    if (order.includes(-1))
      throw Error('축소 단계가 모델에 없는 관절을 씁니다.')
    const mesh = copyToDocument(model, levels, [from.getMesh()]).get(
      from.getMesh(),
    )
    for (const primitive of mesh.listPrimitives()) {
      const bound = primitive.getAttribute('JOINTS_0')
      const array = bound.getArray().slice()
      for (let i = 0; i < array.length; i++) array[i] = order[array[i]]
      bound.setArray(array)
    }
    const node = model
      .createNode(from.getName())
      .setMesh(mesh)
      .setSkin(skin)
      .setExtras(from.getExtras())
    scene.addChild(node)
  }

  // A GLB holds one buffer; the copies brought theirs along.
  const [buffer, ...extra] = root.listBuffers()
  for (const accessor of root.listAccessors()) accessor.setBuffer(buffer)
  for (const other of extra) other.dispose()

  const facts = modelFacts(model)
  if (facts.lodOrphans.length)
    throw Error('쓸 수 없는 축소 단계: ' + facts.lodOrphans.join(', '))
  await io.write(output, model)
  const named = (name) => root.listNodes().find((n) => n.getName() === name)
  for (const lod of facts.lods) {
    const stands = [lod.of, ...(lod.covers ?? [])].map(named)
    const before = stands.reduce((sum, node) => sum + triangles(node), 0)
    const draws = stands.reduce(
      (sum, node) => sum + node.getMesh().listPrimitives().length,
      0,
    )
    console.log(
      `${lod.node}: 삼각형 ${before} → ${triangles(named(lod.node))}, 드로우 ${draws} → ${named(lod.node).getMesh().listPrimitives().length}`,
    )
  }
  console.log(output + ' ' + Math.round(fs.statSync(output).size / 1024) + 'KB')
} finally {
  fs.rmSync(work, { recursive: true, force: true })
}
