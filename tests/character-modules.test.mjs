import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

// web/characters/ is entered through its index.js only (ADR 0006), so its
// parts can change without their users noticing.
const root = path.resolve(import.meta.dirname, '..')
const inside = path.join(root, 'web', 'characters')
const entry = path.join(inside, 'index.js')

function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
    const file = path.join(dir, item.name)
    if (item.isDirectory()) return file === inside ? [] : sources(file)
    return /\.m?js$/.test(item.name) ? [file] : []
  })
}

/** Files of web/characters/ other than index.js that `file` imports. */
export function reachesInside(file, text) {
  const found = []
  for (const [, target] of text.matchAll(
    /(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+)['"]/g,
  )) {
    const resolved = path.resolve(path.dirname(file), target)
    if (resolved.startsWith(inside + path.sep) && resolved !== entry)
      found.push(path.relative(root, resolved))
  }
  return found
}

test('캐릭터 모듈은 index.js로만 들어간다', () => {
  const outside = ['web', 'tests'].flatMap((dir) =>
    sources(path.join(root, dir)),
  )
  assert.ok(outside.some((file) => file.endsWith('visitor-characters.js')))
  const broken = outside.flatMap((file) =>
    reachesInside(file, fs.readFileSync(file, 'utf8')).map(
      (target) => path.relative(root, file) + ' → ' + target,
    ),
  )
  assert.deepEqual(broken, [])
})

test('경계 검사가 안쪽 파일을 가져오는 코드를 잡는다', () => {
  const file = path.join(root, 'web', 'studio.js')
  assert.deepEqual(
    reachesInside(file, "import { x } from './characters/cast.js'"),
    ['web/characters/cast.js'],
  )
  assert.deepEqual(
    reachesInside(file, "await import('./characters/policy.js')"),
    ['web/characters/policy.js'],
  )
  assert.deepEqual(
    reachesInside(file, "import { y } from './characters/index.js'"),
    [],
  )
})
