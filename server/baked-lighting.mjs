import fs from 'node:fs'
import path from 'node:path'
import { assetKey, buildVisitorAsset } from './visitor-asset.mjs'
import { buildDir } from './world-files.mjs'

export function cachedLighting(snapshot) {
  const key = assetKey(snapshot)
  return fs.existsSync(path.join(buildDir(key), 'world.glb')) ? key : null
}
export const bakeLighting = buildVisitorAsset
