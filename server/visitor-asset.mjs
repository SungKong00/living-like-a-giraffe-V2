import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { buildDir, catalog, modelDir, put } from './world-files.mjs'
import { lightingInput } from '../shared/lighting-input.mjs'
import { blender } from './blender.mjs'
import { optimizeVisitor } from '../world/optimize.mjs'

// Derive the pipeline version from the actual worker, optimizer and dependencies.
// Updating Blender code cannot silently reuse an older immutable visitor file.
function pipelineFingerprint() {
  const world = new URL('../world/', import.meta.url)
  const inputs = fs
    .readdirSync(world)
    .filter((name) => /\.(py|mjs)$/.test(name) || name === 'requirements.txt')
    .sort()
    .map((name) => new URL(name, world))
  inputs.push(
    new URL(import.meta.url),
    new URL('./blender.mjs', import.meta.url),
    new URL('../package-lock.json', import.meta.url),
  )
  const hash = createHash('sha256')
  for (const file of inputs) {
    hash.update(path.basename(file.pathname)).update('\0')
    hash.update(createHash('sha256').update(fs.readFileSync(file)).digest())
  }
  return hash.digest('hex')
}
const recipe = pipelineFingerprint()
export function assetKey({ model, layout }) {
  return createHash('sha256')
    .update(JSON.stringify([recipe, model, ...lightingInput(layout)]))
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

export async function buildVisitorAsset(snapshot, onStage = () => {}, signal) {
  const key = assetKey(snapshot)
  const dir = buildDir(key)
  const output = path.join(dir, 'world.glb')
  if (fs.existsSync(output)) return key
  fs.mkdirSync(dir, { recursive: true })
  const work = fs.mkdtempSync(path.join(dir, 'work-'))
  try {
    onStage('베이크')
    const input = path.join(work, 'input.json')
    put(input, {
      items: snapshot.layout.items,
      lights: snapshot.layout.lights,
      sourceLights: snapshot.layout.sourceLights,
      handoff: snapshot.id,
    })
    await blender(
      'publish',
      path.join(modelDir(snapshot.model), 'source.blend'),
      work,
      input,
      signal,
    )
    signal?.throwIfAborted()
    onStage('최적화')
    const candidate = path.join(work, 'world.glb')
    await optimizeVisitor(
      path.join(work, 'raw.glb'),
      candidate,
      catalog(snapshot.model).rooms.map((r) => r.id),
    )
    signal?.throwIfAborted()
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
