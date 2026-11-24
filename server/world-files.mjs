import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export const root = path.resolve(process.env.RIRAGI_DATA || '.world')
export function json(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}
export function put(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.' + randomUUID()
  fs.writeFileSync(tmp, JSON.stringify(value))
  fs.renameSync(tmp, file)
}
export const modelDir = (model) => path.join(root, 'models', model)
export const versionFile = (revision) =>
  path.join(root, 'versions', revision + '.json')
export const buildDir = (key) => path.join(root, 'builds', key)
export const catalog = (model) =>
  json(path.join(modelDir(model), 'catalog.json'))
