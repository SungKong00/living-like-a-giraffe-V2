import assert from 'node:assert/strict'

// Room pins are projected from fixed world points every frame, so their
// screen places show how the camera moved. A pin at the side of the canvas
// is held inside it, so `free` leaves out pins near the left and right edge.
async function pins(scope) {
  const all = await scope.locator('.ui-pin--place').evaluateAll((nodes) =>
    nodes
      .filter((n) => !n.hidden)
      .map((n) => ({
        label: n.textContent.trim(),
        x: parseFloat(n.style.left),
        y: parseFloat(n.style.top),
        edge:
          parseFloat(n.style.left) < n.offsetWidth / 2 + 4 ||
          parseFloat(n.style.left) >
            n.parentElement.clientWidth - n.offsetWidth / 2 - 4,
      })),
  )
  return new Map(all.map((p) => [p.label, p]))
}

/** Reads the pins until `check(pins)` holds; fails with `what` otherwise. */
async function settled(scope, check, what) {
  let last
  for (let i = 0; i < 40; i++) {
    last = await pins(scope)
    if (check(last)) return last
    await scope.page().waitForTimeout(50)
  }
  assert.fail(what + ' ' + JSON.stringify([...last.values()]))
}

const shifted = (before, dx, dy) => (now) => {
  let compared = 0
  for (const [label, a] of before) {
    const b = now.get(label)
    if (!b) return false
    if (Math.abs(b.y - a.y - dy) > 1.5) return false
    if (a.edge || b.edge) continue
    if (Math.abs(b.x - a.x - dx) > 1.5) return false
    compared++
  }
  return compared >= 2
}

/** A point of the canvas that nothing covers, as page coordinates. */
async function openPoint(canvas, candidates) {
  const box = await canvas.boundingBox()
  for (const [fx, fy] of candidates) {
    const point = { x: box.x + box.width * fx, y: box.y + box.height * fy }
    if (
      await canvas.evaluate(
        (node, p) => document.elementFromPoint(p.x, p.y) === node,
        point,
      )
    )
      return point
  }
  assert.fail('캔버스에서 가려지지 않은 자리를 찾지 못했습니다')
}

async function mouseDrag(page, from, dx, dy) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 6 })
  await page.mouse.up()
}

/**
 * Dragging moves every pin by the pointer's travel: the floor follows the
 * pointer and the direction of view stays. `scope` holds one scene.
 */
export async function checkPanKeepsDirection(scope) {
  const page = scope.page()
  const canvas = scope.locator('canvas').first()
  const start = await openPoint(canvas, [
    [0.5, 0.82],
    [0.3, 0.82],
    [0.7, 0.2],
  ])
  const before = await settled(scope, (now) => now.size >= 2, '방 표시가 없음')
  await mouseDrag(page, start, 70, -40)
  await settled(
    scope,
    shifted(before, 70, -40),
    '끌어도 화면이 포인터만큼 이동하지 않았습니다',
  )
  await mouseDrag(page, { x: start.x + 70, y: start.y - 40 }, -70, 40)
  await settled(
    scope,
    shifted(before, 0, 0),
    '되끌어도 처음 구도로 돌아오지 않았습니다',
  )
}

// The visitor camera only pans and zooms: dragging moves the view, a press
// still opens a room, the direction survives a room change and the view
// stops at the edge of the world.
export async function checkVisitorCamera(browser, origin, errors) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } })
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(origin)
  const stage = page.locator('.stage').first()
  const canvas = stage.locator('canvas').first()
  const back = page.getByRole('button', { name: '전체 공간' })
  const home = await settled(stage, (now) => now.size >= 2, '방 표시가 없음')
  await page.waitForTimeout(300)
  await checkPanKeepsDirection(stage)

  // A press under the tap threshold does not move the view and opens the
  // room below the pointer.
  const box = await canvas.boundingBox()
  const anchor = [...home.values()].find((p) => !p.edge)
  const onRoom = await openPoint(
    canvas,
    [14, 24, 40, 60].map((below) => [
      anchor.x / box.width,
      (anchor.y + below) / box.height,
    ]),
  )
  await page.mouse.move(onRoom.x, onRoom.y)
  await page.mouse.down()
  await page.mouse.move(onRoom.x + 3, onRoom.y + 2)
  await page.waitForTimeout(200)
  assert.ok(
    shifted(home, 0, 0)(await pins(stage)),
    '누르기만 했는데 화면이 움직였습니다',
  )
  await page.mouse.up()
  await back.waitFor()

  // Back in the overview the world is seen from the same direction.
  await back.click()
  await settled(
    stage,
    shifted(home, 0, 0),
    '방을 다녀온 뒤 보는 방향이나 자리가 달라졌습니다',
  )

  // The same press dragged past the threshold pans and opens nothing.
  await mouseDrag(page, onRoom, 40, 0)
  await settled(stage, shifted(home, 40, 0), '방 위에서 끌어도 이동하지 않음')
  assert.ok(await back.isHidden(), '끌었는데 방이 열렸습니다')
  await mouseDrag(page, { x: onRoom.x + 40, y: onRoom.y }, -40, 0)
  await settled(stage, shifted(home, 0, 0), '처음 구도로 돌아오지 않음')

  // Dragging one way stops when the edge of the world reaches the middle
  // of the screen, and the same limit holds after zooming.
  const from = { x: box.x + box.width / 2, y: box.y + box.height * 0.25 }
  const travel = box.height * 0.5
  const moves = []
  for (let i = 0; i < 10; i++) {
    const a = await pins(stage)
    await mouseDrag(page, from, 0, travel)
    await page.waitForTimeout(250)
    const b = await pins(stage)
    moves.push(b.get(anchor.label).y - a.get(anchor.label).y)
    if (Math.abs(moves.at(-1)) < 1) break
  }
  assert.ok(moves[0] > 50, '끌어도 화면이 이동하지 않았습니다 ' + moves)
  assert.ok(
    Math.abs(moves.at(-1)) < 1,
    '한 방향으로 계속 끌면 월드가 화면 밖으로 나갑니다 ' + moves,
  )
  await page.getByRole('button', { name: '확대', exact: true }).click()
  await page.waitForTimeout(250)
  const zoomed = await pins(stage)
  await mouseDrag(page, from, 0, travel)
  await page.waitForTimeout(250)
  assert.ok(
    shifted(zoomed, 0, 0)(await pins(stage)),
    '확대한 뒤에는 이동 범위를 넘어갑니다',
  )
  await page.close()
}

/** One finger dragged across a phone's screen moves the view with it. */
export async function checkTouchPan(page) {
  const stage = page.locator('.stage').first()
  const canvas = stage.locator('canvas').first()
  const before = await settled(stage, (now) => now.size >= 2, '방 표시가 없음')
  const start = await openPoint(canvas, [
    [0.5, 0.8],
    [0.5, 0.7],
    [0.3, 0.8],
  ])
  const session = await page.context().newCDPSession(page)
  const touch = (type, x, y) =>
    session.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y }],
    })
  await touch('touchStart', start.x, start.y)
  for (let i = 1; i <= 6; i++)
    await touch('touchMove', start.x - 10 * i, start.y - 5 * i)
  await touch('touchEnd')
  await settled(
    stage,
    (now) =>
      [...before].every(
        ([label, a]) => Math.abs(now.get(label).y - a.y + 30) <= 1.5,
      ),
    '한 손가락으로 끌어도 화면이 이동하지 않았습니다',
  )
  await session.detach()
}
