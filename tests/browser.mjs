import { checkVersionHistory } from './version-history-browser.mjs'
import { checkLightHandles, turnLightHandle } from './light-handles.mjs'
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
  const desktop = await browser.newContext({
    viewport: { width: 1280, height: 850 },
  })
  const page = await desktop.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  for (const [method, route] of [
    ['PUT', 'draft'],
    ['GET', 'versions'],
    ['POST', 'versions'],
    ['GET', 'versions/test'],
    ['POST', 'versions/test/restore'],
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
  const worldPanel = page.getByRole('heading', { name: '월드', exact: true })
  async function expectWorld() {
    await worldPanel.waitFor()
    assert.equal(await tree('월드').getAttribute('aria-current'), 'true')
  }
  await expectWorld()
  await page.getByRole('button', { name: /리라지 점토 기린/ }).waitFor()
  const draftId = async () =>
    (await (await page.request.get(origin + '/api/admin/draft')).json()).id
  await checkVersionHistory(page, origin)
  const initialId = await draftId()
  const pins = page.locator('.stage__markers .ui-pin--event')
  const pinPositions = () =>
    pins.evaluateAll((nodes) => nodes.map((n) => [n.style.left, n.style.top]))
  await tree('나무 벤치').click()
  await page.getByLabel('이름', { exact: true }).waitFor()
  const benchView = await pinPositions()
  assert.ok(benchView.some(([x, y]) => x && y))
  await page.keyboard.press('Escape')
  await expectWorld()
  assert.deepEqual(await pinPositions(), benchView)
  await tree('나무 벤치').click()
  await page.getByLabel('이름', { exact: true }).waitFor()
  await page
    .getByLabel('장면 목록')
    .getByRole('list')
    .click({ position: { x: 2, y: 2 } })
  await expectWorld()
  await tree('나무 벤치').click()
  await page.getByRole('button', { name: '전체 보기', exact: true }).click()
  await page
    .locator('.studio-viewport canvas')
    .click({ position: { x: 8, y: 8 } })
  await expectWorld()
  assert.equal(await draftId(), initialId)
  const boil = page.getByRole('button', { name: '꿈틀거림', exact: true })
  const amount = page.getByRole('slider', { name: '꿈틀거림 전체 강도' })
  assert.equal(await boil.getAttribute('aria-pressed'), 'false')
  await boil.click()
  await amount.press('End')
  await boil.click()
  await saved()
  const motionDraft = await page.request
    .get(origin + '/api/admin/draft')
    .then((r) => r.json())
  assert.deepEqual(motionDraft.layout.defaults.clayMotion, {
    enabled: false,
    strength: 100,
    style: 'surface',
    hatch: 0,
  })
  await boil.click()
  assert.equal(await amount.inputValue(), '100')
  // Restore the seed before the remaining publication checks.
  const undoMotion = page.getByRole('button', { name: '되돌리기', exact: true })
  for (let i = 0; i < 4; i++) await undoMotion.click()
  await saved()
  const portrait = page.getByRole('img', { name: '선택 모델 미리보기' })
  const pixelsChanged = (before) =>
    page.waitForFunction(
      (image) =>
        document.querySelector('.ui-object-preview').toDataURL() !== image,
      before,
    )
  async function checkOrbit() {
    await saved()
    const draft = () =>
      page.request.get(origin + '/api/admin/draft').then((r) => r.json())
    const before = await draft()
    const image = () => portrait.evaluate((c) => c.toDataURL())
    const initial = await image()
    const box = await portrait.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.72, box.y + box.height * 0.6, {
      steps: 4,
    })
    await page.mouse.up()
    await pixelsChanged(initial)
    const turned = await image()
    await portrait.press('ArrowRight')
    await pixelsChanged(turned)
    assert.equal(
      await page.locator('[data-save-state]').getAttribute('data-save-state'),
      'saved',
    )
    assert.equal((await draft()).id, before.id)
  }
  // Adding from the library replaces the stand-in as soon as the rig loads.
  await page.getByRole('button', { name: '추가', exact: true }).click()
  await page.getByRole('menuitem', { name: /리라지 점토 기린/ }).click()
  await page.keyboard.press('Escape')
  await page.getByRole('slider', { name: '목 길이' }).waitFor()
  await tree('나무 벤치').click()
  await tree('리라지 점토 기린').click()
  await portrait.waitFor()
  const hasModel = () =>
    page.waitForFunction(() => {
      const c = document.querySelector('.ui-object-preview')
      const pixels = c
        .getContext('2d')
        .getImageData(0, 0, c.width, c.height).data
      return pixels.some((v, i) => i % 4 === 0 && Math.abs(v - pixels[0]) > 20)
    })
  await hasModel()
  await checkOrbit()
  // Turning the placed giraffe can change its lighting, but the portrait
  // should still show the same silhouette from the chosen orbit angle.
  const silhouette = () =>
    portrait.evaluate((c) => {
      const rgb = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
      let mask = ''
      for (let i = 0; i < rgb.length; i += 4) {
        const contrast = Math.max(
          Math.abs(rgb[i] - rgb[0]),
          Math.abs(rgb[i + 1] - rgb[1]),
          Math.abs(rgb[i + 2] - rgb[2]),
        )
        mask += contrast > 12 ? '1' : '0'
      }
      return mask
    })
  const beforeYaw = await silhouette()
  await page.getByRole('slider', { name: '캐릭터 방향' }).press('End')
  await saved()
  const turnedDraft = await page.request
    .get(origin + '/api/admin/draft')
    .then((r) => r.json())
  assert.equal(Math.abs(turnedDraft.layout.characters[0].yaw), 180)
  const afterYaw = await silhouette()
  let changedArea = 0,
    modelArea = 0
  for (let i = 0; i < beforeYaw.length; i++) {
    if (beforeYaw[i] !== afterYaw[i]) changedArea++
    if (beforeYaw[i] === '1') modelArea++
  }
  assert.ok(
    changedArea < modelArea * 0.035,
    '배치 방향을 바꿔도 같은 면이 보여야 합니다',
  )
  const beforeShape = await portrait.evaluate((c) => c.toDataURL())
  await page.getByRole('slider', { name: '목 길이' }).press('End')
  await pixelsChanged(beforeShape)
  await page.getByRole('button', { name: '캐릭터 삭제' }).click()
  await expectWorld()
  await saved()
  await tree('월드').click()
  await checkLightHandles(page, origin, 'Large_softbox', true)
  await tree('Large_softbox').click()
  const output = page.getByLabel('정확한 조명 출력')
  assert.ok(Number(await output.inputValue()) > 10000)
  await output.fill('17300')
  await output.press('Tab')
  await page.getByLabel('조명 위치 Y').fill('18')
  await page.getByLabel('조명 위치 Y').press('Tab')
  await saved()
  const nativeDraft = await page.request
    .get(origin + '/api/admin/draft')
    .then((r) => r.json())
  const native = nativeDraft.sourceLights.find(
    (l) => l.label === 'Large_softbox',
  )
  assert.equal(nativeDraft.layout.sourceLights[0].id, native.id)
  assert.equal(nativeDraft.layout.sourceLights[0].position[1], 18)
  assert.equal(nativeDraft.layout.sourceLights[0].energy, 17300)
  const canvasBox = await page.locator('.studio-viewport canvas').boundingBox()
  for (const action of ['위치 지정', '비출 곳 지정']) {
    await page.getByRole('button', { name: action, exact: true }).click()
    await page.getByRole('button', { name: '지정 취소' }).waitFor()
    // Aim beside the new position: the original softbox already points straight down.
    const offsets =
      action === '위치 지정' ? [0, -60, 60, -110, 110] : [85, -85, 140, -140]
    for (const offset of offsets) {
      await page.mouse.click(
        canvasBox.x + canvasBox.width / 2 + offset,
        canvasBox.y + canvasBox.height / 2,
      )
      await page.evaluate(
        () =>
          new Promise((done) =>
            requestAnimationFrame(() => requestAnimationFrame(done)),
          ),
      )
      if (await page.getByRole('button', { name: action, exact: true }).count())
        break
    }
    await page.getByRole('button', { name: action, exact: true }).waitFor()
    await saved()
  }
  const moved = (
    await page.request.get(origin + '/api/admin/draft').then((r) => r.json())
  ).layout.sourceLights[0]
  assert.equal(moved.position[1], 18)
  assert.notEqual(moved.position[0], native.position[0])
  assert.equal(moved.rotation.length, 4)
  await page.getByRole('button', { name: '원본값 복원' }).click()
  await saved()
  assert.equal(
    (await page.request.get(origin + '/api/admin/draft').then((r) => r.json()))
      .layout.sourceLights,
    undefined,
  )
  await tree('월드').click()
  const addLight = async (kind) => {
    await page.getByRole('button', { name: '추가', exact: true }).click()
    await page.getByRole('menuitem', { name: new RegExp('^' + kind) }).click()
    await page.getByLabel('조명 이름').waitFor()
  }
  await addLight('면광원')
  const height = page.getByLabel('면광원 높이')
  await height.fill('3.5')
  await height.press('Tab')
  await page.getByRole('button', { name: '조명 켜기' }).click()
  await saved()
  let authored = await (
    await page.request.get(origin + '/api/admin/draft')
  ).json()
  assert.equal(authored.layout.lights[0].shape.height, 3.5)
  assert.equal(authored.layout.lights[0].enabled, false)
  await page.getByRole('button', { name: '조명 삭제' }).click()
  await addLight('스포트라이트')
  await saved()
  const spotBefore = (
    await page.request.get(origin + '/api/admin/draft').then((r) => r.json())
  ).layout
  await turnLightHandle(
    page,
    page.getByRole('button', { name: '조명 · 스포트라이트 1', exact: true }),
  )
  await saved()
  const spotTurned = (
    await page.request.get(origin + '/api/admin/draft').then((r) => r.json())
  ).layout
  assert.notDeepEqual(
    spotTurned.lights[0].shape.rotation,
    spotBefore.lights[0].shape.rotation,
  )
  assert.deepEqual(spotTurned.lights[0].position, spotBefore.lights[0].position)
  await page.locator('button[aria-label="되돌리기"]').click()
  await saved()
  await page.getByRole('button', { name: '비출 곳 지정' }).click()
  await page.getByRole('button', { name: '지정 취소' }).waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '비출 곳 지정' }).click()
  const stage = page.locator('.studio-viewport canvas')
  const rect = await stage.boundingBox()
  await page.mouse.click(
    rect.x + rect.width * 0.58,
    rect.y + rect.height * 0.58,
  )
  await page.getByRole('button', { name: '비출 곳 지정' }).waitFor()
  await saved()
  authored = await (await page.request.get(origin + '/api/admin/draft')).json()
  assert.ok(
    Math.abs(authored.layout.lights[0].shape.rotation[0] + Math.SQRT1_2) >
      0.001,
  )
  await page.getByRole('button', { name: '조명 삭제' }).click()
  await addLight('점광원')
  await saved()
  await checkLightHandles(page, origin, '점광원 1', false)
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
  const thumbnail = page.getByRole('img', { name: '선택 모델 미리보기' })
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
  await portrait.waitFor()
  await hasModel()
  await checkOrbit()
  const originalPortrait = await portrait.evaluate((c) => c.toDataURL())
  // A missing session must not discard the current selection or pending edits.
  await saved()
  await page.context().clearCookies()
  await page.getByLabel('이름', { exact: true }).fill('파란 벤치')
  await page.getByLabel('이름', { exact: true }).press('Tab')
  await inspecting('파란 벤치')
  const resume = page.getByRole('button', { name: '다시 로그인하고 저장' })
  await resume.waitFor()
  const unload = await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    return [
      event.defaultPrevented,
      document.querySelector('[data-save-state]').dataset.saveState,
    ]
  })
  assert.deepEqual(unload, [true, 'unauthorized'])
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
  // The same authenticated draft opens in a narrow desktop pane and a new tab.
  await page.setViewportSize({ width: 579, height: 850 })
  const reloadDraft = page.waitForResponse(origin + '/api/admin/draft')
  await page.reload()
  const stored = await (await reloadDraft).json()
  await tree('파란 벤치').click()
  const canvasBounds = await viewport.boundingBox()
  const outlineBounds = await page.getByLabel('장면 목록').boundingBox()
  assert.ok(canvasBounds.width > 500 && canvasBounds.height > 100)
  assert.ok(outlineBounds.y >= canvasBounds.y + canvasBounds.height - 1)
  const sibling = await desktop.newPage()
  const newTabDraft = sibling.waitForResponse(origin + '/api/admin/draft')
  await sibling.goto(origin + '/studio')
  assert.equal((await (await newTabDraft).json()).id, stored.id)
  await sibling.close()
  await page.setViewportSize({ width: 1280, height: 850 })
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
  await page.getByRole('tab', { name: '장면' }).click()
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
  if (server.exitCode === null && server.signalCode === null) {
    const ended = once(server, 'exit')
    server.kill()
    await ended
  }
  fs.rmSync(root, { recursive: true, force: true })
}
