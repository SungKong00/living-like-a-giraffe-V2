// Used by both installed launchers after starting the background process.
// Verify this is our listener before showing the ready screen.
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHmac, randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import { bridgeOrigin, studioOrigin } from '../shared/helper-connection.mjs'
for (let n = 0; n < 60; n++) {
  try {
    const secret = (
      await fs.readFile(path.join(process.argv[2], 'connection.key'), 'utf8')
    ).trim()
    const challenge = randomUUID()
    const r = await fetch(bridgeOrigin + '/status', {
      method: 'POST',
      headers: { Origin: studioOrigin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ challenge }),
      signal: AbortSignal.timeout(1500),
    })
    const proof = createHmac('sha256', Buffer.from(secret, 'hex'))
      .update(challenge)
      .digest('hex')
    if ((await r.json()).proof === proof) {
      process.stdout.write(studioOrigin + '/studio#helper=' + secret)
      process.exit(0)
    }
  } catch {
    /* The process may still be loading Blender dependencies. */
  }
  await setTimeout(250)
}
throw Error('도우미가 연결되지 않았습니다. 도우미를 다시 열어 주세요.')
