// Generate an initial D1 import from a prepared local world. Only the password digest leaves this machine.
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import {
  root,
  buildDir,
  modelDir,
  versionFile,
  json,
  catalog,
} from '../server/world-files.mjs'
import { buildStudioAsset } from '../server/studio-asset.mjs'
import { characterLibrary } from '../server/characters.mjs'
const {
  draft,
  published,
  previous,
  versions = [],
  editDay,
} = json(path.join(root, 'state.json'))
const keyFile = path.join(root, 'cloud-editor-key')
if (!fs.existsSync(keyFile))
  fs.writeFileSync(keyFile, randomBytes(24).toString('base64url') + '\n', {
    flag: 'wx',
    mode: 0o600,
  })
const key = fs.readFileSync(keyFile, 'utf8').trim()
const out = [
  fs.readFileSync(new URL('../cloud/schema.sql', import.meta.url), 'utf8'),
]
const quote = (value) => "'" + String(value).replaceAll("'", "''") + "'"
function insert(table, values) {
  out.push(
    'INSERT OR IGNORE INTO ' +
      table +
      ' VALUES (' +
      values.map(quote).join(',') +
      ');',
  )
}
function file(name, bytes) {
  for (let start = 0, part = 0; start < bytes.length; start += 32768, part++)
    insert('files', [
      name,
      part,
      bytes.subarray(start, start + 32768).toString('base64'),
    ])
}
insert('settings', ['key', createHash('sha256').update(key).digest('hex')])
for (const model of new Set(
  [
    draft.model,
    published.model,
    previous?.model,
    ...versions.map((v) => v.model),
  ].filter(Boolean),
)) {
  insert('settings', ['catalog/' + model, JSON.stringify(catalog(model))])
  file(
    'source/' + model,
    fs.readFileSync(path.join(modelDir(model), 'source.blend')),
  )
  file('editor/' + model, fs.readFileSync(await buildStudioAsset(model)))
}
for (const key of new Set([published.asset, previous?.asset].filter(Boolean))) {
  file('baked/' + key, fs.readFileSync(path.join(buildDir(key), 'world.glb')))
}
const library = characterLibrary()
const listing = await library.list()
insert('settings', ['characters', JSON.stringify(listing)])
for (const id of new Set(
  [
    ...listing.models.map((m) => m.file),
    ...listing.motions.map((m) => (m.model ? null : m.id)),
  ].filter(Boolean),
))
  file('character/' + id + '.glb', fs.readFileSync(library.file(id)))
// Preserve local ordering when several checkpoints share a timestamp.
for (const entry of versions.toReversed()) {
  const { id, kind, title, createdAt, revision, model } = entry
  insert('draft_versions', [
    id,
    kind,
    title,
    createdAt,
    revision,
    model,
    JSON.stringify(json(versionFile(revision)).layout),
  ])
}
insert('world', [
  1,
  0,
  JSON.stringify({ draft, published, previous, editDay, job: null }),
])
fs.writeFileSync(path.join(root, 'cloud-seed.sql'), out.join('\n'), {
  mode: 0o600,
})
