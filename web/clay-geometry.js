import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import { NodeGeometry } from '@babylonjs/core/Meshes/Node/nodeGeometry'
import { GeometryInputBlock } from '@babylonjs/core/Meshes/Node/Blocks/geometryInputBlock'
import { GeometryInterceptorBlock } from '@babylonjs/core/Meshes/Node/Blocks/geometryInterceptorBlock'
import { GeometryOutputBlock } from '@babylonjs/core/Meshes/Node/Blocks/geometryOutputBlock'
import { NoiseBlock } from '@babylonjs/core/Meshes/Node/Blocks/noiseBlock'
import { SetPositionsBlock } from '@babylonjs/core/Meshes/Node/Blocks/Set/setPositionsBlock'
import { NodeGeometryBlockConnectionPointTypes as Type } from '@babylonjs/core/Meshes/Node/Enums/nodeGeometryConnectionPointTypes'
import { NodeGeometryContextualSources as Context } from '@babylonjs/core/Meshes/Node/Enums/nodeGeometryContextualSources'

export const presets = {
  original: { strength: 0, depth: 0, width: 50 },
  light: { strength: 28, depth: 24, width: 50 },
  medium: { strength: 58, depth: 55, width: 50 },
  strong: { strength: 94, depth: 90, width: 50 },
}

// Fixed press centres in the rest model's metres. Both sides of each joint
// sample the same continuous field, including the giraffe's fitted cape.
const presses = {
  bench: [
    [0.46, -2.35],
    [-0.46, -1.35],
    [0.41, -0.25],
    [-0.56, 0.85],
    [0.53, 2.06],
    [-0.48, 2.83],
  ],
  giraffe: [
    [-0.72, 1.47],
    [-0.25, 1.22],
    [0.14, 1.55],
    [0.52, 1.8],
    [0.66, 2.23],
    [0.68, 2.64],
    [1.04, 2.98],
  ],
}
const axisOffsets = [
  new Vector3(2, 3, 7),
  new Vector3(8, 1, 3),
  new Vector3(5, 9, 2),
]

export function clayDeformer(mesh, kind) {
  const graph = new NodeGeometry('점토 조형')
  const source = new GeometryInputBlock('원본', Type.Geometry)
  const data = new VertexData()
  const rest = mesh.getVerticesData('position').slice()
  const normals = mesh.getVerticesData('normal').slice()
  data.positions = rest
  source.value = data
  const positions = new GeometryInputBlock('원본 좌표', Type.Vector3)
  positions.contextualValue = Context.Positions
  const warp = new GeometryInterceptorBlock('손으로 누르고 빚기')
  const noise = new NoiseBlock('완만한 굴곡')
  const set = new SetPositionsBlock('변형 위치')
  const out = new GeometryOutputBlock('결과')
  positions.output.connectTo(warp.input)
  warp.output.connectTo(set.positions)
  source.output.connectTo(set.geometry)
  set.output.connectTo(out.geometry)
  graph.outputBlock = out
  const indices = mesh.getIndices()
  const baseline = new Float32Array(normals.length)
  const nextNormals = new Float32Array(normals.length)
  const rightHanded = { useRightHandedSystem: true }
  VertexData.ComputeNormals(rest, indices, baseline, rightHanded)
  const bench = kind === 'bench'
  const result = new Vector3()

  return {
    apply({ strength, depth, width }) {
      if (strength === 0 && depth === 0) {
        mesh.updateVerticesData('position', rest, true)
        mesh.updateVerticesData('normal', normals)
        return
      }
      const radius = (bench ? 0.54 : 0.31) * (0.55 + width / 100)
      // Wide, low-frequency warps keep thin parts and facial features legible.
      const freq = 0.44 / radius
      const amplitude = (strength / 100) * (bench ? 0.19 : 0.2)
      const pressure = (depth / 100) * (bench ? 0.19 : 0.21)
      warp.customFunction = (p) => {
        const grounded = Math.max(0, p.y) / (Math.max(0, p.y) + 0.18)
        // Ease off above the cheeks so the expression and ear fittings stay aligned.
        const head = Math.min(1, Math.max(0, (3.23 - p.y) / 0.3))
        const h = grounded * (bench ? 1 : head * head * (3 - 2 * head))
        const sample = (offset) =>
          (noise.noise(0, 0, p, offset, freq) - 0.5) * 2
        let dent = 0
        for (const [a, b] of presses[kind]) {
          const u = ((bench ? p.x : p.z) - a) / radius
          const v = ((bench ? p.z : p.y) - b) / (radius * 0.82)
          dent += Math.exp(-1.7 * (u * u + v * v))
        }
        const press = dent * pressure
        result.set(
          p.x +
            (amplitude * sample(axisOffsets[0]) -
              (bench ? 0 : Math.tanh(5 * p.x) * press)) *
              h,
          p.y + (amplitude * sample(axisOffsets[1]) - (bench ? press : 0)) * h,
          p.z + amplitude * sample(axisOffsets[2]) * h,
        )
        return result
      }
      graph.build()
      const next = graph.vertexData.positions
      VertexData.ComputeNormals(next, indices, nextNormals, rightHanded)
      // Transfer the change in surface normal to the original bevel shading.
      for (let i = 0; i < normals.length; i += 3) {
        const dot =
          normals[i] * baseline[i] +
          normals[i + 1] * baseline[i + 1] +
          normals[i + 2] * baseline[i + 2]
        const sign = dot < 0 ? -1 : 1
        result
          .set(
            normals[i] + sign * (nextNormals[i] - baseline[i]),
            normals[i + 1] + sign * (nextNormals[i + 1] - baseline[i + 1]),
            normals[i + 2] + sign * (nextNormals[i + 2] - baseline[i + 2]),
          )
          .normalize()
          .toArray(nextNormals, i)
      }
      mesh.updateVerticesData('position', next, true)
      mesh.updateVerticesData('normal', nextNormals)
    },
    dispose() {
      graph.dispose()
      noise.dispose()
    },
  }
}
