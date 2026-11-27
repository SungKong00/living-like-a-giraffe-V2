// The browser can submit one encrypted, revision-scoped ticket. Only the
// desktop launcher knows the pairing key before it opens the studio.
import http from 'node:http'
import { createDecipheriv, createHmac, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  bridgePort,
  publisherVersion,
  studioOrigin,
  taskURL,
} from '../shared/helper-connection.mjs'
import { publish } from './publish.mjs'

export function bridge({
  key,
  origin = studioOrigin,
  port = bridgePort,
  run = publish,
}) {
  const jobs = new Map()
  let tail = Promise.resolve()
  return http.createServer(
    { requestTimeout: 10000, headersTimeout: 10000 },
    async (req, res) => {
      function send(status, data) {
        res.writeHead(status, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        })
        res.end(JSON.stringify(data))
      }
      if (
        req.headers.host !== '127.0.0.1:' + (port || req.socket.localPort) ||
        req.headers.origin !== origin
      )
        return send(403, {})
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'POST')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
        return send(204, null)
      }
      if (
        req.method !== 'POST' ||
        req.headers['content-type'] !== 'application/json'
      )
        return send(405, {})
      try {
        const chunks = []
        let size = 0
        for await (const part of req) {
          if ((size += part.length) > 2048) return send(413, {})
          chunks.push(part)
        }
        const data = JSON.parse(Buffer.concat(chunks))
        if (req.url === '/status' && /^[0-9a-f-]{36}$/.test(data.challenge)) {
          const proof = createHmac('sha256', key)
            .update(data.challenge)
            .digest('hex')
          return send(200, {
            proof,
            publisherVersion,
            bakeProgress: true,
            stage: jobs.get(data.job)?.stage,
            bakePercent: jobs.get(data.job)?.bakePercent,
            error: jobs.get(data.job)?.error,
          })
        }
        if (req.url !== '/run') return send(404, {})
        const sealed = Buffer.from(data.sealed, 'base64')
        const decipher = createDecipheriv(
          'aes-256-gcm',
          key,
          sealed.subarray(0, 12),
        )
        decipher.setAuthTag(sealed.subarray(-16))
        const ticket = Buffer.concat([
          decipher.update(sealed.subarray(12, -16)),
          decipher.final(),
        ]).toString()
        const url = taskURL(ticket, origin)
        const id = url.pathname.split('/').pop()
        const now = Date.now()
        for (const [id, entry] of jobs) if (entry.expires < now) jobs.delete(id)
        if (!jobs.has(id) || (data.retry === true && jobs.get(id).error)) {
          const entry = {
            stage: '이 컴퓨터에서 작업 대기 중',
            expires: now + 7200000,
          }
          jobs.set(id, entry)
          tail = tail.then(async () => {
            try {
              await run(ticket, {
                local: origin !== studioOrigin,
                claimWaiting: data.retry !== true,
                onStage: (stage, bakePercent) => {
                  entry.bakePercent = bakePercent
                  entry.stage = stage
                },
              })
              entry.stage = '완료'
            } catch (e) {
              entry.error = String(e.message).slice(0, 300)
              entry.stage = '처리 중단'
            } finally {
              delete entry.bakePercent
            }
          })
        }
        return send(202, { stage: jobs.get(id).stage })
      } catch {
        return send(400, { error: '도우미를 다시 연결하세요.' })
      }
    },
  )
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const directory = process.argv[2]
  const file = path.join(directory, 'connection.key')
  if (!fs.existsSync(file)) {
    try {
      fs.writeFileSync(file, randomBytes(32).toString('hex'), {
        flag: 'wx',
        mode: 0o600,
      })
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
    }
  }
  const key = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex')
  if (key.length !== 32) throw Error('도우미 연결 정보를 읽지 못했습니다.')
  const server = bridge({ key })
  server.on('error', (e) => {
    process.exitCode = e.code === 'EADDRINUSE' ? 0 : 1
  })
  server.listen(bridgePort, '127.0.0.1')
}
