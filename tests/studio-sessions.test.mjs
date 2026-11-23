import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { StudioSessions, sessionLifetime } from '../server/studio-sessions.mjs'

test('유효한 로그인만 재시작 뒤 유지하며 기한과 키 변경을 적용한다', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'riragi-session-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  t.mock.timers.enable({ apis: ['Date'], now: 1000 })
  const first = new StudioSessions(dir, 'test-key')
  const token = first.issue()
  const restarted = new StudioSessions(dir, 'test-key')
  assert.ok(restarted.accepts(token))
  assert.ok(!new StudioSessions(dir, 'different-key').accepts(token))
  assert.ok(!restarted.accepts(undefined))
  assert.ok(!restarted.accepts('a'.repeat(64)))
  assert.ok(
    !fs.readFileSync(path.join(dir, 'sessions.json'), 'utf8').includes(token),
  )
  t.mock.timers.tick(sessionLifetime)
  assert.ok(!restarted.accepts(token))
  assert.ok(restarted.accepts(restarted.issue()))
})
