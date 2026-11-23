import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { blender } from './blender.mjs'
import { catalog, modelDir } from './world-files.mjs'
import { optimizeEditor } from '../world/optimize.mjs'

// Source model IDs are immutable. A versioned filename also upgrades older
// stores on first use without replacing their Blender source or public model.
const recipe = createHash('sha256')
for (const input of [
  'bake.py',
  'model.py',
  'worker.py',
  'studio_lighting.py',
  'light_field.py',
  'optimize.mjs',
  'requirements.txt',
  '../package-lock.json',
]) {
  recipe.update(fs.readFileSync(new URL('../world/' + input, import.meta.url)))
}
const filename = 'studio-' + recipe.digest('hex') + '.glb'
export const studioFile = (model) => path.join(modelDir(model), filename)
export async function buildStudioAsset(model) {
  const output = studioFile(model)
  if (fs.existsSync(output)) return output
  const dir = modelDir(model)
  const work = fs.mkdtempSync(path.join(dir, 'studio-'))
  try {
    await blender('studio', path.join(dir, 'source.blend'), work)
    await optimizeEditor(
      path.join(work, 'raw.glb'),
      output,
      catalog(model).rooms.map((r) => r.id),
    )
    return output
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
}
