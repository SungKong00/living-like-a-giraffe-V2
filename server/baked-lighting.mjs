import fs from 'node:fs'
import path from 'node:path'
import { assetKey, buildVisitorAsset } from './visitor-asset.mjs'
import { buildDir, json, put, root } from './world-files.mjs'

// Labels and list order are editor metadata. IDs, room, transform and all
// appearance options still participate, as do the source model and bake recipe.
function indexFile(snapshot) {
  const items = snapshot.layout.items
    .map(({ label, ...rendered }) => rendered)
    .sort((a, b) => a.id.localeCompare(b.id))
  return path.join(
    root,
    'lighting-index',
    assetKey({ model: snapshot.model, layout: { items } }) + '.json',
  )
}
const exists = (key) => fs.existsSync(path.join(buildDir(key), 'world.glb'))

export function cachedLighting(snapshot) {
  const file = indexFile(snapshot)
  if (fs.existsSync(file)) {
    const key = json(file)
    if (exists(key)) return key
  }
  // Discover builds made before the appearance index was introduced.
  const exact = assetKey(snapshot)
  if (!exists(exact)) return null
  put(file, exact)
  return exact
}

export async function bakeLighting(snapshot, onStage) {
  const cached = cachedLighting(snapshot)
  if (cached) return cached
  const key = await buildVisitorAsset(snapshot, onStage)
  put(indexFile(snapshot), key)
  return key
}
