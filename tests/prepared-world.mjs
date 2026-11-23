import fs from 'node:fs'
import path from 'node:path'
import { seed } from '../server/layout.mjs'
import { assetKey } from '../server/visitor-asset.mjs'

export function copyPreparedWorld(dir) {
  const source = '.world/models/initial'
  fs.cpSync(source, path.join(dir, 'models/initial'), { recursive: true })
  const model = JSON.parse(fs.readFileSync(path.join(source, 'catalog.json')))
  const key = assetKey({ model: 'initial', layout: seed(model) })
  fs.cpSync(path.join('.world/builds', key), path.join(dir, 'builds', key), {
    recursive: true,
  })
}
