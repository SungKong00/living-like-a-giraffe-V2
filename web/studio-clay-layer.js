import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import { SubMesh } from '@babylonjs/core/Meshes/subMesh'
import { tessellate } from './clay-tessellate.js'
import {
  clayField,
  clayFor,
  clayPositions,
  isOriginalClay,
  surfaceField,
} from './clay-field.js'

// Applies the clay look in the editing scene to three kinds of target:
//   world    — a room's own geometry (floors, walls, fixed props)
//   objects  — one movable piece of furniture
//   giraffes — one giraffe
// Settings come from clayFor(): the target's override, else its kind's
// default. Meshes get their own geometry the first time they are deformed and
// the look is always recomputed from the original vertices, so changes never
// accumulate.

const rightHanded = { useRightHandedSystem: true }

// Splits a mesh's long edges so flat walls and benches can bend. Skinned
// meshes keep their topology: bone indices cannot be interpolated.
function densify(mesh, maxEdge) {
  const kinds = mesh.getVerticesDataKinds()
  if (mesh.skeleton || kinds.some((k) => k.startsWith('matrices'))) return
  const indices = mesh.getIndices()
  if (!indices?.length) return
  const before = mesh.getTotalVertices()
  const attributes = {}
  for (const kind of kinds) {
    const data = mesh.getVerticesData(kind)
    const buffer = mesh.getVertexBuffer(kind)
    if (data && buffer) attributes[kind] = { data, stride: buffer.getSize() }
  }
  const groups = (mesh.subMeshes ?? []).map((sm) => ({
    start: sm.indexStart,
    count: sm.indexCount,
    material: sm.materialIndex,
  }))
  const result = tessellate(
    {
      attributes,
      indices,
      groups: groups.length ? groups : [{ start: 0, count: indices.length }],
    },
    { maxEdge, budget: Math.max(before * 4, 60000) },
  )
  if (result.vertices === before) return
  const normals = result.attributes.normal
  if (normals)
    for (let i = 0; i < normals.length; i += 3) {
      const l = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1
      normals[i] /= l
      normals[i + 1] /= l
      normals[i + 2] /= l
    }
  for (const [kind, data] of Object.entries(result.attributes))
    mesh.setVerticesData(kind, data, kind === 'position' || kind === 'normal')
  mesh.setIndices(result.indices, result.vertices)
  if (groups.length > 1) {
    mesh.subMeshes = []
    result.groups.forEach(
      (g, i) =>
        new SubMesh(
          groups[i].material,
          0,
          result.vertices,
          g.start,
          g.count,
          mesh,
        ),
    )
  }
}

// Averages normals over vertices that share a position, so a dent pressed
// along the normal moves both sides of a hard edge together.
function weldedNormals(positions, normals) {
  const sums = new Map()
  const key = (i) =>
    Math.round(positions[i] * 1e4) +
    ',' +
    Math.round(positions[i + 1] * 1e4) +
    ',' +
    Math.round(positions[i + 2] * 1e4)
  for (let i = 0; i < positions.length; i += 3) {
    const k = key(i)
    const sum = sums.get(k) ?? [0, 0, 0]
    sum[0] += normals[i]
    sum[1] += normals[i + 1]
    sum[2] += normals[i + 2]
    sums.set(k, sum)
  }
  const out = new Float32Array(normals.length)
  for (let i = 0; i < positions.length; i += 3) {
    const [x, y, z] = sums.get(key(i))
    const l = Math.hypot(x, y, z) || 1
    out[i] = x / l
    out[i + 1] = y / l
    out[i + 2] = z / l
  }
  return out
}

export function clayLayer() {
  const shaped = new Map()

  // Rest geometry of the target's meshes in the target's own space, so all
  // of its parts share one continuous field.
  function prepare(target) {
    const { id, root, scope } = target
    root.computeWorldMatrix(true)
    const toRoot = root.getWorldMatrix().clone().invert()
    const min = [Infinity, Infinity, Infinity],
      max = [-Infinity, -Infinity, -Infinity]
    const room = scope === 'world'
    const parts = target
      .meshes()
      .filter((m) => m.getTotalVertices() && m.getVerticesData('position'))
      .map((mesh) => {
        mesh.makeGeometryUnique()
        const meshToRoot = mesh.computeWorldMatrix(true).multiply(toRoot)
        const rootToMesh = meshToRoot.clone().invert()
        // Long flat faces need vertices for dents and undulation to show.
        // Edge length is in metres even when the mesh is stored quantized.
        const unit = Math.max(
          ...[0, 1, 2].map((axis) =>
            Vector3.TransformNormal(
              new Vector3(+(axis === 0), +(axis === 1), +(axis === 2)),
              meshToRoot,
            ).length(),
          ),
        )
        densify(mesh, (room ? 0.3 : 0.18) / unit)
        const rest = mesh.getVerticesData('position').slice()
        const normals = mesh.getVerticesData('normal')?.slice()
        // Loaded buffers are static; replace them with updatable copies.
        mesh.setVerticesData('position', rest.slice(), true)
        if (normals) mesh.setVerticesData('normal', normals.slice(), true)
        const local = new Float32Array(rest.length)
        const localNormals = room && normals && new Float32Array(rest.length)
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
          if (localNormals) {
            Vector3.TransformNormalFromFloatsToRef(
              normals[i],
              normals[i + 1],
              normals[i + 2],
              meshToRoot,
              p,
            )
            p.normalize().toArray(localNormals, i)
          }
        }
        if (localNormals) localNormals.set(weldedNormals(local, localNormals))
        const indices = mesh.getIndices()
        const baseline = normals && new Float32Array(normals.length)
        if (normals)
          VertexData.ComputeNormals(rest, indices, baseline, rightHanded)
        return {
          mesh,
          rest,
          normals,
          baseline,
          local,
          localNormals,
          rootToMesh,
          indices,
        }
      })
    return {
      root,
      parts,
      field: room ? surfaceField(id) : clayField({ min, max }, id, scope),
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
      const moved = clayPositions(
        local,
        entry.field,
        settings,
        part.localNormals,
      )
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
    /**
     * `targets`: `[{ id, scope, root, meshes() }]`. `meshes()` lists the
     * meshes that belong to the target and is read once, when it first needs
     * clay. Pass `skip` (a set of scopes) to leave those targets as they are,
     * e.g. rooms while a slider is still moving.
     */
    update(layout, targets, { skip } = {}) {
      const byId = new Map(targets.map((t) => [t.id, t]))
      for (const [id, entry] of shaped)
        if (byId.get(id)?.root !== entry.root || entry.root.isDisposed())
          shaped.delete(id)
      for (const target of targets) {
        if (!target.root || skip?.has(target.scope)) continue
        const settings = clayFor(layout, target.id, target.scope)
        let entry = shaped.get(target.id)
        // Shared geometry stays shared until a target first needs clay.
        if (!entry && isOriginalClay(settings)) continue
        if (!entry) shaped.set(target.id, (entry = prepare(target)))
        shape(entry, settings)
      }
    },
  })
}
