import { mat4, vec3, quat } from 'gl-matrix'
import { EXTMeshGPUInstancing } from '@gltf-transform/extensions'

// dedup() has already compared final geometry, textures, UV sets and materials.
// Group only decomposable, opaque draws within the same visibility boundary.
export function batchRoomCopies(doc) {
  const buffer = doc.getRoot().listBuffers()[0]
  let extension
  for (const room of doc
    .getRoot()
    .listNodes()
    .filter((n) => n.getExtras().roomId)) {
    const inverse = mat4.invert(mat4.create(), room.getWorldMatrix())
    if (!inverse) continue
    const groups = new Map()
    room.traverse((node) => {
      const mesh = node.getMesh()
      if (
        !mesh ||
        node.getSkin() ||
        node.getExtension('EXT_mesh_gpu_instancing')
      )
        return
      if (
        mesh
          .listPrimitives()
          .some(
            (p) =>
              p.listTargets().length ||
              p.getMaterial()?.getAlphaMode() !== 'OPAQUE' ||
              p.getMaterial()?.getExtension('KHR_materials_transmission'),
          )
      )
        return
      const local = mat4.multiply(mat4.create(), inverse, node.getWorldMatrix())
      if (mat4.determinant(local) <= 0) return
      const t = mat4.getTranslation(vec3.create(), local),
        s = mat4.getScaling(vec3.create(), local),
        r = mat4.getRotation(quat.create(), local)
      const rebuilt = mat4.fromRotationTranslationScale(mat4.create(), r, t, s)
      if (!mat4.equals(rebuilt, local)) return
      if (!groups.has(mesh)) groups.set(mesh, [])
      groups.get(mesh).push({ node, t, r, s })
    })
    for (const [mesh, rows] of groups) {
      if (rows.length < 2) continue
      extension ??= doc.createExtension(EXTMeshGPUInstancing).setRequired(true)
      const batch = extension.createInstancedMesh()
      for (const [semantic, field, type] of [
        ['TRANSLATION', 't', 'VEC3'],
        ['ROTATION', 'r', 'VEC4'],
        ['SCALE', 's', 'VEC3'],
      ]) {
        const values = rows.flatMap((row) => Array.from(row[field]))
        batch.setAttribute(
          semantic,
          doc
            .createAccessor()
            .setBuffer(buffer)
            .setType(type)
            .setArray(new Float32Array(values)),
        )
      }
      room.addChild(
        doc
          .createNode()
          .setMesh(mesh)
          .setExtension('EXT_mesh_gpu_instancing', batch),
      )
      for (const { node } of rows) node.setMesh(null)
    }
  }
}
