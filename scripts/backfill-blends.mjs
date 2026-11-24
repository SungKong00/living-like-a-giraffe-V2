// Materialize downloadable project files for releases made before helper protocol 2.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { exportHandoff } from '../server/blend-handoff.mjs'
const target = process.argv.slice(2)
if (!['--remote', '--local'].includes(target[0]))
  throw Error('--remote 또는 --local을 지정하세요.')
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-backfill-'))
const run = (...args) =>
  execFileSync(
    'npx',
    [
      '--yes',
      'wrangler@4',
      'd1',
      'execute',
      'giraffe-studio',
      ...target,
      ...args,
      '--json',
    ],
    { maxBuffer: 128 * 1024 * 1024, encoding: 'utf8' },
  )
const rows = (sql) => JSON.parse(run('--command', sql))[0].results
try {
  const state = JSON.parse(rows('SELECT data FROM world WHERE id=1')[0].data)
  const snapshots = [state.published, state.previous]
  if (
    state.job?.status === '검토 가능' &&
    state.job.revision === state.draft.id &&
    !state.job.blend
  )
    snapshots.push(state.draft)
  for (const snap of snapshots.filter(Boolean)) {
    if (snap.blend) continue
    if (
      !/^[a-f0-9-]{36}$/.test(snap.id) ||
      !/^(initial|[a-f0-9-]{36})$/.test(snap.model)
    )
      throw Error('개정 ID 확인 필요')
    const name = 'legacy/' + snap.id
    if (rows("SELECT 1 FROM files WHERE name='" + name + "' LIMIT 1").length)
      continue
    const parts = rows(
      "SELECT content FROM files WHERE name='source/" +
        snap.model +
        "' ORDER BY part",
    )
    if (!parts.length) throw Error('원본 파일을 찾을 수 없습니다.')
    const source = path.join(work, 'source.blend')
    fs.writeFileSync(
      source,
      Buffer.concat(parts.map((p) => Buffer.from(p.content, 'base64'))),
    )
    const bytes = fs.readFileSync(await exportHandoff(snap, source, work))
    const sql = []
    for (let pos = 0; pos < bytes.length; pos += 32768)
      sql.push(
        "INSERT OR IGNORE INTO files VALUES ('" +
          name +
          "'," +
          pos / 32768 +
          ",'" +
          bytes.subarray(pos, pos + 32768).toString('base64') +
          "');",
      )
    const file = path.join(work, 'handoff.sql')
    fs.writeFileSync(file, sql.join('\n'))
    run('--file', file)
    console.log(snap.id.slice(0, 8) + ' Blender 파일 준비 완료')
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true })
}
