import test from 'node:test'
import assert from 'node:assert/strict'
import {
  randomBytes,
  randomUUID,
  createHmac,
  createCipheriv,
} from 'node:crypto'
import http from 'node:http'
import { once } from 'node:events'
import { bridge } from '../helper/bridge.mjs'
import { studioOrigin, taskURL } from '../shared/helper-connection.mjs'

test('only paired Studio requests can start a scoped job, repeated deliveries run once', async (t) => {
  const key = randomBytes(32)
  const id = randomUUID()
  const ticket =
    studioOrigin + '/api/helper/' + id + '#' + randomBytes(32).toString('hex')
  const calls = []
  let finishBake
  const baking = new Promise((resolve) => {
    finishBake = resolve
  })
  const srv = bridge({
    key,
    port: 0,
    run: async (value, { onStage }) => {
      calls.push(value)
      onStage('조명 굽기', 40)
      await baking
      onStage('모델 최적화 중')
    },
  })
  srv.listen(0, '127.0.0.1')
  await once(srv, 'listening')
  t.after(() => srv.close())
  const base = 'http://127.0.0.1:' + srv.address().port
  function post(path, body, headers) {
    return fetch(base + path, {
      method: 'POST',
      headers: {
        Origin: studioOrigin,
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
    })
  }
  const challenge = randomUUID()
  assert.equal(
    (
      await post(
        '/status',
        { challenge },
        { Origin: 'https://another.example' },
      )
    ).status,
    403,
  )
  const invalidHost = await new Promise((resolve, reject) => {
    http
      .get(
        base + '/status',
        { headers: { Host: 'another.example', Origin: studioOrigin } },
        (r) => {
          r.resume()
          resolve(r.statusCode)
        },
      )
      .on('error', reject)
  })
  assert.equal(invalidHost, 403)
  assert.equal(
    (await (await post('/status', { challenge })).json()).proof,
    createHmac('sha256', key).update(challenge).digest('hex'),
  )
  function seal(value, secret = key) {
    const iv = randomBytes(12)
    const aes = createCipheriv('aes-256-gcm', secret, iv)
    return Buffer.concat([
      iv,
      aes.update(value),
      aes.final(),
      aes.getAuthTag(),
    ]).toString('base64')
  }
  assert.throws(() =>
    taskURL(ticket.replace('pages.dev', 'pages.dev.example.org')),
  )
  assert.equal(
    (await post('/run', { sealed: seal(ticket, randomBytes(32)) })).status,
    400,
  )
  assert.equal(
    (
      await post('/run', {
        sealed: seal(ticket.replace('pages.dev', 'pages.dev.example.org')),
      })
    ).status,
    400,
  )
  for (let i = 0; i < 2; i++)
    assert.equal((await post('/run', { sealed: seal(ticket) })).status, 202)
  const status = async () =>
    (await post('/status', { challenge, job: id })).json()
  assert.equal((await status()).bakePercent, 40)
  finishBake()
  const completed = await status()
  assert.equal(completed.stage, '완료')
  assert.equal(completed.bakePercent, undefined)
  assert.deepEqual(calls, [ticket])
})
