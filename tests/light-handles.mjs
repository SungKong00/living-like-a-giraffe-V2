import assert from 'node:assert/strict'
import sharp from 'sharp'

const center = async (node) => {
  const box = await node.boundingBox()
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

// The geometry size is screen-relative. Find the visible rotation ring and
// drive real pointer events, including Babylon's picking and the DOM overlay.
async function ringPoint(canvas, origin, before) {
  const bounds = await canvas.boundingBox()
  const x = Math.round(origin.x - bounds.x),
    y = Math.round(origin.y - bounds.y)
  // The sauna itself contains red surfaces. Only pick pixels that appeared
  // when this same camera switched from arrows to rotation rings.
  for (let frame = 0; frame < 8; frame++) {
    const { data, info } = await sharp(await canvas.screenshot())
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const red = []
    for (let dy = -76; dy < -30; dy++)
      for (let dx = -35; dx < 35; dx++) {
        const i = ((y + dy) * info.width + x + dx) * info.channels
        if (
          data[i] > 190 &&
          data[i + 1] < 8 &&
          data[i + 2] < 8 &&
          (before[i] < 150 || before[i + 1] > 30 || before[i + 2] > 30)
        )
          red.push({ x: bounds.x + x + dx, y: bounds.y + y + dy })
      }
    if (red.length >= 4) return red[Math.floor(red.length / 2)]
  }
  assert.fail('회전 고리가 조명 주위에 보이지 않습니다.')
}

export async function checkLightHandles(page, origin, name, native) {
  const pin = page.getByRole('button', { name: '조명 · ' + name, exact: true })
  const draft = () =>
    page.request.get(origin + '/api/admin/draft').then((r) => r.json())
  const saved = () => page.locator('[data-save-state="saved"]').waitFor()
  const undo = () => page.locator('button[aria-label="되돌리기"]').click()
  await pin.click()
  const height = page.getByLabel('조명 위치 Y')
  const initial = Number(await height.inputValue())
  const before = await draft()
  const start = await center(pin)
  const raise = async () => {
    await page.mouse.move(start.x, start.y - 34)
    await page.mouse.down()
    await page.mouse.move(start.x, start.y - 72, { steps: 8 })
    assert.ok(
      Number(await height.inputValue()) > initial,
      '높이 화살표 드래그 중 Y 표시',
    )
  }
  await raise()
  assert.equal((await draft()).id, before.id)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await saved()
  assert.equal(Number(await height.inputValue()), initial)
  assert.equal((await draft()).id, before.id)
  await raise()
  await page.mouse.up()
  await saved()
  const after = await draft()
  const record = (d) =>
    native
      ? d.layout.sourceLights[0]
      : d.layout.lights.find((l) => l.label === name)
  assert.ok(record(after).position[1] > initial)
  await undo()
  await saved()
  assert.deepEqual((await draft()).layout, before.layout)
  // Grab the marker itself to move horizontally, preserving the current height.
  const p = await center(pin)
  await page.mouse.move(p.x, p.y)
  await page.mouse.down()
  await page.mouse.move(p.x + 48, p.y + 14, { steps: 8 })
  await page.mouse.up()
  await saved()
  assert.equal(record(await draft()).position[1], initial)
  assert.notDeepEqual((await draft()).layout, before.layout)
  await undo()
  await saved()
  assert.deepEqual((await draft()).layout, before.layout)
  if (!native) {
    assert.equal(
      await page.getByRole('radio', { name: '회전', exact: true }).count(),
      0,
    )
    return
  }
  await turnLightHandle(page, pin)
  await saved()
  const turned = record(await draft())
  assert.equal(turned.rotation.length, 4)
  assert.ok(Math.abs(Math.hypot(...turned.rotation) - 1) < 1e-5)
  await undo()
  await saved()
  assert.deepEqual((await draft()).layout, before.layout)
  await page.getByRole('radio', { name: '이동', exact: true }).click()
}

export async function turnLightHandle(page, pin) {
  const canvas = page.locator('.studio-viewport canvas')
  const before = await sharp(await canvas.screenshot())
    .removeAlpha()
    .raw()
    .toBuffer()
  await page.getByRole('radio', { name: '회전', exact: true }).click()
  const ring = await ringPoint(canvas, await center(pin), before)
  await page.mouse.move(ring.x, ring.y)
  await page.mouse.down()
  await page.mouse.move(ring.x + 32, ring.y + 18, { steps: 10 })
  const written = page.waitForResponse(
    (r) =>
      r.request().method() === 'PUT' && r.url().endsWith('/api/admin/draft'),
  )
  await page.mouse.up()
  assert.ok((await written).ok())
}
