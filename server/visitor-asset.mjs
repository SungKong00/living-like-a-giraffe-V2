import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { buildDir, catalog, modelDir, put } from './world-files.mjs'
import { blender } from './blender.mjs'
import { optimizeVisitor } from '../world/optimize.mjs'

// Change the recipe when bake, display conversion or optimization output changes.
const recipe = 'cycles-display-srgb-v4'
export function assetKey({ model, layout }) {
  return createHash('sha256')
    .update(JSON.stringify([recipe, model, layout.items]))
    .digest('hex')
}

export function initialAsset(draft) {
  const key = assetKey(draft)
  if (fs.existsSync(path.join(buildDir(key), 'world.glb'))) return key
  // Stores prepared by v3 have a public immutable URL named "initial".
  if (fs.existsSync(path.join(buildDir('initial'), 'world.glb')))
    return 'initial'
  throw Error('npm run prepare:world를 먼저 실행하세요.')
}

export async function buildVisitorAsset(snapshot, onStage = () => {}) {
  const key = assetKey(snapshot)
  const dir = buildDir(key)
  const output = path.join(dir, 'world.glb')
  if (fs.existsSync(output)) return key
  fs.mkdirSync(dir, { recursive: true })
  const work = fs.mkdtempSync(path.join(dir, 'work-'))
  try {
    onStage('베이크')
    const input = path.join(work, 'input.json')
    put(input, { items: snapshot.layout.items, handoff: snapshot.id })
    await blender(
      'publish',
      path.join(modelDir(snapshot.model), 'source.blend'),
      work,
      input,
    )
    onStage('최적화')
    const candidate = path.join(work, 'world.glb')
    await optimizeVisitor(
      path.join(work, 'raw.glb'),
      candidate,
      catalog(snapshot.model).rooms.map((r) => r.id),
    )
    // The first fully validated build wins, including across CLI and server processes.
    try {
      fs.linkSync(candidate, output)
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
    return key
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
}
