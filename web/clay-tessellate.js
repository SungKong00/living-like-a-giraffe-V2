// Adds vertices to long, flat surfaces so the clay field has something to
// move. An edge is split exactly when it is longer than `maxEdge`, decided
// per edge rather than per triangle, so two triangles that share an edge
// always split it at the same new vertex and the surface never cracks.
// Every vertex attribute (normals, texture and lightmap coordinates, colours)
// is interpolated at the midpoint. Pure arrays in, pure arrays out.

/**
 * `attributes`: `{ kind: { data, stride } }` including `position` (stride 3).
 * `groups`: index ranges `[{ start, count }]` (sub-meshes); each keeps its own
 * range in the result. Stops when no edge is longer than `maxEdge`, after
 * `rounds` passes, or once `budget` vertices exist.
 */
export function tessellate(
  { attributes, indices, groups },
  { maxEdge, rounds = 6, budget = 250000 },
) {
  const kinds = Object.keys(attributes)
  const data = Object.fromEntries(
    kinds.map((k) => [k, Array.from(attributes[k].data)]),
  )
  const stride = Object.fromEntries(kinds.map((k) => [k, attributes[k].stride]))
  const position = data.position
  let count = position.length / 3
  const limit = maxEdge * maxEdge
  const long = (a, b) =>
    (position[a * 3] - position[b * 3]) ** 2 +
      (position[a * 3 + 1] - position[b * 3 + 1]) ** 2 +
      (position[a * 3 + 2] - position[b * 3 + 2]) ** 2 >
    limit

  let ranges = groups.map(({ start, count: n }) =>
    Array.from(indices.slice(start, start + n)),
  )
  for (let round = 0; round < rounds; round++) {
    const middle = new Map()
    let split = false
    const mid = (a, b) => {
      const key = a < b ? a + ':' + b : b + ':' + a
      let m = middle.get(key)
      if (m !== undefined) return m
      m = count++
      for (const k of kinds) {
        const s = stride[k],
          d = data[k]
        for (let c = 0; c < s; c++) d.push((d[a * s + c] + d[b * s + c]) / 2)
      }
      middle.set(key, m)
      return m
    }
    ranges = ranges.map((tris) => {
      const next = []
      for (let t = 0; t < tris.length; t += 3) {
        const v = [tris[t], tris[t + 1], tris[t + 2]]
        const cut = [0, 1, 2].map((e) =>
          count < budget && long(v[e], v[(e + 1) % 3])
            ? mid(v[e], v[(e + 1) % 3])
            : -1,
        )
        const n = cut.filter((m) => m >= 0).length
        if (!n) {
          next.push(v[0], v[1], v[2])
          continue
        }
        split = true
        if (n === 3) {
          const [ab, bc, ca] = cut
          next.push(v[0], ab, ca, ab, v[1], bc, ca, bc, v[2], ab, bc, ca)
          continue
        }
        // Rotate so the first split edge starts at v0, keeping winding.
        let r = cut.findIndex((m) => m >= 0)
        if (n === 2 && cut[(r + 2) % 3] >= 0) r = (r + 2) % 3
        const a = v[r],
          b = v[(r + 1) % 3],
          c = v[(r + 2) % 3]
        const ab = cut[r],
          bc = cut[(r + 1) % 3]
        if (n === 1) next.push(a, ab, c, ab, b, c)
        else next.push(a, ab, c, ab, b, bc, ab, bc, c)
      }
      return next
    })
    if (!split || count >= budget) break
  }
  const out = {}
  for (const k of kinds) out[k] = new Float32Array(data[k])
  const all = []
  const nextGroups = ranges.map((tris) => {
    const start = all.length
    // Index lists can hold millions of entries: copy without spreading.
    for (let i = 0; i < tris.length; i++) all.push(tris[i])
    return { start, count: tris.length }
  })
  return {
    attributes: out,
    indices: count > 65535 ? new Uint32Array(all) : new Uint16Array(all),
    groups: nextGroups,
    vertices: count,
  }
}
