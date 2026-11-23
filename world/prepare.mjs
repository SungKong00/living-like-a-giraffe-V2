import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { buildStudioAsset } from '../server/studio-asset.mjs'
import { modelDir, catalog } from '../server/world-files.mjs'
import { buildVisitorAsset } from '../server/visitor-asset.mjs'
import { ensureSourceCatalog } from '../server/model-catalog.mjs'
import { seed } from '../server/layout.mjs'
const dir = modelDir('initial')
mkdirSync(dir, { recursive: true })
if (!existsSync(dir + '/source.blend'))
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
await ensureSourceCatalog('initial')
const model = catalog('initial')
await buildStudioAsset('initial')
await buildVisitorAsset({
  id: 'initial',
  model: 'initial',
  layout: seed(model),
})
