import { api, stage, zoomControls } from './ui.js'
import {
  el,
  Button,
  Callout,
  Dialog,
  Field,
  FileList,
  TextInput,
  IconButton,
  renderKeepingFocus,
} from './ds/index.js'
import { openLayoutPreview } from './scene.js'
import { characterLayer } from './studio-characters.js'
import { clayLayer, updateStudioClay } from './studio-clay-layer.js'

const dates = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

export function openVersions({ flush, current, library }) {
  const list = el('div', { class: 'version-history__list' })
  let view, model, cast, clay, shown
  const viewport = el('div', { class: 'version-history__viewport' })
  const feedback = el('div', { role: 'status' }, '기록을 불러오는 중…')
  const nameSlot = el('div', {})
  const actions = el('div', { class: 'version-history__actions' })
  const sidebar = el(
    'aside',
    { class: 'version-history__sidebar' },
    nameSlot,
    list,
  )
  const dialog = Dialog({
    title: '버전 기록',
    size: 'xl',
    flush: true,
    children: [el('div', { class: 'version-history' }, viewport, sidebar)],
    footer: [feedback, el('span', { class: 'dialog-spacer' }), actions],
    onClose: () => {
      generation++
      viewer?.dispose()
    },
  })
  let versions = [],
    selected = null,
    generation = 0,
    viewer = null
  let loaded = false,
    writing = false,
    baseline
  const error = (message) =>
    feedback.replaceChildren(Callout({ tone: 'danger', message }))
  const active = (ticket) => dialog.isOpen && ticket === generation

  function buttons() {
    if (nameSlot.firstChild) return
    actions.replaceChildren(
      selected
        ? Button({
            label: '초안으로 복원',
            variant: 'primary',
            disabled: !loaded || writing || selected.revision === baseline.id,
            onClick: restore,
          })
        : Button({
            label: '이름 붙여 저장',
            icon: 'add',
            disabled: writing,
            onClick: nameForm,
          }),
    )
  }

  function rows() {
    const items = [
      {
        name: '현재 초안',
        icon: 'world',
        key: 'current',
        selected: !selected,
        onSelect: () => select(null),
      },
      ...versions.map((entry) => ({
        name: entry.title,
        icon: entry.kind === 'named' ? 'bookmark' : 'history',
        detail: dates.format(new Date(entry.createdAt)),
        key: entry.id,
        selected: entry.id === selected?.id,
        onSelect: () => select(entry),
      })),
    ]
    renderKeepingFocus(list, () => [FileList({ label: '저장한 버전', items })])
  }

  async function select(entry) {
    if (writing) return
    const ticket = ++generation
    selected = entry
    loaded = false
    nameSlot.replaceChildren()
    feedback.replaceChildren()
    if (view) view.loading.hidden = false
    rows()
    buttons()
    try {
      const state = entry ? await api('admin/versions/' + entry.id) : baseline
      if (!active(ticket)) return
      shown = state.layout
      if (viewer && model === state.model) {
        viewer.update(shown)
      } else {
        // Keep room, angle and zoom while comparing edits to the same model.
        // After a Blender replacement, open the saved version's own geometry.
        viewer?.dispose()
        viewer = null
        view = stage()
        view.host.classList.add('version-history__stage')
        viewport.replaceChildren(view.host)
        view.host.append(
          IconButton({
            icon: 'fit',
            label: '전체 공간',
            variant: 'secondary',
            className: 'version-history__fit',
            onClick: () => viewer?.selectRoom(null),
          }),
          zoomControls((factor) => viewer?.zoom(factor), {
            className: 'preview-zoom',
          }),
        )
        const world = await openLayoutPreview(view, state, {
          onSpot(spot) {
            const page = shown.pages.find((p) => p.id === spot.action.page)
            feedback.textContent =
              page?.summary || spot.action.url || spot.label
          },
        })
        if (!active(ticket)) {
          world.dispose()
          return
        }
        viewer = world
        model = state.model
        clay = clayLayer()
        cast = characterLayer(world, {
          onLoad: () => {
            if (dialog.isOpen && viewer === world) refreshLayers()
          },
        })
      }
      cast.setLibrary(state.characterLibrary ?? library())
      refreshLayers()
      view.loading.hidden = true
      loaded = true
      buttons()
    } catch (e) {
      if (active(ticket)) {
        viewer?.dispose()
        viewer = null
        if (view) view.loading.hidden = true
        error(e.message)
      }
    }
  }

  function refreshLayers() {
    cast.update(shown)
    updateStudioClay(clay, viewer, cast, shown)
    viewer.wake()
  }

  function nameForm() {
    const submit = Button({
      label: '저장',
      type: 'submit',
      variant: 'primary',
      size: 'sm',
      disabled: true,
    })
    const field = TextInput({
      label: '버전 이름',
      name: 'name',
      required: true,
      autocomplete: 'off',
      placeholder: '예: 조명 실험 전',
      validate: (value) =>
        value.trim().length > 80 ? '80자 이내로 입력하세요.' : null,
      onInput: (value) => {
        submit.disabled = !value.trim() || value.trim().length > 80
      },
    })
    const cancel = () => {
      nameSlot.replaceChildren()
      buttons()
      actions.firstElementChild?.focus()
    }
    const form = el(
      'form',
      { class: 'version-history__form' },
      Field({ label: '버전 이름', control: field }),
      el(
        'div',
        { class: 'version-history__actions' },
        Button({
          label: '취소',
          size: 'sm',
          variant: 'ghost',
          onClick: cancel,
        }),
        submit,
      ),
    )
    form.onsubmit = async (event) => {
      event.preventDefault()
      if (writing || submit.disabled) return
      writing = true
      form.inert = true
      try {
        const entry = await api('admin/versions', 'POST', {
          revision: baseline.id,
          name: new FormData(form).get('name'),
        })
        if (!dialog.isOpen) return
        versions = [entry, ...versions.filter((v) => v.id !== entry.id)]
        cancel()
        rows()
        feedback.textContent = '버전을 저장했습니다.'
      } catch (e) {
        error(e.message)
      } finally {
        writing = false
        form.inert = false
        if (!nameSlot.firstChild) {
          buttons()
          actions.firstElementChild?.focus()
        }
      }
    }
    nameSlot.replaceChildren(form)
    actions.replaceChildren()
    field.querySelector('input').focus()
  }

  async function restore() {
    if (!loaded || writing || !selected) return
    writing = true
    buttons()
    dialog.element.inert = true
    const hold = (event) => event.preventDefault()
    dialog.element.addEventListener('cancel', hold)
    try {
      await api('admin/versions/' + selected.id + '/restore', 'POST', {
        revision: baseline.id,
      })
      location.reload()
    } catch (e) {
      writing = false
      dialog.element.inert = false
      dialog.element.removeEventListener('cancel', hold)
      error(e.message)
      buttons()
    }
  }

  async function open() {
    await flush()
    if (!dialog.isOpen) return
    baseline = current()
    versions = await api('admin/versions')
    if (dialog.isOpen) await select(null)
  }
  dialog.open()
  open().catch((e) => {
    if (dialog.isOpen) error(e.message)
  })
}
