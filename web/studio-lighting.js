import { lightingInput } from '../shared/lighting-input.mjs'
import { api } from './ui.js'
import { el, StatusText, Button } from './ds/index.js'

// The editor owns interaction and its camera throughout. A request can install
// its result only while it still owns the current appearance.
export function automaticLighting({ editView, editor, flush, revision }) {
  const status = el('div', {
    class: 'studio-viewport__lighting',
    role: 'status',
  })
  const host = el('div', { class: 'studio-viewport' }, editView.host, status)
  let timer, pending, requested, retained, latest
  function display(state, label) {
    status.removeAttribute('title')
    host.dataset.lighting = state
    status.replaceChildren(StatusText({ label, pulse: state === 'pending' }))
  }
  function cancel() {
    clearTimeout(timer)
    pending?.abort()
    pending = null
    requested = null
  }
  function live() {
    cancel()
    editor()?.showBaked(false)
    display('live', '실시간 조명')
  }
  function settle(layout) {
    latest = layout
    const world = editor()
    if (!world) return
    const key = JSON.stringify(lightingInput(layout))
    if (key === requested) return
    live()
    requested = key
    if (key === retained) {
      world.showBaked(true)
      display('baked', '구운 조명')
      return
    }
    const controller = new AbortController()
    pending = controller
    const { signal } = controller
    timer = setTimeout(async () => {
      try {
        display('pending', '조명 준비 중')
        await flush()
        signal.throwIfAborted()
        const state = await api(
          'admin/lighting',
          'POST',
          { revision: revision() },
          signal,
        )
        signal.throwIfAborted()
        await world.loadBaked(state.asset, signal)
        signal.throwIfAborted()
        retained = key
        world.showBaked(true)
        display('baked', '구운 조명')
      } catch (error) {
        if (signal.aborted) return
        requested = null
        display('error', '실시간 조명 · 굽기 실패')
        status.append(
          Button({
            label: '다시 시도',
            size: 'sm',
            onClick: () => settle(latest),
          }),
        )
        status.title = error.message
      }
    }, 1100)
  }
  addEventListener('pagehide', cancel, { once: true })
  return Object.freeze({ host, live, settle })
}
