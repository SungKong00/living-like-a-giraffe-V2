import assert from 'node:assert/strict'

// Draws a route for a walking giraffe in the studio, turns a point into a
// stop with a motion, plays it and opens the visitor preview with it.
export async function checkCharacterRoute(page, origin) {
  const saved = () => page.locator('[data-save-state="saved"]').waitFor()
  const character = async () =>
    (await (await page.request.get(origin + '/api/admin/draft')).json()).layout
      .characters?.[0]
  await page.getByRole('button', { name: '추가', exact: true }).click()
  await page.getByRole('menuitem', { name: /두발 점토 기린/ }).click()
  await page.keyboard.press('Escape')
  const draw = page.getByRole('button', { name: '경로 그리기' })
  await draw.waitFor()
  await saved()
  assert.equal((await character()).route, undefined)

  // The new character is framed, so the floor around the middle of the
  // scene belongs to its room.
  const box = await page.locator('.studio-viewport canvas').boundingBox()
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await draw.click()
  await page.getByText('방 바닥을 눌러 지점을 더하세요').waitFor()
  await page.mouse.move(center.x + 60, center.y + 30)
  await page.mouse.click(center.x + 60, center.y + 30)
  await page.mouse.move(center.x - 20, center.y + 70)
  await page.mouse.click(center.x - 20, center.y + 70)
  // Escape drops the points; the draft never saw them.
  await page.keyboard.press('Escape')
  await draw.waitFor()
  assert.equal((await character()).route, undefined)

  await draw.click()
  await page.mouse.click(center.x + 60, center.y + 30)
  await page.mouse.click(center.x - 20, center.y + 70)
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: '경로 재생' }).waitFor()
  await saved()
  const drawn = (await character()).route
  assert.equal(drawn.points.length, 3)
  assert.deepEqual(drawn.points[0], { at: [0, 0] })
  assert.equal(drawn.walk, 'riragi-biped/두 발 걷기')
  assert.ok(drawn.points.slice(1).every((p) => Math.hypot(...p.at) > 0.2))
  // The walk's own pace: no speed is stored until the operator sets one.
  assert.equal(drawn.speed, undefined)
  await page.getByText(/지점 3개 · 한 바퀴 [\d.]+초/).waitFor()

  // Point 2 stops, plays a motion twice and leaves at once.
  const kind = page.getByRole('radiogroup', { name: '2번 지점에서 할 일' })
  await kind.getByRole('radio', { name: '멈추기' }).click()
  await saved()
  assert.deepEqual((await character()).route.points[1].stop, { wait: 1 })
  await page
    .getByLabel('2번 지점 동작', { exact: true })
    .selectOption({ label: '두발 점토 기린 · 두 발 걷기' })
  const repeat = page.getByLabel('2번 지점 동작 반복 횟수')
  await repeat.fill('2')
  await repeat.press('Tab')
  const wait = page.getByLabel('2번 지점 대기 시간')
  await wait.fill('0')
  await wait.press('Tab')
  await saved()
  assert.deepEqual((await character()).route.points[1].stop, {
    motion: 'riragi-biped/두 발 걷기',
    repeat: 2,
  })
  await page.getByText('2번 지점 · 멈추기 · 두 발 걷기 ×2').waitFor()
  await page
    .getByRole('radiogroup', { name: '경로 반복 방식' })
    .getByRole('radio', { name: '왕복' })
    .click()
  await saved()
  assert.equal((await character()).route.mode, 'pingpong')

  // Selected, it stands at its first point; playing walks it and the
  // portrait follows the moving pose.
  const portrait = () =>
    page.evaluate(() =>
      document.querySelector('.ui-object-preview').toDataURL(),
    )
  const still = await portrait()
  await page.waitForTimeout(400)
  assert.equal(await portrait(), still)
  await page.getByRole('button', { name: '경로 재생' }).click()
  await page.getByRole('button', { name: '처음으로' }).waitFor()
  await page.waitForFunction(
    (image) =>
      document.querySelector('.ui-object-preview').toDataURL() !== image,
    still,
  )
  await page.getByRole('button', { name: '처음으로' }).click()
  await page.getByRole('button', { name: '경로 재생' }).waitFor()

  // Removing a point keeps the route; undo brings the point back.
  await page.getByRole('button', { name: '3번 지점 지우기' }).click()
  await saved()
  assert.equal((await character()).route.points.length, 2)
  await page
    .locator('.studio-bar')
    .getByRole('button', { name: '되돌리기', exact: true })
    .click()
  await saved()
  assert.equal((await character()).route.points.length, 3)

  // The visitor preview reads the route's clips and walks it.
  await page.getByRole('button', { name: '미리보기', exact: true }).click()
  const preview = page.getByRole('dialog', { name: '배치 미리보기' })
  await preview.waitFor()
  await page.waitForTimeout(1500)
  await preview.getByRole('button', { name: '닫기' }).click()

  await page.getByRole('button', { name: '경로 지우기' }).click()
  await saved()
  assert.equal((await character()).route, undefined)
  await page.getByRole('button', { name: '캐릭터 삭제' }).click()
  await saved()
}

// The published world shows the walking giraffe to visitors: it walks while
// its room or the whole world is in view and stands still while the visitor
// looks at another room.
export async function checkPublishedRoute(browser, origin, errors) {
  const world = await (await fetch(origin + '/api/world')).json()
  assert.equal(world.layout.characters[0].route.points.length, 3)
  assert.deepEqual(world.characters.files, ['riragi-biped'])
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } })
  page.on('pageerror', (e) => errors.push(e.message))
  const model = page.waitForResponse((r) =>
    r.url().endsWith('/api/world/characters/riragi-biped.glb'),
  )
  await page.goto(origin)
  assert.equal((await model).status(), 200)
  const canvas = page.locator('canvas').first()
  const room = (name) =>
    page.getByRole('button', { name, exact: true }).first().click()
  // Frames keep changing while the giraffe walks and settle when it stops.
  const changing = async () => {
    const before = await canvas.screenshot()
    await page.waitForTimeout(400)
    return !before.equals(await canvas.screenshot())
  }
  const until = async (moving, what) => {
    for (let i = 0; i < 25; i++) if ((await changing()) === moving) return
    assert.fail(what)
  }
  await room('운동회')
  await until(true, '공개한 캐릭터가 자기 방에서 경로를 걷지 않습니다')
  await page.getByRole('button', { name: '전체 공간' }).click()
  await room('멘탈 사우나')
  await until(false, '다른 방을 보는 동안에도 캐릭터가 움직입니다')
  await page.getByRole('button', { name: '전체 공간' }).click()
  await room('운동회')
  await until(true, '방으로 돌아와도 캐릭터가 다시 걷지 않습니다')
  await page.close()
}
