import fs from 'node:fs'
import path from 'node:path'
import { blender } from './blender.mjs'
export function writeSceneInput(snapshot, dir) {
  const input = path.join(dir, 'input.json')
  const { items, lights, sourceLights } = snapshot.layout
  fs.writeFileSync(
    input,
    JSON.stringify({ items, lights, sourceLights, handoff: snapshot.id }),
  )
  return input
}
export async function exportHandoff(snapshot, source, dir) {
  fs.mkdirSync(dir, { recursive: true })
  await blender('download', source, dir, writeSceneInput(snapshot, dir))
  return path.join(dir, 'world.blend')
}
