import fs from 'node:fs'
import path from 'node:path'
import { blender } from './blender.mjs'
import { catalog, modelDir, put } from './world-files.mjs'

// An existing installation can keep its immutable .blend files, drafts and URLs.
// Upgrade only the derived inventory, replacing it after a successful inspection.
export async function ensureSourceCatalog(model) {
  const dir = modelDir(model)
  if (
    fs.existsSync(path.join(dir, 'catalog.json')) &&
    Array.isArray(catalog(model).sourceLights)
  )
    return
  const temp = fs.mkdtempSync(path.join(dir, 'inventory-'))
  try {
    await blender('inspect', path.join(dir, 'source.blend'), temp)
    put(
      path.join(dir, 'catalog.json'),
      JSON.parse(fs.readFileSync(path.join(temp, 'catalog.json'))),
    )
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
}
