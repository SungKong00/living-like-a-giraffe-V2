import { characterSheet } from '../shared/character-sheet.mjs'
import { api, stage, zoomControls } from './ui.js'
import { el, Button, Dialog, Badge } from './ds/index.js'
import { openLayoutPreview, openVisitorScene } from './scene.js'

export function previewLayout(saved, layout) {
  return showPreview(
    { ...saved, layout },
    {
      title: '배치 미리보기',
      description: '저장한 초안을 방문자 화면처럼 둘러봅니다.',
      open: openLayoutPreview,
    },
  )
}

export async function previewCandidate(candidate, choices) {
  const state = await api('admin/candidate/' + candidate.model, 'POST', {
    choices,
  })
  return showPreview(state, {
    title: '제작본 검토',
    description:
      '고른 값으로 합친 결과입니다. 아직 초안에 적용되지 않았습니다.',
    open: openLayoutPreview,
  })
}

export async function previewReview(id, afterPublication) {
  const state = await api('admin/reviews/' + id)
  return showPreview(state, {
    title: '구운 결과 · 비공개',
    description:
      '방문자에게 공개될 파일 그대로입니다. 방과 안내 표시를 눌러 확인하세요.',
    open: openVisitorScene,
    approve: async () => {
      await api('admin/reviews/' + id + '/publish', 'POST')
      await afterPublication()
    },
  })
}

async function showPreview(state, { title, description, open, approve }) {
  const target = stage()
  target.host.classList.add('preview-stage')
  const note = el('p', { class: 'preview-note', role: 'status' })
  let viewer
  const publish =
    approve &&
    Button({
      label: '이 결과 공개',
      variant: 'primary',
      icon: 'publish',
      disabled: true,
      onClick: async () => {
        publish.disabled = true
        try {
          await approve()
          dialog.close()
        } catch (error) {
          note.textContent = error.message
          publish.disabled = false
        }
      },
    })
  const dialog = Dialog({
    title,
    description,
    size: 'xl',
    flush: true,
    headerActions: [
      approve ? Badge({ label: '비공개', tone: 'warning', dot: true }) : null,
    ].filter(Boolean),
    children: [target.host, note],
    footer: [
      Button({
        label: '전체 공간',
        icon: 'fit',
        variant: 'ghost',
        onClick: () => viewer?.selectRoom(null),
      }),
      el('span', { class: 'dialog-spacer' }),
      publish,
    ].filter(Boolean),
    onClose: () => {
      viewer?.dispose()
      viewer = undefined
    },
  })
  target.host.append(
    zoomControls((f) => viewer?.zoom(f), { className: 'preview-zoom' }),
  )
  dialog.open()
  // Characters of the reviewed world, drawn from the library as it is now.
  let cast = null
  try {
    viewer = await open(target, state, {
      onReady: () => {
        if (publish && dialog.isOpen) publish.disabled = false
      },
      onRoom: (id) => cast?.focus(id),
      onPick: (owner) => !!cast?.pick(owner),
      onSpot: (s) => {
        const page = state.layout.pages.find((p) => p.id === s.action.page)
        note.textContent =
          s.label + ' · ' + (page?.summary || s.action.url || '연결 확인 필요')
      },
    })
    if (open === openLayoutPreview && state.layout.characters?.length) {
      const catalog = await api('admin/characters')
      state.characters = {
        ...characterSheet(state.layout, catalog),
        base: '/api/admin/characters/files/',
      }
    }
    if (state.characters && dialog.isOpen)
      cast = (await import('./visitor-characters.js')).visitorCharacters(
        viewer,
        state,
        {
          onPage: (page, c) => {
            const p = state.layout.pages.find((x) => x.id === page)
            note.textContent = c.label + ' · ' + (p?.summary || p?.title || '')
          },
        },
      )
    if (!dialog.isOpen) {
      viewer?.dispose()
      viewer = undefined
    }
  } catch (e) {
    dialog.close()
    throw e
  }
}
