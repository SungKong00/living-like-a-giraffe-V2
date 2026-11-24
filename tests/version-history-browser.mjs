import assert from 'node:assert/strict'

export async function checkVersionHistory(page, origin) {
  const read = async (route) =>
    (await page.request.get(origin + '/api/' + route)).json()
  const draft = await read('admin/draft')
  const published = await read('world')
  const open = () =>
    page.getByRole('button', { name: '버전 기록', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '버전 기록' })
  const button = (name) => dialog.getByRole('button', { name })
  await open()
  await button('이름 붙여 저장').click()
  await dialog
    .getByRole('textbox', { name: '버전 이름' })
    .fill('벤치 배치 시안')
  await dialog.getByRole('button', { name: '저장', exact: true }).click()
  await button(/벤치 배치 시안/).waitFor()
  await button(/벤치 배치 시안/).click()
  await dialog.getByRole('button', { name: '닫기' }).click()
  assert.equal((await read('admin/draft')).id, draft.id)

  const bench = draft.layout.items[0]
  await page
    .locator('.ui-tree-item__main')
    .filter({ hasText: bench.label })
    .first()
    .click()
  const field = page.getByLabel('이름', { exact: true })
  await field.fill('복원 전 시험용 벤치')
  await field.press('Tab')
  // Opening the history also flushes the pending autosave.
  await open()
  await button(/편집 시작 전/).waitFor()
  await dialog.getByRole('button', { name: '멘탈 사우나', exact: true }).click()
  const canvas = await dialog.locator('canvas').elementHandle()
  await button(/벤치 배치 시안/).click()
  await dialog
    .locator('button:enabled')
    .filter({ hasText: '초안으로 복원' })
    .waitFor()
  assert.ok(await canvas.evaluate((node) => node.isConnected))
  await canvas.dispose()
  const edited = await read('admin/draft')
  assert.equal(edited.layout.items[0].label, '복원 전 시험용 벤치')
  await button('초안으로 복원').click()
  await dialog.waitFor({ state: 'detached' })
  await page.waitForFunction(
    () => performance.getEntriesByName('riragi-world-ready').length,
  )
  const restored = await read('admin/draft')
  assert.notEqual(restored.id, draft.id)
  assert.deepEqual(restored.layout, draft.layout)
  assert.equal((await read('world')).id, published.id)
  const records = await read('admin/versions')
  assert.equal(records.filter((r) => r.kind === 'day').length, 1)
  const previous = records.find((r) => r.kind === 'restore')
  assert.deepEqual(
    (await read('admin/versions/' + previous.id)).layout,
    edited.layout,
  )
}
