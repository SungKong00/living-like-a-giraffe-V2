import { api, button, el, zoomButtons, stage } from './ui.js'
import { createScene } from './scene.js'
export async function preview(
  saved,
  layout,
  candidate,
  choices,
  candidateView = false,
) {
  const state = candidateView
    ? await api('admin/candidate/' + candidate.model)
    : { ...saved, layout }
  if (candidateView)
    for (const c of candidate.conflicts) {
      if (!choices[c.key]) continue
      const [id, prop] = c.key.split('.')
      const val = c[choices[c.key]],
        item = state.layout.items.find((i) => i.id === id)
      if (prop && item) item[prop] = val
      else if (!prop) {
        state.layout.items = state.layout.items.filter((i) => i.id !== id)
        if (val) state.layout.items.push(val)
      }
    }
  const modal = el('dialog', { class: 'preview' }),
    target = stage(),
    summary = el('div', { class: 'preview-note' })
  const close = button('닫기', () => modal.close())
  const all = button('전체 공간', () => viewer?.selectRoom(null))
  modal.append(
    el(
      'div',
      { class: 'studio-bar' },
      el('strong', {}, candidateView ? '제작본 검토' : '방문자 미리보기'),
      ...zoomButtons((factor) => viewer?.zoom(factor)),
      all,
      close,
    ),
    target.host,
    summary,
  )
  document.body.append(modal)
  modal.showModal()
  let viewer
  modal.onclose = () => {
    viewer?.dispose()
    modal.remove()
  }
  try {
    viewer = await createScene(target, state, {
      preview: true,
      onSpot: (s) => {
        const page = state.layout.pages.find((p) => p.id === s.action.page)
        summary.textContent =
          s.label + ' · ' + (page?.summary || s.action.url || '연결 확인 필요')
      },
    })
    if (!modal.open) viewer.dispose()
  } catch (e) {
    modal.close()
    throw e
  }
}
