import { copyPreparedWorld } from './prepared-world.mjs'
import { assetKey } from '../server/visitor-asset.mjs'
import { NodeIO, getBounds } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import { mat4, vec3 } from 'gl-matrix'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { networkInterfaces } from 'node:os'
import { pathToFileURL } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'

// The reference scene for the character performance budget: 50 characters
// spread over the rooms of a world, published so the visitor page shows
// them. The world is the one a site has published (`from`, the deployed
// background) or, offline, the prepared world the browser tests use. The
// characters are the giraffes bundled with the studio. The mix is fixed so
// two runs measure the same scene: 35 bipeds (routes, walking in place,
// standing) and 15 four-legged giraffes (looking around, some wearing
// everything their model has).
// See openspec/changes/scale-character-performance/design.md.

export const benchCount = 50
const idleFile = 'assets-source/characters/riragi-clay/riragi-biped-idle.glb'
const BIPED = 'riragi-biped'
const QUADRUPED = 'riragi'
const walk = BIPED + '/두 발 걷기'

/**
 * The floor each room offers characters, from the world's visitor GLB:
 * `Map(roomId → { min: [x, z], max: [x, z] })` in the room's own metres.
 * A node that spans several other rooms (the building's shell) is left out.
 */
export async function roomFloors(glb) {
  await MeshoptDecoder.ready
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
  const doc = await io.readBinary(new Uint8Array(glb))
  const rooms = doc
    .getRoot()
    .listNodes()
    .filter((node) => node.getExtras().roomId)
    .map((node) => ({
      id: node.getExtras().roomId,
      matrix: node.getWorldMatrix(),
      origin: mat4.getTranslation(vec3.create(), node.getWorldMatrix()),
      ...getBounds(node),
    }))
  const floors = new Map()
  for (const room of rooms) {
    const holds = (p) =>
      p[0] > room.min[0] &&
      p[0] < room.max[0] &&
      p[2] > room.min[2] &&
      p[2] < room.max[2]
    const center = (other) => [
      (other.min[0] + other.max[0]) / 2,
      0,
      (other.min[2] + other.max[2]) / 2,
    ]
    const spanned = rooms.filter(
      (other) => other !== room && holds(center(other)),
    )
    if (spanned.length > 1) continue
    const inverse = mat4.invert(mat4.create(), room.matrix)
    const corners = [
      [room.min[0], room.origin[1], room.min[2]],
      [room.max[0], room.origin[1], room.max[2]],
    ].map((p) => vec3.transformMat4(vec3.create(), p, inverse))
    floors.set(room.id, {
      min: [0, 2].map((k) => Math.min(corners[0][k], corners[1][k])),
      max: [0, 2].map((k) => Math.max(corners[0][k], corners[1][k])),
    })
  }
  return floors
}

// `count` places spread evenly over a floor, away from its walls.
function places({ min, max }, count) {
  const inset = 0.2
  const size = [max[0] - min[0], max[1] - min[1]]
  const columns = Math.max(
    1,
    Math.ceil(Math.sqrt((count * size[0]) / Math.max(size[1], 0.01))),
  )
  const rows = Math.ceil(count / columns)
  const along = (k, index, cells) =>
    min[k] + size[k] * (inset + ((1 - 2 * inset) * (index + 0.5)) / cells)
  return Array.from({ length: count }, (_, i) => [
    +along(0, i % columns, columns).toFixed(2),
    0,
    +along(1, Math.floor(i / columns), rows).toFixed(2),
  ])
}

/**
 * `layout` with the reference characters in place of its own. `floors` is
 * what roomFloors() found, `library` the studio's character library and
 * `idle` a clip to stand with, or null.
 */
export function benchLayout(layout, floors, library, idle = null) {
  const rooms = [...floors.keys()]
  const share = (index) =>
    Math.floor(benchCount / rooms.length) +
    (index < benchCount % rooms.length ? 1 : 0)
  const spots = rooms.map((id, index) => places(floors.get(id), share(index)))
  const wearables = (id) =>
    (library.models.find((m) => m.id === id)?.wearables ?? []).map((w) => w.id)
  const look = library.motions
    .find((m) => m.id === QUADRUPED)
    ?.clips.map((clip) => QUADRUPED + '/' + clip.name)[0]
  const characters = []
  for (let i = 0; i < benchCount; i++) {
    const position = spots[i % rooms.length][Math.floor(i / rooms.length)]
    const base = {
      id: 'bench-' + String(i + 1).padStart(2, '0'),
      room: rooms[i % rooms.length],
      label: '기준 ' + (i + 1),
      position,
      yaw: (i * 47) % 360,
      scale: 1,
    }
    const kind = i % 10
    if (kind < 3)
      // Walks a triangle and comes back; every other one stops on the way.
      characters.push({
        ...base,
        model: BIPED,
        route: {
          mode: kind === 2 ? 'pingpong' : 'loop',
          walk,
          ...(idle ? { idle } : {}),
          points: [
            { at: [0, 0] },
            {
              at: [1.6, 0.9],
              ...(kind === 1
                ? { stop: { wait: 2, ...(idle ? { motion: idle } : {}) } }
                : {}),
            },
            { at: [-1, 1.7] },
          ],
        },
      })
    else if (kind < 5) characters.push({ ...base, model: BIPED, motion: walk })
    else if (kind < 7)
      characters.push({ ...base, model: BIPED, motion: idle ?? walk })
    else
      characters.push({
        ...base,
        model: QUADRUPED,
        motion: look ?? null,
        // Every third one is dressed, which adds its wearables' draws.
        ...(kind === 9 ? { wear: wearables(QUADRUPED) } : {}),
      })
  }
  return { ...layout, characters }
}

const lanAddress = () =>
  Object.values(networkInterfaces())
    .flat()
    .find((a) => a.family === 'IPv4' && !a.internal)?.address

// A data folder holding the world `from` has published: its rooms, its
// furniture as placed and its baked visitor model. Only what a visitor can
// read is copied, so the folder cannot bake or reopen the Blender source.
async function copyPublishedWorld(dir, from) {
  const read = async (address) => {
    const response = await fetch(new URL(address, from))
    if (!response.ok) throw Error(address + ' · ' + response.status)
    return response
  }
  const world = await (await read('/api/world')).json()
  const glb = Buffer.from(await (await read(world.asset)).arrayBuffer())
  const { characters: _, ...layout } = world.layout
  const write = (file, data) => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, data)
  }
  write(
    path.join(dir, 'models/initial/catalog.json'),
    JSON.stringify({ rooms: world.rooms, items: layout.items, options: {} }),
  )
  const draft = { id: randomUUID(), model: 'initial', layout }
  const asset = assetKey(draft)
  write(path.join(dir, 'builds', asset, 'world.glb'), glb)
  write(
    path.join(dir, 'state.json'),
    JSON.stringify({
      draft,
      published: { ...draft, asset },
      previous: null,
      job: null,
    }),
  )
}

/**
 * Serves the reference scene from a temporary data folder. `from` is the
 * origin of a site whose published world is the background; without it the
 * prepared world is. `host` other than 127.0.0.1 lets a phone on the same
 * network open it. Returns the local `origin`, the `lan` origin (when
 * exposed) and `close()`.
 */
export async function serveBench({
  host = '127.0.0.1',
  port = '0',
  from = null,
} = {}) {
  if (!fs.existsSync('dist/index.html'))
    throw Error('npm run build를 먼저 실행하세요.')
  const root = fs.mkdtempSync(path.resolve('.world/bench-'))
  if (from) await copyPublishedWorld(root, from)
  else copyPreparedWorld(root)
  const key = randomUUID()
  const server = spawn(process.execPath, ['server/start.mjs', '--production'], {
    env: {
      ...process.env,
      PORT: String(port),
      RIRAGI_HOST: host,
      RIRAGI_DATA: root,
      RIRAGI_ADMIN_KEY: key,
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  async function close() {
    if (server.exitCode === null && server.signalCode === null) {
      const ended = once(server, 'exit')
      server.kill()
      await ended
    }
    fs.rmSync(root, { recursive: true, force: true })
    // The server's lock sits beside the data folder and outlives a kill.
    fs.rmSync(root + '.lock', { recursive: true, force: true })
  }
  try {
    const [line] = await Promise.race([
      once(server.stdout, 'data'),
      once(server, 'exit').then(() => {
        throw Error('서버 시작 실패')
      }),
    ])
    const local = String(line).match(/http:\/\/127\.0\.0\.1:(\d+)/)
    const origin = local[0]
    const login = await fetch(origin + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    })
    const cookie = login.headers.get('set-cookie').split(';')[0]
    const admin = async (route, method = 'GET', body, type) => {
      const response = await fetch(origin + '/api/admin/' + route, {
        method,
        headers: {
          Cookie: cookie,
          ...(body ? { 'Content-Type': type ?? 'application/json' } : {}),
        },
        body: type ? body : body && JSON.stringify(body),
      })
      const data = await response.json()
      if (!response.ok)
        throw Error(route + ' · ' + (data.error ?? response.status))
      return data
    }
    // Standing needs its own clip; without the file bipeds walk in place.
    let library = await admin('characters')
    let idle = null
    if (fs.existsSync(idleFile)) {
      library = await admin(
        'characters/motions?name=' + encodeURIComponent('편안히 서기'),
        'POST',
        fs.readFileSync(idleFile),
        'application/octet-stream',
      )
      const added = library.motions.find(
        (m) => !m.builtin && m.matched[BIPED] > 0,
      )
      if (added) idle = added.id + '/' + added.clips[0].name
    }
    const draft = await admin('draft')
    const shown = await (await fetch(origin + '/api/world')).json()
    const floors = await roomFloors(
      await (await fetch(origin + shown.asset)).arrayBuffer(),
    )
    const saved = await admin('draft', 'PUT', {
      revision: draft.id,
      layout: benchLayout(draft.layout, floors, library, idle),
    })
    await admin('publish', 'POST', { revision: saved.id })
    for (let i = 0; ; i++) {
      const world = await (await fetch(origin + '/api/world')).json()
      if (world.id === saved.id) break
      if (i > 100) throw Error('기준 장면이 공개되지 않았습니다.')
      await new Promise((done) => setTimeout(done, 100))
    }
    const address = host === '127.0.0.1' ? null : lanAddress()
    return {
      origin,
      lan: address ? 'http://' + address + ':' + local[1] : null,
      close,
    }
  } catch (error) {
    await close()
    throw error
  }
}

/**
 * Opens the reference scene in Chrome on this computer's GPU and reads the
 * `?perf` readout in the overview and with one room chosen. `device` is a
 * Playwright context description (viewport, deviceScaleFactor, …) and `cpu`
 * slows the page's main thread that many times, since a fast computer stays
 * at its display's frame rate and shows no difference otherwise. Neither
 * stands in for the phone the budget names: the frame times only compare one
 * run with another on the same machine.
 */
export async function measureBench(
  origin,
  device,
  { cpu = 1, room = '운동회' } = {},
) {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
  })
  try {
    const page = await browser.newPage(device)
    if (cpu > 1) {
      const session = await page.context().newCDPSession(page)
      await session.send('Emulation.setCPUThrottlingRate', { rate: cpu })
    }
    await page.goto(origin + '/?perf')
    const readout = page.locator('.perf-readout')
    // Every model has loaded once all the characters that may move do.
    await page.waitForFunction(() => {
      const data = document.querySelector('.perf-readout')?.dataset
      return data && +data.characters > 0 && +data.posed > 0
    })
    const read = async () => {
      const from = +(await readout.getAttribute('data-samples'))
      await page
        .waitForFunction(
          (from) =>
            +document.querySelector('.perf-readout').dataset.samples >=
            from + 300,
          from,
          { timeout: 60000 },
        )
        .catch(() => {})
      const data = await readout.evaluate((node) => ({ ...node.dataset }))
      return {
        p95: +data.p95,
        draws: +data.draws,
        triangles: +data.triangles,
        posed: +data.posed,
        characters: +data.characters,
      }
    }
    await page.waitForTimeout(3000)
    const overview = await read()
    await page.getByRole('button', { name: room, exact: true }).first().click()
    await page.waitForTimeout(1500)
    const focused = await read()
    const renderer = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2')
      const info = gl?.getExtension('WEBGL_debug_renderer_info')
      return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : '알 수 없음'
    })
    return { renderer, overview, room: focused }
  } finally {
    await browser.close()
  }
}

// `npm run bench:characters`: keeps serving for a phone until interrupted.
// With `--measure` it reads the numbers on this computer and exits.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const measure = process.argv.includes('--measure')
  const at = process.argv.indexOf('--from')
  const from = at < 0 ? null : process.argv[at + 1]
  const bench = await serveBench({
    host: measure ? '127.0.0.1' : '0.0.0.0',
    port: process.env.PORT ?? (measure ? '0' : '4180'),
    from,
  })
  if (measure) {
    const { devices } = await import('playwright')
    try {
      for (const [name, device, cpu] of [
        ['데스크톱 1440×900', { viewport: { width: 1440, height: 900 } }, 1],
        ['Pixel 7 크기', devices['Pixel 7'], 1],
        ['Pixel 7 크기 · CPU 4배 느리게', devices['Pixel 7'], 4],
      ]) {
        const result = await measureBench(bench.origin, device, { cpu })
        console.log(name + ' · ' + result.renderer)
        console.table({ '전체 보기': result.overview, 운동회: result.room })
      }
    } finally {
      await bench.close()
    }
    process.exit(0)
  }
  console.log(
    '캐릭터 ' +
      benchCount +
      '마리 기준 장면 · 배경 ' +
      (from ? from + '의 공개본' : '준비한 월드'),
  )
  console.log('  이 컴퓨터  ' + bench.origin + '/?perf')
  if (bench.lan)
    console.log('  같은 네트워크의 휴대폰  ' + bench.lan + '/?perf')
  console.log('  Ctrl+C로 끝냅니다.')
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, async () => {
      await bench.close()
      process.exit(0)
    })
}
