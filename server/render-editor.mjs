import path from 'node:path'
import { blender } from './blender.mjs'
import { optimizeEditor } from '../world/optimize.mjs'

export async function renderEditor(source, work, output, rooms, onBakePercent) {
  await blender('studio', source, work, undefined, undefined, onBakePercent)
  await optimizeEditor(path.join(work, 'raw.glb'), output, rooms, onBakePercent)
}
