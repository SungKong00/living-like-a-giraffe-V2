import { copyPreparedWorld } from './prepared-world.mjs'
import { chromium, devices } from 'playwright'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
const root = fs.mkdtempSync(path.resolve('.world/browser-'))
copyPreparedWorld(root)
const key = randomUUID()
const server = spawn(process.execPath, ['server/start.mjs', '--production'], {
  env: { ...process.env, PORT: '0', RIRAGI_DATA: root, RIRAGI_ADMIN_KEY: key },
  stdio: ['ignore', 'pipe', 'inherit'],
})
let browser
try {
  const [line] = await Promise.race([
    once(server.stdout, 'data'),
    once(server, 'exit').then(() => {
      throw Error('서버 시작 실패')
    }),
  ])
  const origin = String(line).match(/http:\/\/127\.0\.0\.1:\d+/)[0]
  browser = await chromium.launch({
    channel: 'chrome',
    args: ['--enable-unsafe-swiftshader'],
  })
  const errors = []
  const page = await browser.newPage({
    viewport: { width: 1280, height: 850 },
  })
  page.on('pageerror', (e) => errors.push(e.message))
  for (const [method, route] of [
    ['PUT', 'draft'],
    ['POST', 'publish'],
    ['POST', 'reviews'],
    ['POST', 'lighting'],
    ['GET', 'lighting/' + '0'.repeat(64)],
    ['GET', 'reviews/unknown/asset'],
    ['POST', 'reviews/unknown/publish'],
    ['GET', 'download/draft'],
  ]) {
    assert.equal(
      (await fetch(origin + '/api/admin/' + route, { method })).status,
      401,
    )
  }
  const before = await (await fetch(origin + '/api/world')).json()
  const bakes = []
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url() === origin + '/api/admin/lighting')
      bakes.push(r.url())
  })
  await page.goto(origin + '/studio')
  await page.getByLabel('관리자 키').fill(key)
  await page.getByRole('button', { name: '스튜디오 열기' }).click()
  const saved = () => page.locator('[data-save-state="saved"]').waitFor()
  const tree = (name) =>
    page.locator('.ui-tree-item__main', { hasText: name }).first()
  await page.waitForFunction(
    () => performance.getEntriesByName('riragi-world-ready').length,
  )
  assert.equal(await page.locator('.studio-viewport canvas').count(), 1)
  assert.equal(
    (await page.request.get(origin + '/api/admin/status').then((r) => r.json()))
      .job,
    null,
  )
  assert.equal(
    (await page.request.get(origin + '/api/world').then((r) => r.json())).id,
    before.id,
  )
  await page.getByRole('button', { name: '조명 추가', exact: true }).click()
  await page.getByLabel('조명 이름').waitFor()
  const energy = page.getByRole('slider', { name: '조명 출력' })
  await energy.evaluate((input) => {
    for (const value of [450, 420, 360]) {
      input.value = String(value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
  })
  const priorRequests = bakes.length
  await page.waitForTimeout(1300)
  assert.equal(bakes.length, priorRequests)
  await energy.dispatchEvent('change')
  await page.getByLabel('직접 고른 조명 색').fill('#ffccaa')
  await saved()
  const edited = await page.request
    .get(origin + '/api/admin/draft')
    .then((r) => r.json())
  assert.equal(edited.layout.lights[0].color, '#ffccaa')
  assert.equal(edited.layout.lights[0].energy, 360)
  await page.waitForTimeout(1300)
  assert.deepEqual(bakes, [])
  assert.equal(await page.getByLabel('조명 이름').inputValue(), '점광원 1')
  assert.equal(
    (await page.request.get(origin + '/api/world').then((r) => r.json())).id,
    before.id,
  )
  await page.getByRole('button', { name: '조명 삭제' }).click()
  await tree('나무 벤치').click()
  await page.getByLabel('이름', { exact: true }).waitFor()
  await saved()
  // Pick an exposed part of the framed bench using the same grab affordance
  // as the editor. Its anchor can be behind a pin or between the two tiers.
  const viewport = page.locator('.studio-viewport canvas')
  const bounds = await viewport.boundingBox()
  let grabbed
  for (const dx of [0, 16, -16, 32, -32, 48, -48]) {
    for (const dy of [0, -8, 8, -18, 18]) {
      const x = bounds.x + bounds.width / 2 + dx
      const y = bounds.y + bounds.height / 2 + dy
      await page.mouse.move(x, y)
      if (
        await viewport.evaluate(async (c) => {
          await new Promise((done) =>
            requestAnimationFrame(() => requestAnimationFrame(done)),
          )
          return c.style.cursor === 'grab'
        })
      ) {
        grabbed = { x, y }
        break
      }
    }
    if (grabbed) break
  }
  assert.ok(grabbed, '선택한 벤치를 장면에서 잡을 수 있어야 합니다')
  const thumbnail = page.getByRole('img', { name: '선택 오브젝트 미리보기' })
  const initialPortrait = await thumbnail.evaluate((c) => c.toDataURL())
  const draftBeforeDrag = await (
    await page.request.get(origin + '/api/admin/draft')
  ).json()
  await page.mouse.down()
  await page.mouse.move(grabbed.x + 90, grabbed.y + 30, { steps: 6 })
  await page.waitForFunction(
    (initial) =>
      document.querySelector('.ui-object-preview').toDataURL() !== initial,
    initialPortrait,
  )
  assert.equal(
    (await (await page.request.get(origin + '/api/admin/draft')).json()).id,
    draftBeforeDrag.id,
  )
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await page.waitForFunction(
    (initial) =>
      document.querySelector('.ui-object-preview').toDataURL() === initial,
    initialPortrait,
  )
  // Selecting from the list opens the inspector; ⌘/Ctrl+D duplicates.
  await page.keyboard.press('ControlOrMeta+d')
  // The inspector re-renders on the next frame; act on the duplicate only.
  const inspecting = (label) =>
    page.waitForFunction(
      (l) => document.querySelector('[data-key="label"]')?.value === l,
      label,
    )
  await inspecting('나무 벤치 2')
  const portrait = page.getByRole('img', { name: '선택 오브젝트 미리보기' })
  await portrait.waitFor()
  await page.waitForFunction(() => {
    const c = document.querySelector('.ui-object-preview')
    const pixels = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    return pixels.some(
      (value, i) => i % 4 === 0 && Math.abs(value - pixels[0]) > 20,
    )
  })
  const originalPortrait = await portrait.evaluate((c) => c.toDataURL())
  // A missing session must not discard the current selection or pending edits.
  await saved()
  await page.context().clearCookies()
  await page.getByLabel('이름', { exact: true }).fill('파란 벤치')
  await page.getByLabel('이름', { exact: true }).press('Tab')
  await inspecting('파란 벤치')
  const resume = page.getByRole('button', { name: '다시 로그인하고 저장' })
  await resume.waitFor()
  await page.getByLabel('직접 고른 색').fill('#113355')
  await page.waitForFunction(
    (before) =>
      document.querySelector('.ui-object-preview').toDataURL() !== before,
    originalPortrait,
  )
  await resume.click()
  const login = page.getByRole('dialog', { name: '다시 로그인' })
  await login.getByLabel('관리자 키').fill('incorrect')
  await login.getByRole('button', { name: '로그인하고 저장' }).click()
  await login.getByText('관리자 키가 맞지 않습니다.').waitFor()
  await login.getByLabel('관리자 키').fill(key)
  await login.getByRole('button', { name: '로그인하고 저장' }).click()
  await saved()
  const resumed = await (
    await page.request.get(origin + '/api/admin/draft')
  ).json()
  assert.equal(
    resumed.layout.items.find((i) => i.label === '파란 벤치').color,
    '#113355',
  )
  assert.equal(
    (await (await fetch(origin + '/api/world')).json()).id,
    before.id,
  )
  await page.getByRole('radio', { name: '무광' }).click()
  await page
    .locator('[role="radio"][aria-checked="true"]', { hasText: '무광' })
    .waitFor()
  await page
    .getByRole('button', { name: '오른쪽으로 15° 회전', exact: true })
    .click()
  await page
    .getByRole('button', { name: '오른쪽으로 15° 회전', exact: true })
    .click()
  await page.getByText('축별 크기').click()
  for (const [field, value] of [
    ['위치 X', '4'],
    ['크기 X', '1.4'],
  ]) {
    const control = page.getByLabel(field, { exact: true })
    await control.fill(value)
    await control.press('Tab')
    // The inspector re-renders after each edit and keeps the next field focused.
    await page.waitForFunction(
      (f) => document.activeElement?.getAttribute('aria-label') !== f,
      field,
    )
  }
  await saved()
  assert.equal(
    (await (await page.request.get(origin + '/api/admin/draft')).json()).layout
      .items.length,
    2,
  )
  await page.reload()
  await tree('파란 벤치').click()
  await inspecting('파란 벤치')
  assert.equal(await page.getByLabel('직접 고른 색').inputValue(), '#113355')
  assert.equal(
    await page
      .getByRole('radio', { name: '무광' })
      .getAttribute('aria-checked'),
    'true',
  )
  assert.equal(
    await page.getByLabel('방향', { exact: true }).inputValue(),
    '30',
  )
  assert.equal(
    await page.getByLabel('위치 X', { exact: true }).inputValue(),
    '4',
  )
  assert.equal(
    await page.getByLabel('크기 X', { exact: true }).inputValue(),
    '1.4',
  )
  // Deleting is undoable from the notice.
  await page.keyboard.press('Delete')
  await page
    .locator('.ui-toaster')
    .getByRole('button', { name: '되돌리기', exact: true })
    .click()
  await tree('파란 벤치').waitFor()
  await page.getByRole('tab', { name: '행사 페이지' }).click()
  await page.getByRole('button', { name: '새 페이지', exact: true }).click()
  await page.getByLabel('제목', { exact: true }).fill('벤치 이야기')
  await page.getByLabel('제목', { exact: true }).press('Tab')
  await page.getByRole('tab', { name: '배치' }).click()
  await tree('파란 벤치').click()
  await page
    .getByRole('button', { name: '클릭 영역 추가', exact: true })
    .click()
  await page.getByLabel('표시 이름').fill('새 안내')
  await page.getByLabel('표시 이름').press('Tab')
  await page
    .getByLabel('연결 대상', { exact: true })
    .selectOption({ label: '페이지 · 벤치 이야기' })
  // An invalid external address is explained and never reaches the draft.
  await page.getByLabel('연결 대상', { exact: true }).selectOption('__url')
  await page.getByLabel('외부 주소').fill('instagram')
  await page.getByLabel('외부 주소').press('Enter')
  await page.getByText('http:// 또는 https://로 시작하는 주소').waitFor()
  await saved()
  const linked = (
    await (await page.request.get(origin + '/api/admin/draft')).json()
  ).layout.spots.find((s) => s.label === '새 안내')
  assert.equal(linked.action.type, 'page')
  await page.getByRole('button', { name: '미리보기', exact: true }).click()
  const preview = page.getByRole('dialog', { name: '배치 미리보기' })
  await preview
    .getByRole('button', { name: '멘탈 사우나', exact: true })
    .click()
  await preview.getByRole('button', { name: '새 안내', exact: true }).click()
  await preview.getByRole('button', { name: '닫기' }).click()
  assert.deepEqual(bakes, [])
  assert.equal(
    (await (await fetch(origin + '/api/world')).json()).id,
    before.id,
  )
  await page.getByRole('button', { name: '발행', exact: true }).click()
  await page
    .getByRole('button', { name: '구운 결과 준비', exact: true })
    .click()
  // Editing the draft while the result is prepared cancels that result and
  // the publish popover asks for a fresh one.
  await page
    .getByText(/결과 준비 중|구운 결과 열기/)
    .first()
    .waitFor()
  await tree('새 안내').click()
  await page.getByLabel('클릭 범위 W', { exact: true }).fill('2.5')
  await page.getByLabel('클릭 범위 W', { exact: true }).press('Enter')
  await page.getByRole('button', { name: '발행', exact: false }).click()
  await page.getByText('준비한 결과가 취소되었습니다').waitFor()
  await page
    .getByRole('button', { name: '구운 결과 준비', exact: true })
    .click()
  const openReview = page.getByRole('button', { name: '구운 결과 열기' })
  await openReview.waitFor({ timeout: 180000 })
  const status = await (
    await page.request.get(origin + '/api/admin/status')
  ).json()
  const reviewUrl = origin + '/api/admin/reviews/' + status.job.id
  const privateView = await (await page.request.get(reviewUrl)).json()
  assert.equal(privateView.render, 'visitor')
  const privateBytes = await (
    await page.request.get(origin + privateView.asset)
  ).body()
  assert.equal((await fetch(origin + privateView.asset)).status, 401)
  const { assetKey } = await import('../server/visitor-asset.mjs')
  const asset = assetKey({ model: 'initial', layout: privateView.layout })
  assert.equal((await fetch(origin + '/api/world/' + asset)).status, 404)
  assert.equal(
    (await (await fetch(origin + '/api/world')).json()).id,
    before.id,
  )
  assert.equal(
    (
      await page.request.post(origin + '/api/admin/publish', {
        data: { revision: privateView.id },
      })
    ).status(),
    409,
  )
  await openReview.click()
  const review = page.getByRole('dialog', { name: '구운 결과 · 비공개' })
  await review.getByRole('button', { name: '멘탈 사우나', exact: true }).click()
  await review.getByRole('button', { name: '새 안내', exact: true }).click()
  await review.getByRole('button', { name: '이 결과 공개' }).click()
  await review.waitFor({ state: 'detached' })
  const promoted = await (await fetch(origin + '/api/world')).json()
  assert.equal(promoted.id, privateView.id)
  assert.deepEqual(promoted.layout, privateView.layout)
  assert.deepEqual(
    Buffer.from(await (await fetch(origin + promoted.asset)).arrayBuffer()),
    privateBytes,
  )
  const originalDraft = await (
    await page.request.get(origin + '/api/admin/draft')
  ).json()
  const external = {
    ...before.layout.spots[0],
    id: 'external',
    anchor: 'sports',
    label: '행사 원문',
    action: { type: 'url', url: 'https://www.instagram.com/p/Db5UwdEEaVs/' },
  }
  const updated = {
    ...before.layout,
    spots: [...before.layout.spots, external],
  }
  const invalid = await page.request.put(origin + '/api/admin/draft', {
    data: {
      revision: originalDraft.id,
      layout: { ...updated, spots: [{ ...external, anchor: 'missing' }] },
    },
  })
  assert.equal(invalid.status(), 400)
  const publishable = await (
    await page.request.put(origin + '/api/admin/draft', {
      data: { revision: originalDraft.id, layout: updated },
    })
  ).json()
  await page.request.post(origin + '/api/admin/publish', {
    data: { revision: publishable.id },
  })
  await page.waitForFunction(
    async (expected) =>
      (await (await fetch('/api/world')).json()).id === expected,
    publishable.id,
  )
  for (const device of ['iPhone 13', 'Pixel 7']) {
    const mobile = await browser.newPage({ ...devices[device] })
    mobile.on('pageerror', (e) => errors.push(e.message))
    const scripts = []
    mobile.on('request', (r) => scripts.push(r.url()))
    await mobile.goto(origin + '/studio')
    await mobile.getByRole('button', { name: '멘탈 사우나', exact: true }).tap()
    await mobile.locator('.ui-pin--event').first().tap()
    await mobile.getByRole('link', { name: '행사 자세히 보기' }).tap()
    assert.equal(await mobile.locator('h1').innerText(), '멘탈 사우나')
    assert.ok(!scripts.some((u) => /\/assets\/studio-/.test(u)))
    await mobile.goto(origin)
    await mobile.getByRole('button', { name: '운동회', exact: true }).tap()
    await mobile.getByRole('button', { name: '행사 원문', exact: true }).tap()
    assert.equal(
      await mobile
        .getByRole('link', { name: '링크 열기' })
        .getAttribute('href'),
      external.action.url,
    )
    const { width, height } = mobile.viewportSize()
    await mobile.setViewportSize({ width: height, height: width })
    await mobile.getByRole('button', { name: '닫기', exact: true }).tap()
    await mobile.getByRole('button', { name: '확대', exact: true }).tap()
    await mobile.getByRole('button', { name: '전체 공간', exact: false }).tap()
    await mobile.route('**/api/world/*', (r) => r.abort())
    await mobile.goto(origin + '/events')
    assert.equal(await mobile.locator('.event-card').count(), 2)
    await mobile.close()
  }
  assert.deepEqual(errors, [])
  console.log(
    'PC 복제·옵션·자동 저장·재접속·미리보기·발행, 모바일 행사 탐색, 접근 권한 확인',
  )
} finally {
  await browser?.close()
  const ended = once(server, 'exit')
  server.kill()
  await ended
  fs.rmSync(root, { recursive: true, force: true })
}
