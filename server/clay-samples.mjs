import { Document, getBounds, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import {
  copyToDocument,
  createDefaultPropertyResolver,
} from '@gltf-transform/functions'

// Only sample geometry and its materials cross the studio API boundary.
async function extractSamples() {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  const source = await io.read(
    'assets-source/riragi-v06/full/riraji_normal.glb',
  )
  const result = new Document()
  const resolve = createDefaultPropertyResolver(result, source)
  const scene = result.createScene('리라지 점토 시안')
  const nodes = source
    .getRoot()
    .listNodes()
    .filter((n) => /^West_Bench_Tier_[01]$/.test(n.getName()) && n.getMesh())
  if (!nodes.length) throw Error('v06 원본에서 시안 대상을 찾을 수 없습니다.')
  const group = result.createNode('bench')
  scene.addChild(group)
  const meshes = nodes.map((n) => n.getMesh())
  const copied = copyToDocument(result, source, meshes, resolve)
  for (const n of nodes) {
    group.addChild(
      result
        .createNode(n.getName())
        .setMatrix(n.getWorldMatrix())
        .setMesh(copied.get(n.getMesh())),
    )
  }
  const { min, max } = getBounds(group)
  group.setTranslation([
    -(min[0] + max[0]) / 2,
    -min[1],
    -(min[2] + max[2]) / 2,
  ])
  return Buffer.from(await io.writeBinary(result))
}

let samples
export function claySamples() {
  samples ??= extractSamples().catch((error) => {
    samples = undefined
    throw error
  })
  return samples
}
