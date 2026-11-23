import fs from 'node:fs/promises'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, KHRMaterialsUnlit } from '@gltf-transform/extensions'
import { dedup, prune, meshopt, weld } from '@gltf-transform/functions'
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer'
import validator from 'gltf-validator'
import sharp from 'sharp'
import { batchRoomCopies } from './instances.mjs'

// All surfaces sharing a baked image already have their final diffuse colour.
// A glTF unlit material displays it without repeating real-time light evaluation.
async function finishBakedMaterials(doc) {
  const extension = doc.createExtension(KHRMaterialsUnlit)
  const textures = new Set()
  for (const material of doc.getRoot().listMaterials()) {
    const texture = material.getEmissiveTexture()
    if (!texture || !material.getName().endsWith('display light')) continue
    material.setBaseColorTexture(texture).setBaseColorFactor([1, 1, 1, 1])
    material
      .getBaseColorTextureInfo()
      .setTexCoord(material.getEmissiveTextureInfo().getTexCoord())
    material
      .setEmissiveTexture(null)
      .setEmissiveFactor([0, 0, 0])
      .setExtension('KHR_materials_unlit', extension.createUnlit())
    textures.add(texture)
  }
  for (const texture of textures) {
    const jpeg = await sharp(texture.getImage())
      .jpeg({ quality: 88, chromaSubsampling: '4:4:4' })
      .toBuffer()
    texture.setMimeType('image/jpeg').setImage(jpeg)
  }
  if (!textures.size) extension.dispose()
  return textures.size > 0
}
function identities(doc) {
  return doc
    .getRoot()
    .listNodes()
    .flatMap((node) => {
      const { roomId, itemId } = node.getExtras()
      return roomId ? ['room/' + roomId] : itemId ? ['item/' + itemId] : []
    })
    .sort()
}
export async function optimize(input, output, expectedRooms) {
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'meshopt.encoder': MeshoptEncoder,
      'meshopt.decoder': MeshoptDecoder,
    })
  const doc = await io.read(input)
  const before = identities(doc)
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready])
  const baked = await finishBakedMaterials(doc)
  await doc.transform(weld(), dedup())
  if (baked) batchRoomCopies(doc)
  await doc.transform(
    prune({ keepExtras: true, keepLeaves: true }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  )
  await io.write(output, doc)
  const reopened = await io.read(output)
  const after = identities(reopened)
  if (
    JSON.stringify(before) !== JSON.stringify(after) ||
    !expectedRooms.every((id) => after.includes('room/' + id)) ||
    !reopened.getRoot().listMeshes().length
  )
    throw Error('최적화 결과의 방과 가구 식별자를 확인하세요.')
  const report = await validator.validateBytes(await fs.readFile(output), {
    maxIssues: 100,
  })
  if (report.issues.numErrors)
    throw Error(
      'GLB 검증 실패 · ' +
        report.issues.messages.find((m) => m.severity === 0)?.message,
    )
}
