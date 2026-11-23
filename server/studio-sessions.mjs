import fs from 'node:fs'
import path from 'node:path'
import { createHmac, randomBytes } from 'node:crypto'
import { json, put } from './world-files.mjs'

export const sessionLifetime = 8 * 3600e3

// Only a verifier is stored. Rotating the studio key invalidates prior logins.
export class StudioSessions {
  #file
  #key
  #entries
  constructor(directory, key) {
    this.#file = path.join(directory, 'sessions.json')
    this.#key = key
    this.#entries = new Map(fs.existsSync(this.#file) ? json(this.#file) : [])
  }
  #digest(token) {
    return createHmac('sha256', this.#key).update(token).digest('hex')
  }
  issue() {
    const token = randomBytes(32).toString('hex')
    const now = Date.now()
    const active = new Map([...this.#entries].filter(([, end]) => end > now))
    active.set(this.#digest(token), now + sessionLifetime)
    put(this.#file, [...active])
    this.#entries = active
    return token
  }
  accepts(token) {
    return !!token && this.#entries.get(this.#digest(token)) > Date.now()
  }
}
