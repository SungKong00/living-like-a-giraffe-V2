// Exercise actual WebGL draws. The two equal baked samples may share a draw;
// the third surface has a different bake and its own destination.
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { Document, NodeIO } from '@gltf-transform/core'
import { chromium } from 'playwright'
import { optimizeVisitor } from '../world/optimize.mjs'

const dir = await fs.mkdtemp(path.resolve('.world/render-'))
const doc = new Document(),
  scene = doc.createScene(),
  buffer = doc.createBuffer()
const room = doc
  .createNode()
  .setExtras({ roomId: 'sauna' })
  .setTranslation([34, 0, -24])
scene.addChild(room)
function attribute(type, values) {
  return doc
    .createAccessor()
    .setBuffer(buffer)
    .setType(type)
    .setArray(new Float32Array(values))
}
const items = [],
  spots = []
for (const [i, color] of ['#555533', '#555533', '#225588'].entries()) {
  const position = [(i - 1) * 8, 0, 0],
    id = 'seat-' + i
  const image = await sharp({
    create: { width: 4, height: 4, channels: 3, background: color },
  })
    .png()
    .toBuffer()
  const texture = doc.createTexture().setImage(image).setMimeType('image/png')
  const mat = doc
    .createMaterial()
    .setExtras({ riragiBaked: true, riragiFinish: 'original' })
    .setDoubleSided(true)
    .setBaseColorFactor([0, 0, 0, 1])
    .setEmissiveFactor([1, 1, 1])
    .setEmissiveTexture(texture)
  const prim = doc
    .createPrimitive()
    .setMaterial(mat)
    .setAttribute('POSITION', attribute('VEC3', [-3, 0, -2, 3, 0, -2, 0, 3, 2]))
    .setAttribute('TEXCOORD_0', attribute('VEC2', [0, 0, 1, 0, 0.5, 1]))
  const anchor = doc
    .createNode()
    .setExtras({ itemId: id })
    .setTranslation(position)
  room.addChild(anchor)
  anchor.addChild(doc.createNode().setMesh(doc.createMesh().addPrimitive(prim)))
  items.push({
    id,
    room: 'sauna',
    position,
    scale: [1, 1, 1],
    rotation: [0, 0, 0, 1],
  })
  spots.push({
    id,
    anchor: id,
    label: id,
    position: [0, 0, 0],
    size: [2, 2, 2],
    action: { type: 'url', url: 'https://example.org/' + id },
  })
}
let browser
try {
  const raw = path.join(dir, 'raw.glb'),
    batched = path.join(dir, 'batched.glb')
  await new NodeIO().write(raw, doc)
  await optimizeVisitor(raw, batched, ['sauna'])
  browser = await chromium.launch({
    channel: 'chrome',
    args: ['--enable-unsafe-swiftshader'],
  })
  const counts = []
  for (const model of [raw, batched]) {
    const p = await browser.newPage()
    await p.addInitScript(() => {
      let count = 0
      window.drawSamples = []
      for (const proto of [
        WebGLRenderingContext.prototype,
        WebGL2RenderingContext.prototype,
      ])
        for (const name of [
          'drawElements',
          'drawArrays',
          'drawElementsInstanced',
          'drawArraysInstanced',
        ]) {
          if (!Object.hasOwn(proto, name)) continue
          const original = proto[name]
          proto[name] = function (...args) {
            count++
            return original.apply(this, args)
          }
        }
      function frame() {
        if (count) window.drawSamples.push(count)
        count = 0
        requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
    })
    await p.route('**/api/world', (r) =>
      r.fulfill({
        json: {
          rooms: [{ id: 'sauna', label: '사우나' }],
          layout: { items, spots, pages: [] },
          render: 'visitor',
          asset: '/api/world/sample',
        },
      }),
    )
    await p.route('**/api/world/sample', (r) =>
      r.fulfill({ path: model, contentType: 'model/gltf-binary' }),
    )
    await p.goto(process.env.RIRAGI_SITE || 'http://127.0.0.1:4173')
    await p.getByRole('button', { name: '사우나', exact: true }).click()
    await p.waitForFunction(() => window.drawSamples.length >= 4)
    for (const s of spots) {
      await p.getByRole('button', { name: s.label, exact: true }).click()
      assert.equal(
        await p.locator('.place-sheet a').getAttribute('href'),
        s.action.url,
      )
      await p.getByRole('button', { name: '닫기' }).click()
    }
    counts.push(await p.evaluate(() => window.drawSamples.at(-1)))
    await p.close()
  }
  // Each frame also draws the shared studio floor.
  assert.deepEqual(counts, [4, 3])
  console.log(
    '같은 베이크 2개와 다른 베이크 1개 · 프레임당 WebGL 그리기',
    counts.join(' → '),
    '· 세 클릭 대상 유지',
  )
} finally {
  await browser?.close()
  await fs.rm(dir, { force: true, recursive: true })
}
