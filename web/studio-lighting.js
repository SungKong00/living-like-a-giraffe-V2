import { api, stage } from './ui.js'
import { el, Segmented, Spinner } from './ds/index.js'
import { openStudioLightingScene } from './scene.js'

// Owns only the private viewing surface. Publishing is a separate control.
export function lightingSwitcher({
  editView,
  editor,
  flush,
  revision,
  lock,
  fail,
}) {
  const host = el('div', { class: 'studio-viewport' })
  const switchSlot = el('div', { class: 'studio-viewport__switch' })
  host.append(editView.host, switchSlot)
  let mode = 'edit',
    sequence = 0,
    cached
  function drawSwitch() {
    switchSlot.replaceChildren(
      Segmented({
        label: '중앙 화면',
        value: mode,
        options: [
          { value: 'edit', label: '편집' },
          { value: 'light', label: '방문자 조명' },
        ],
        onChange: change,
      }),
    )
  }
  function showMode(next) {
    mode = next
    editView.host.inert = next === 'light'
    editView.host.hidden = next === 'light'
    lock(next === 'light')
    drawSwitch()
    switchSlot
      .querySelector('[aria-checked="true"]')
      .focus({ preventScroll: true })
  }
  let pendingView
  async function change(next) {
    const world = editor()
    if (!world) return
    const request = ++sequence
    pendingView?.host.remove()
    pendingView = null
    if (next === 'edit') {
      const pose =
        cached && !cached.view.host.hidden ? cached.scene.pose() : null
      if (cached) {
        cached.view.host.hidden = true
        cached.view.host.inert = true
        cached.view.host.remove()
      }
      showMode(next)
      if (pose) world.restorePose(pose)
      return
    }
    const pose = world.pose()
    showMode(next)
    const view = stage()
    pendingView = view
    view.loading.replaceChildren(Spinner(), '방문자 조명을 준비하는 중…')
    host.insertBefore(view.host, switchSlot)
    try {
      await flush()
      if (sequence !== request) return
      const state = await api('admin/lighting', 'POST', {
        revision: revision(),
      })
      if (sequence !== request) return
      // This view displays geometry only. Text and links need no new GPU resources.
      if (cached?.asset === state.asset) {
        view.host.remove()
        host.insertBefore(cached.view.host, switchSlot)
        cached.view.host.hidden = false
        cached.view.host.inert = false
      } else {
        if (cached) {
          cached.scene.dispose()
          cached.view.host.remove()
          cached = null
        }
        const scene = await openStudioLightingScene(view, state)
        if (sequence !== request) {
          scene.dispose()
          return
        }
        cached = { view, scene, asset: state.asset }
      }
      pendingView = null
      cached.scene.restorePose(pose)
    } catch (error) {
      if (sequence === request) {
        await change('edit')
        fail(error.message)
      }
    }
  }
  drawSwitch()
  return Object.freeze({
    host,
    get viewing() {
      return mode === 'light'
    },
  })
}
