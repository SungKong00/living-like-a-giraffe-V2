import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { optimizeEditor } from './optimize.mjs'
import { modelDir, catalog } from '../server/world-files.mjs'
import { buildVisitorAsset } from '../server/visitor-asset.mjs'
import { seed } from '../server/layout.mjs'
const dir = modelDir('initial')
mkdirSync(dir, { recursive: true })
if (!existsSync(dir + '/source.blend') || !existsSync(dir + '/raw.glb'))
  execFileSync(
    '.venv/bin/python',
    [
      'world/worker.py',
      'bootstrap',
      'assets-source/riragi-v06/full/riraji_full.blend',
      dir,
    ],
    { stdio: 'inherit' },
  )
const model = catalog('initial')
await optimizeEditor(
  dir + '/raw.glb',
  dir + '/editor.glb',
  model.rooms.map((r) => r.id),
)
await buildVisitorAsset({
  id: 'initial',
  model: 'initial',
  layout: seed(model),
})
