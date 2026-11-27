import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { renderEditor } from './render-editor.mjs'
import { catalog, modelDir } from './world-files.mjs'

// Source model IDs are immutable. A versioned filename also upgrades older
// stores on first use without replacing their Blender source or public model.
const recipe = createHash('sha256')
for (const input of [
  'bake.py',
  'surfaces.py',
  'model.py',
  'source_lights.py',
  'worker.py',
  'studio_lighting.py',
  'light_field.py',
  'optimize.mjs',
  'requirements.txt',
  '../server/blender.mjs',
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
    await renderEditor(
      path.join(dir, 'source.blend'),
      work,
      output,
      catalog(model).rooms.map((r) => r.id),
    )
    return output
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
}
