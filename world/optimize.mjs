import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, prune, reorder, weld } from '@gltf-transform/functions'
import { MeshoptEncoder } from 'meshoptimizer'

export async function optimize(input, output, expectedRooms) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  const doc = await io.read(input)
  await MeshoptEncoder.ready
  await doc.transform(weld(), dedup(), reorder({encoder: MeshoptEncoder}), prune({keepExtras:true,keepLeaves:true}))
  await io.write(output, doc)
  const reopened = await io.read(output)
  const rooms = reopened.getRoot().listNodes().map(node => node.getExtras().roomId).filter(Boolean)
  if (!expectedRooms.every(id => rooms.includes(id)) || !reopened.getRoot().listMeshes().length)
    throw new Error('최적화 결과에서 방 또는 모델이 사라졌습니다.')
}
