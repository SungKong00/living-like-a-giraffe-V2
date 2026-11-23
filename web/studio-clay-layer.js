import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import {
  clayField,
  clayFor,
  clayPositions,
  isOriginalClay,
} from './clay-field.js'

// Applies the clay look to every object in the editing scene. Each object's
// meshes get their own geometry the first time they are deformed; the look is
// always recomputed from the original vertices, so changes never accumulate.
// Settings come from clayFor(): the object's override, else the world default.

const rightHanded = { useRightHandedSystem: true }

export function clayLayer() {
  const shaped = new Map()

  // Rest geometry of an object's meshes, expressed in the object's own space
  // so all of its parts share one continuous field.
  function prepare(id, root) {
    root.computeWorldMatrix(true)
    const toRoot = root.getWorldMatrix().clone().invert()
    const min = [Infinity, Infinity, Infinity],
      max = [-Infinity, -Infinity, -Infinity]
    const parts = root
      .getChildMeshes(false)
      .filter((m) => m.getTotalVertices() && m.getVerticesData('position'))
      .map((mesh) => {
        mesh.makeGeometryUnique()
        // Low-poly parts (a box-like bench) need vertices along their long
        // faces for dents and undulation to show. Aim for ~25cm edges.
        // Skinned meshes keep their topology: their bone weights cannot be
        // interpolated onto new vertices.
        if (!mesh.skeleton && mesh.getTotalVertices() < 4000) {
          const info = mesh.getBoundingInfo().boundingBox.extendSize
          const span = 2 * Math.max(info.x, info.y, info.z)
          const extra = Math.min(23, Math.round(span / 0.25))
          if (extra > 0) mesh.increaseVertices(extra)
        }
        const meshToRoot = mesh.computeWorldMatrix(true).multiply(toRoot)
        const rootToMesh = meshToRoot.clone().invert()
        const rest = mesh.getVerticesData('position').slice()
        const normals = mesh.getVerticesData('normal')?.slice()
        // Loaded buffers are static; replace them with updatable copies.
        mesh.setVerticesData('position', rest.slice(), true)
        if (normals) mesh.setVerticesData('normal', normals.slice(), true)
        const local = new Float32Array(rest.length)
        const p = new Vector3()
        for (let i = 0; i < rest.length; i += 3) {
          Vector3.TransformCoordinatesFromFloatsToRef(
            rest[i],
            rest[i + 1],
            rest[i + 2],
            meshToRoot,
            p,
          )
          p.toArray(local, i)
          for (let k = 0; k < 3; k++) {
            min[k] = Math.min(min[k], local[i + k])
            max[k] = Math.max(max[k], local[i + k])
          }
        }
        const indices = mesh.getIndices()
        const baseline = normals && new Float32Array(normals.length)
        if (normals)
          VertexData.ComputeNormals(rest, indices, baseline, rightHanded)
        return { mesh, rest, normals, baseline, local, rootToMesh, indices }
      })
    return {
      root,
      parts,
      field: clayField({ min, max }, id),
      key: null,
    }
  }

  function shape(entry, settings) {
    const key = JSON.stringify(settings)
    if (entry.key === key) return
    entry.key = key
    const back = new Vector3()
    for (const part of entry.parts) {
      const { mesh, rest, normals, baseline, local, rootToMesh, indices } = part
      if (isOriginalClay(settings)) {
        mesh.updateVerticesData('position', rest, true)
        if (normals) mesh.updateVerticesData('normal', normals)
        continue
      }
      const moved = clayPositions(local, entry.field, settings)
      for (let i = 0; i < moved.length; i += 3) {
        Vector3.TransformCoordinatesFromFloatsToRef(
          moved[i],
          moved[i + 1],
          moved[i + 2],
          rootToMesh,
          back,
        )
        back.toArray(moved, i)
      }
      mesh.updateVerticesData('position', moved, true)
      if (!normals) continue
      // Add only the change in surface direction to the original normals,
      // which keeps the model's bevel shading.
      const next = new Float32Array(normals.length)
      VertexData.ComputeNormals(moved, indices, next, rightHanded)
      for (let i = 0; i < normals.length; i += 3) {
        const dot =
          normals[i] * baseline[i] +
          normals[i + 1] * baseline[i + 1] +
          normals[i + 2] * baseline[i + 2]
        const sign = dot < 0 ? -1 : 1
        back
          .set(
            normals[i] + sign * (next[i] - baseline[i]),
            normals[i + 1] + sign * (next[i + 1] - baseline[i + 1]),
            normals[i + 2] + sign * (next[i + 2] - baseline[i + 2]),
          )
          .normalize()
          .toArray(next, i)
      }
      mesh.updateVerticesData('normal', next)
    }
  }

  return Object.freeze({
    /** `objects` maps object id → its root node in the scene. */
    update(layout, objects) {
      for (const [id, entry] of shaped)
        if (objects.get(id) !== entry.root || entry.root.isDisposed())
          shaped.delete(id)
      for (const [id, root] of objects) {
        if (!root) continue
        const settings = clayFor(layout, id)
        let entry = shaped.get(id)
        // Shared geometry stays shared until an object first needs clay.
        if (!entry && isOriginalClay(settings)) continue
        if (!entry) shaped.set(id, (entry = prepare(id, root)))
        shape(entry, settings)
      }
    },
  })
}
