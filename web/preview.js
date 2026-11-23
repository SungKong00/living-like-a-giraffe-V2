import { api, button, el, zoomButtons, stage } from './ui.js'
import { openLayoutPreview, openVisitorScene } from './scene.js'
export function previewLayout(saved, layout) {
  return showPreview({ ...saved, layout }, '배치 미리보기', openLayoutPreview)
}

export async function previewCandidate(candidate, choices) {
  const state = await api('admin/candidate/' + candidate.model)
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
  return showPreview(state, '제작본 검토', openLayoutPreview)
}

export async function previewReview(id, afterPublication) {
  const state = await api('admin/reviews/' + id)
  return showPreview(
    state,
    '구운 결과 · 비공개',
    openVisitorScene,
    async () => {
      await api('admin/reviews/' + id + '/publish', 'POST')
      await afterPublication()
    },
  )
}

async function showPreview(state, title, open, approve) {
  const modal = el('dialog', { class: 'preview', 'aria-label': title }),
    target = stage(),
    summary = el('div', { class: 'preview-note' })
  const close = button('닫기', () => modal.close())
  const all = button('전체 공간', () => viewer?.selectRoom(null))
  const publish =
    approve &&
    button(
      '이 결과 공개',
      async () => {
        publish.disabled = true
        try {
          await approve()
          modal.close()
        } catch (error) {
          summary.textContent = error.message
          publish.disabled = false
        }
      },
      'primary',
    )
  if (publish) publish.disabled = true
  modal.append(
    el(
      'div',
      { class: 'studio-bar' },
      el('strong', {}, title),
      ...zoomButtons((factor) => viewer?.zoom(factor)),
      all,
      publish,
      close,
    ),
    target.host,
    summary,
  )
  document.body.append(modal)
  modal.showModal()
  let viewer
  function disposeViewer() {
    viewer?.dispose()
    viewer = undefined
  }
  modal.onclose = () => {
    disposeViewer()
    modal.remove()
  }
  try {
    viewer = await open(target, state, {
      onReady: () => {
        if (publish && modal.open) publish.disabled = false
      },
      onSpot: (s) => {
        const page = state.layout.pages.find((p) => p.id === s.action.page)
        summary.textContent =
          s.label + ' · ' + (page?.summary || s.action.url || '연결 확인 필요')
      },
    })
    if (!modal.open) disposeViewer()
  } catch (e) {
    modal.close()
    throw e
  }
}
