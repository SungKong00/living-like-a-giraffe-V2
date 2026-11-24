import { writeSceneInput } from './blend-handoff.mjs'
import path from 'node:path'
import { blender } from './blender.mjs'
import { optimizeVisitor } from '../world/optimize.mjs'

export async function renderVisitor(
  snapshot,
  source,
  rooms,
  work,
  onStage,
  signal,
  withHandoff = false,
) {
  onStage('베이크')
  const input = writeSceneInput(snapshot, work)
  await blender(
    withHandoff ? 'publish-handoff' : 'publish',
    source,
    work,
    input,
    signal,
    (percent) => onStage('베이크', percent),
  )
  signal?.throwIfAborted()
  onStage('최적화')
  const candidate = path.join(work, 'world.glb')
  await optimizeVisitor(path.join(work, 'raw.glb'), candidate, rooms)
  signal?.throwIfAborted()
  return candidate
}
