import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, prune, meshopt, weld } from '@gltf-transform/functions'
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer'

export async function optimize(input, output, expectedRooms) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.encoder':MeshoptEncoder,'meshopt.decoder':MeshoptDecoder})
  const doc = await io.read(input)
  await Promise.all([MeshoptEncoder.ready,MeshoptDecoder.ready])
  await doc.transform(weld(), dedup(), prune({keepExtras:true,keepLeaves:true}), meshopt({encoder:MeshoptEncoder,level:"medium"}))
  await io.write(output, doc)
  const reopened = await io.read(output)
  const rooms = reopened.getRoot().listNodes().map(node => node.getExtras().roomId).filter(Boolean)
  if (!expectedRooms.every(id => rooms.includes(id)) || !reopened.getRoot().listMeshes().length)
    throw new Error('최적화 결과에서 방 또는 모델이 사라졌습니다.')
}
