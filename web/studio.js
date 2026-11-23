import './views/studio.css'
import { app, api, stage } from './ui.js'
import {
  el,
  renderKeepingFocus,
  Brand,
  Button,
  IconButton,
  ButtonGroup,
  TextInput,
  TextArea,
  NumberInput,
  Slider,
  Select,
  Segmented,
  SwatchPicker,
  Toggle,
  Field,
  StatusText,
  Callout,
  Kbd,
  EmptyState,
  toast,
  Popover,
  Menu,
  Tabs,
  TreeItem,
  ObjectPreview,
  PanelHeader,
  PanelSection,
  PropertyRow,
  Disclosure,
  Dialog,
  Toolbar,
  ToolbarDivider,
  Chip,
  ChipList,
  Icon,
} from './ds/index.js'
import { previewLayout } from './preview.js'
import { EditHistory } from './history.js'
import { aimShape, lightInspector, lightMenu } from './light-inspector.js'
import { lightKinds } from '../shared/studio-lights.mjs'
import { selectionPreview } from './selection-preview.js'
import { openEditorScene } from './scene.js'
import { Autosave } from './autosave.js'
import { attachCanvas } from './studio-canvas.js'
import { publishControl } from './studio-publish.js'
import { openHandoff } from './studio-handoff.js'
import * as ops from './edit-ops.js'

const newId = () => crypto.randomUUID()
const mac = /Mac|iPhone|iPad/.test(navigator.platform)
const cmd = mac ? '⌘' : 'Ctrl+'
const palette = [
  '#ac7958',
  '#6b4a35',
  '#d9c3a5',
  '#f2efe6',
  '#2f3b35',
  '#226655',
  '#884422',
  '#c94f3d',
  '#3d5a80',
  '#e0b44c',
]
const finishNames = { original: '원본', matte: '무광', gloss: '유광' }
const shortcuts = [
  ['끌기', '가구·안내 표시 옮기기'],
  ['Alt + 끌기', '복제하며 옮기기'],
  [cmd.replace('+', '') + ' + 끌기', '격자 맞춤 잠시 끄기'],
  ['빈 곳 끌기', '화면 이동'],
  ['오른쪽 끌기', '시점 회전'],
  ['휠', '확대·축소'],
  ['방향키', '0.25m 이동 (Shift 1m)'],
  ['Q / E', '15° 회전 (Shift 90°)'],
  [cmd + 'D', '복제'],
  ['Delete', '삭제'],
  ['F', '선택 대상으로 이동'],
  [cmd + 'Z', '되돌리기'],
  ['Esc', '끌기 취소·선택 해제'],
]
const saveStates = {
  saved: ['저장됨', 'success'],
  pending: ['저장 대기', 'neutral'],
  saving: ['저장 중…', 'warning'],
}

function keyForm(label, onLogin) {
  const error = el('div', { class: 'sign-in__error' })
  const submit = Button({
    label,
    type: 'submit',
    variant: 'primary',
    size: 'lg',
    wide: true,
  })
  const form = el(
    'form',
    { class: 'sign-in__fields' },
    Field({
      label: '관리자 키',
      control: TextInput({
        label: '관리자 키',
        name: 'key',
        type: 'password',
        autocomplete: 'current-password',
        required: true,
        size: 'lg',
      }),
    }),
    error,
    submit,
  )
  form.onsubmit = async (e) => {
    e.preventDefault()
    if (submit.disabled) return
    submit.disabled = true
    try {
      await api('login', 'POST', { key: new FormData(form).get('key') })
      form.reset()
      await onLogin()
    } catch (err) {
      error.replaceChildren(
        Callout({
          tone: 'danger',
          live: true,
          message:
            err.status === 403 ? '관리자 키가 맞지 않습니다.' : err.message,
        }),
      )
    } finally {
      submit.disabled = false
    }
  }
  return form
}

function login() {
  const form = keyForm('스튜디오 열기', studio)
  const card = el(
    'div',
    { class: 'sign-in__card' },
    el('span', { class: 'sign-in__icon' }, Icon('key', 'lg')),
    el(
      'div',
      { class: 'sign-in__heading' },
      el('h1', { class: 'sign-in__title' }, '월드 스튜디오'),
      el(
        'p',
        { class: 'sign-in__description' },
        '관리자 키로 들어가 공간 배치와 행사 페이지를 편집합니다.',
      ),
    ),
    form,
  )
  app.replaceChildren(el('section', { class: 'sign-in' }, card))
  form.querySelector('input').focus()
}

export async function studio() {
  let saved
  try {
    saved = await api('admin/draft')
  } catch (e) {
    if (e.status === 401) return login()
    throw e
  }
  document.body.dataset.surface = 'studio'
  const history = new EditHistory(saved.layout)
  const rooms = saved.rooms
  const kinds = saved.kinds || []
  let shown = history.value,
    selection = null,
    tab = 'layout',
    query = '',
    snapping = true,
    world = null,
    canvas = null
  const collapsed = new Set()
  let lightPick = null
  let axesOpen = false
  // Spot whose destination was switched to an external link that has not been
  // typed yet. Kept as state so a re-render does not hide the address field.
  let addressing = null

  // ---- Feedback ----
  function notify(message, undoable) {
    toast(
      message,
      undoable ? { action: { label: '되돌리기', onClick: () => undo() } } : {},
    )
  }
  const fail = (message) => toast(message, { tone: 'danger' })

  // ---- Top bar ----
  const saveStatus = el('div', { class: 'save-status' })
  const undoButton = IconButton({
    icon: 'undo',
    label: '되돌리기',
    shortcut: cmd + 'Z',
    onClick: () => undo(),
  })
  const redoButton = IconButton({
    icon: 'redo',
    label: '다시 실행',
    shortcut: cmd + '⇧Z',
    onClick: () => redo(),
  })

  // The server validates and reorders object fields. Compare successive local
  // submissions so flushing an unchanged preview never creates a new revision.
  let savedInput = JSON.stringify(history.value)
  const autosave = new Autosave({
    async save() {
      const layout = history.value
      const input = JSON.stringify(layout)
      if (input === savedInput) return
      saved = await api('admin/draft', 'PUT', { revision: saved.id, layout })
      savedInput = input
    },
    onState: (state) => {
      renderSave()
      // A stored draft can cancel a prepared review; ask the server once.
      if (state === 'saved') publish.refresh().catch(() => {})
    },
  })
  const flush = () => autosave.flush()
  const publish = publishControl({
    flush,
    revision: () => saved.id,
    onError: fail,
  })

  const top = el(
    'header',
    { class: 'studio-bar' },
    el(
      'div',
      { class: 'studio-bar__start' },
      Brand({ product: '스튜디오' }),
      el('span', { class: 'studio-bar__divider', 'aria-hidden': 'true' }),
      saveStatus,
      ButtonGroup({ label: '편집 기록', children: [undoButton, redoButton] }),
    ),
    el(
      'div',
      { class: 'studio-bar__end' },
      Button({
        label: '미리보기',
        icon: 'preview',
        variant: 'ghost',
        onClick: () =>
          previewLayout(saved, history.value).catch((e) => fail(e.message)),
      }),
      Button({
        label: 'Blender 인계',
        icon: 'handoff',
        variant: 'ghost',
        onClick: () =>
          openHandoff({
            flush,
            draft: () => history.value,
            rooms,
            onError: fail,
          }),
      }),
      publish.element,
    ),
  )

  // ---- Canvas chrome ----
  const view = stage()
  const helpButton = IconButton({
    icon: 'keyboard',
    label: '조작 방법',
    shortcut: '?',
  })
  const help = Popover({
    trigger: helpButton,
    label: '조작 방법',
    placement: 'top-end',
    width: 'md',
    content: () => [
      el('strong', { class: 'shortcut-list__title' }, '조작 방법'),
      el(
        'dl',
        { class: 'shortcut-list' },
        ...shortcuts.flatMap(([k, d]) => [
          el('dt', {}, Kbd(k)),
          el('dd', {}, d),
        ]),
      ),
    ],
  })
  const viewTools = Toolbar({
    label: '보기 도구',
    className: 'studio-viewbar',
    children: [
      Toggle({
        label: '격자 맞춤',
        icon: 'snap',
        pressed: snapping,
        hint: '0.25m 격자와 15° 단위에 맞춥니다',
        onChange: (on) => (snapping = on),
      }),
      ToolbarDivider(),
      IconButton({
        icon: 'fit',
        label: '전체 보기',
        onClick: () => world?.selectRoom(null),
      }),
      IconButton({
        icon: 'minus',
        label: '축소',
        onClick: () => world?.zoom(1 / 1.4),
      }),
      IconButton({
        icon: 'add',
        label: '확대',
        onClick: () => world?.zoom(1.4),
      }),
      ToolbarDivider(),
      help.element,
    ],
  })
  const hint = el(
    'p',
    { class: 'studio-hint' },
    el('span', {}, '가구를 끌어 옮기기'),
    el('span', {}, '빈 곳을 끌어 화면 이동'),
    el('span', {}, '오른쪽 버튼으로 시점 회전'),
  )
  const floating = Toolbar({
    label: '선택한 가구',
    appearance: 'inverse',
    className: 'float-tools',
    hidden: true,
    children: [
      IconButton({
        icon: 'copy',
        label: '복제',
        variant: 'inverse',
        shortcut: cmd + 'D',
        onClick: () => duplicate(),
      }),
      IconButton({
        icon: 'rotate-left',
        label: '왼쪽으로 회전',
        variant: 'inverse',
        shortcut: 'Q',
        onClick: () => rotate(-ops.ROTATE_STEP),
      }),
      IconButton({
        icon: 'rotate-right',
        label: '오른쪽으로 회전',
        variant: 'inverse',
        shortcut: 'E',
        onClick: () => rotate(ops.ROTATE_STEP),
      }),
      ToolbarDivider(),
      IconButton({
        icon: 'delete',
        label: '삭제',
        variant: 'danger',
        shortcut: 'Delete',
        onClick: () => remove(),
      }),
    ],
  })
  view.host.append(hint, viewTools)

  const outline = el('aside', {
    class: 'studio-outline',
    'aria-label': '장면 목록',
  })
  const inspector = el('aside', {
    class: 'studio-inspector',
    'aria-label': '속성',
  })
  const portrait = ObjectPreview({ label: '선택 오브젝트 미리보기' })
  const properties = el('div')
  inspector.append(portrait, properties)
  let projection
  const viewport = el('div', { class: 'studio-viewport' }, view.host)
  app.replaceChildren(
    el(
      'div',
      { class: 'studio' },
      top,
      el('div', { class: 'studio-body' }, outline, viewport, inspector),
    ),
  )

  function resumeSave() {
    const form = keyForm('로그인하고 저장', async () => {
      dialog.close()
      await flush().catch(() => {})
    })
    const dialog = Dialog({
      title: '다시 로그인',
      description: autosave.error,
      size: 'sm',
      children: [form],
    })
    dialog.open()
    form.querySelector('input').focus()
  }

  function renderSave() {
    const s = autosave.state
    saveStatus.dataset.saveState = s
    saveStatus.title = autosave.error || '편집하면 초안에 자동으로 저장됩니다.'
    if (saveStates[s]) {
      const [label, tone] = saveStates[s]
      saveStatus.replaceChildren(
        StatusText({ label, tone, pulse: s === 'saving' }),
      )
    } else {
      const [label, onClick] = {
        conflict: ['다른 창에서 변경됨 · 다시 열기', () => location.reload()],
        unauthorized: ['다시 로그인하고 저장', resumeSave],
        error: ['저장 실패 · 다시 시도', () => flush().catch(() => {})],
      }[s]
      saveStatus.replaceChildren(
        Button({
          label,
          icon: 'save-error',
          variant: 'danger',
          size: 'sm',
          onClick,
        }),
      )
    }
    if (s === 'error') fail('저장하지 못했습니다 · ' + autosave.error)
  }

  // Native color/range controls can finish at their starting value without a
  // change event. Restore the committed appearance when such a preview ends.
  let transient = false
  function finishTransient() {
    if (transient)
      setTimeout(() => {
        if (transient) apply()
      }, 0)
  }
  for (const event of ['pointerup', 'pointercancel', 'focusout', 'cancel'])
    properties.addEventListener(event, finishTransient, true)

  // ---- Edits ----
  function apply() {
    transient = false
    shown = history.value
    world?.update(shown)
    projection?.invalidate()
    if (selection && !exists(selection)) {
      selection = null
      setLightPick(null)
    }
    render()
  }
  function change(edit) {
    let result
    history.change((d) => (result = edit(d)))
    autosave.schedule()
    apply()
    return result
  }
  // Slider previews touch only the scene; the release records one edit.
  function preview(edit) {
    transient = true
    shown = history.value
    edit(shown)
    world?.update(shown)
    projection?.invalidate()
  }
  function undo() {
    history.undo()
    autosave.schedule()
    apply()
  }
  function redo() {
    history.redo()
    autosave.schedule()
    apply()
  }
  const listOf = {
    light: 'lights',
    item: 'items',
    spot: 'spots',
    page: 'pages',
  }
  function exists(sel) {
    if (sel.type === 'room') return rooms.some((r) => r.id === sel.id)
    return !!ops.find(shown, listOf[sel.type], sel.id)
  }
  function select(sel, { frame = false } = {}) {
    setLightPick(null)
    if (selection?.id !== sel?.id || selection?.type !== sel?.type)
      inspector.scrollTop = 0
    selection = sel
    if (sel?.type === 'page') tab = 'pages'
    else if (sel) tab = 'layout'
    if (frame && sel) canvas?.frame(sel)
    render()
  }
  const selectedItem = () =>
    selection?.type === 'item' && ops.find(shown, 'items', selection.id)
  const roomOf = (sel) => {
    if (!sel) return null
    if (sel.type === 'room') return sel.id
    if (sel.type === 'light') return ops.find(shown, 'lights', sel.id)?.room
    if (sel.type === 'item') return ops.find(shown, 'items', sel.id)?.room
    if (sel.type === 'spot') {
      const s = ops.find(shown, 'spots', sel.id)
      return ops.find(shown, 'items', s?.anchor)?.room || s?.anchor
    }
  }
  const roomName = (id) => rooms.find((r) => r.id === id)?.label || id

  function duplicate(id = selectedItem()?.id) {
    if (!id) return
    const copy = newId()
    change((d) => ops.duplicateItem(d, id, copy))
    select({ type: 'item', id: copy })
    notify('복제했습니다. 끌어서 원하는 곳에 놓으세요.')
  }
  function remove() {
    if (selection?.type === 'light') {
      change((d) => {
        d.lights = d.lights.filter((l) => l.id !== selection.id)
      })
      notify('조명을 삭제했습니다.', true)
    } else if (selection?.type === 'item') {
      const label = selectedItem().label
      const n = change((d) => ops.deleteItem(d, selection.id))
      notify(
        label +
          ' 삭제' +
          (n ? ' · 연결된 클릭 영역 ' + n + '개 함께 삭제' : ''),
        true,
      )
    } else if (selection?.type === 'spot') {
      change((d) => ops.deleteSpot(d, selection.id))
      notify('클릭 영역을 삭제했습니다.', true)
    } else if (selection?.type === 'page') removePage(selection.id)
  }
  function removePage(id) {
    const page = ops.find(shown, 'pages', id)
    const linked = shown.spots.filter((s) => s.action.page === id).length
    if (
      linked &&
      !confirm(
        '‘' +
          page.title +
          '’에 연결된 클릭 영역 ' +
          linked +
          '개도 함께 삭제됩니다. 계속할까요?',
      )
    )
      return
    change((d) => ops.deletePage(d, id))
    notify('페이지를 삭제했습니다.', true)
  }
  function rotate(deg, id = selectedItem()?.id) {
    if (!id) return
    change((d) => {
      const i = ops.find(d, 'items', id)
      i.rotation = ops.rotateBy(i.rotation, deg)
    })
  }
  function nudge(key, step) {
    const item = selectedItem()
    const axis = item && canvas?.screenAxis(item.room, key)
    if (!axis) return
    change((d) => {
      const i = ops.find(d, 'items', item.id)
      i.position = i.position.map((v, n) =>
        ops.clampPosition(v + axis[n] * step),
      )
    })
  }
  function addFurniture(kind, room = roomOf(selection) || rooms[0].id) {
    const id = newId()
    const def = kinds.find((k) => k.kind === kind)
    change((d) => ops.addItem(d, { id, kind, label: def?.label || kind, room }))
    select({ type: 'item', id }, { frame: true })
    notify(roomName(room) + '에 ' + (def?.label || kind) + '을(를) 놓았습니다.')
  }
  function addClickArea(anchor) {
    const id = newId()
    change((d) => {
      const page = d.pages[0] || ops.addPage(d, { id: newId() })
      ops.addSpot(d, { id, anchor, page })
    })
    select({ type: 'spot', id }, { frame: true })
  }
  function addPage() {
    const id = newId()
    change((d) => ops.addPage(d, { id }))
    select({ type: 'page', id })
  }
  function patch(list, id, values) {
    change((d) => Object.assign(ops.find(d, list, id), values))
  }

  // ---- Outline ----
  // Rebuilding identical panels can swallow a click whose press and release
  // land on different elements, so skip rebuilds when nothing changed.
  let outlineKey = '',
    inspectorKey = ''
  function renderOutline() {
    const key = JSON.stringify([tab, query, selection, shown, [...collapsed]])
    if (key === outlineKey) return
    outlineKey = key
    renderKeepingFocus(outline, () => [
      el(
        'div',
        { class: 'studio-outline__head' },
        Tabs({
          label: '목록',
          value: tab,
          items: [
            { id: 'layout', label: '배치' },
            { id: 'pages', label: '행사 페이지', count: shown.pages.length },
          ],
          onChange: (id) => {
            tab = id
            renderOutline()
          },
        }),
        ...(tab === 'layout' ? layoutTools() : pageTools()),
      ),
      el(
        'div',
        { class: 'studio-outline__list', role: 'list' },
        ...(tab === 'layout' ? layoutTree() : pageList()),
      ),
    ])
  }
  const isSelected = (sel) =>
    selection?.type === sel.type && selection.id === sel.id
  function row(sel, label, props = {}) {
    return TreeItem({
      label,
      key: sel.type + ':' + sel.id,
      selected: isSelected(sel),
      onSelect: () => select(sel, { frame: true }),
      ...props,
    })
  }
  function layoutTools() {
    const addButton = IconButton({
      icon: 'add',
      label: '가구 추가',
      variant: 'secondary',
      size: 'sm',
    })
    const menu = Menu({
      trigger: addButton,
      label: '가구 추가',
      heading: roomName(roomOf(selection) || rooms[0].id) + '에 추가',
      empty: '추가할 수 있는 가구 종류가 없습니다.',
      items: kinds.map((k) => ({
        label: k.label,
        icon: 'furniture',
        onSelect: () => addFurniture(k.kind),
      })),
    })
    return [
      el(
        'div',
        { class: 'studio-outline__tools' },
        TextInput({
          label: '가구·안내 찾기',
          placeholder: '가구·안내 찾기',
          type: 'search',
          icon: 'search',
          size: 'sm',
          key: 'search',
          value: query,
          onInput: (v) => {
            query = v
            renderOutline()
          },
        }),
        menu.element,
        lightMenu(
          roomName(roomOf(selection) || rooms[0].id),
          shown.lights?.length ?? 0,
          addLight,
        ),
      ),
    ]
  }
  function addLight(type) {
    const room = roomOf(selection) || rooms[0].id
    const id = newId(),
      kind = lightKinds[type]
    const item = selectedItem()
    const position = item
      ? [item.position[0], item.position[1] + 3, item.position[2]]
      : [0, 3, 0]
    const names = new Set((shown.lights ?? []).map((l) => l.label))
    let n = 1
    while (names.has(kind.label + ' ' + n)) n++
    collapsed.delete(room)
    query = ''
    change((d) =>
      (d.lights ??= []).push({
        id,
        room,
        label: kind.label + ' ' + n,
        position,
        energy: 500,
        color: '#ffffff',
        enabled: true,
        shape: kind.shape(),
      }),
    )
    select({ type: 'light', id }, { frame: true })
  }
  function setLightPick(mode) {
    if (lightPick === mode) return
    lightPick = mode
    view.host.classList.toggle('is-placing-light', !!mode)
    render()
  }
  function layoutTree() {
    const match = (label) =>
      !query || label.toLowerCase().includes(query.toLowerCase())
    return rooms
      .map((r) => {
        const items = shown.items.filter((i) => i.room === r.id)
        const roomSpots = shown.spots.filter((s) => s.anchor === r.id)
        const children = (shown.lights ?? [])
          .filter((l) => l.room === r.id && match(l.label))
          .map((l) =>
            row({ type: 'light', id: l.id }, l.label, {
              depth: 1,
              meta:
                l.enabled === false
                  ? '꺼짐'
                  : lightKinds[l.shape?.type ?? 'point'].label,
            }),
          )
        for (const i of items) {
          const spots = shown.spots.filter((s) => s.anchor === i.id)
          const shownSpots = spots.filter((s) => match(s.label))
          if (!match(i.label) && !shownSpots.length) continue
          children.push(
            row({ type: 'item', id: i.id }, i.label, {
              depth: 1,
              icon: 'furniture',
            }),
          )
          for (const s of match(i.label) ? spots : shownSpots)
            children.push(
              row({ type: 'spot', id: s.id }, s.label, {
                depth: 2,
                icon: 'spot',
              }),
            )
        }
        for (const s of roomSpots.filter((s) => match(s.label)))
          children.push(
            row({ type: 'spot', id: s.id }, s.label, {
              depth: 1,
              icon: 'spot',
            }),
          )
        if (query && !children.length && !match(r.label)) return null
        const open = !!query || !collapsed.has(r.id)
        return el(
          'div',
          { class: 'studio-outline__group', role: 'listitem' },
          row({ type: 'room', id: r.id }, r.label, {
            icon: 'room',
            meta: String(items.length),
            expanded: open,
            onToggle: () => {
              collapsed.has(r.id) ? collapsed.delete(r.id) : collapsed.add(r.id)
              renderOutline()
            },
          }),
          ...(open ? children : []),
        )
      })
      .filter(Boolean)
      .concat(
        query &&
          !shown.items.some((i) => match(i.label)) &&
          !shown.spots.some((s) => match(s.label))
          ? [
              EmptyState({
                title: '찾는 항목이 없습니다',
                description: '다른 이름으로 찾아보세요.',
              }),
            ]
          : [],
      )
  }
  function pageTools() {
    return [
      Button({
        label: '새 페이지',
        icon: 'add',
        size: 'sm',
        wide: true,
        key: 'add-page',
        onClick: addPage,
      }),
    ]
  }
  function pageList() {
    if (!shown.pages.length)
      return [
        EmptyState({
          icon: 'page',
          title: '행사 페이지가 없습니다',
          description: '새 페이지를 만들어 클릭 영역과 연결하세요.',
        }),
      ]
    return shown.pages.map((p) => {
      const n = shown.spots.filter((s) => s.action.page === p.id).length
      return row({ type: 'page', id: p.id }, p.title, {
        icon: 'page',
        meta: n ? '연결 ' + n : '연결 없음',
      })
    })
  }

  // ---- Inspector ----
  // Strategy: one builder per selection type. Add a type by adding a builder.
  const inspectors = {
    light: () => {
      const light = ops.find(shown, 'lights', selection.id)
      const set = (values) => patch('lights', light.id, values)
      return lightInspector(light, {
        rooms,
        picking: lightPick,
        pick: setLightPick,
        title: labelInput('조명 이름', light.label, (label) => set({ label })),
        set,
        preview: (values) =>
          preview((d) =>
            Object.assign(ops.find(d, 'lights', light.id), values),
          ),
        remove,
      })
    },
    item: () => itemInspector(ops.find(shown, 'items', selection.id)),
    spot: () => spotInspector(ops.find(shown, 'spots', selection.id)),
    page: () => pageInspector(ops.find(shown, 'pages', selection.id)),
    room: () => roomInspector(rooms.find((r) => r.id === selection.id)),
  }
  function renderInspector() {
    const key = JSON.stringify([
      selection,
      shown,
      axesOpen,
      addressing,
      lightPick,
    ])
    if (key === inspectorKey) return
    inspectorKey = key
    renderKeepingFocus(properties, () =>
      selection ? inspectors[selection.type]() : emptyInspector(),
    )
  }
  function emptyInspector() {
    return [
      EmptyState({
        icon: 'pointer',
        title: '편집할 대상을 선택하세요',
        description:
          '장면에서 가구나 안내 표시를 누르거나, 왼쪽 목록에서 고르세요.',
        children: [
          el(
            'ul',
            { class: 'studio-tips' },
            el(
              'li',
              {},
              Icon('furniture', 'sm'),
              '가구는 끌어서 옮기고 다른 방에 놓을 수 있습니다.',
            ),
            el(
              'li',
              {},
              Icon('copy', 'sm'),
              'Alt를 누른 채 끌면 복제하며 옮깁니다.',
            ),
            el(
              'li',
              {},
              Icon('saved', 'sm'),
              '변경은 초안에 자동 저장되고, 발행하기 전까지 방문자에게 보이지 않습니다.',
            ),
          ),
        ],
      }),
    ]
  }
  const labelInput = (label, value, commit) =>
    TextInput({
      appearance: 'title',
      key: 'label',
      label,
      value,
      validate: ops.labelError,
      onCommit: commit,
    })

  function itemInspector(i) {
    const allowed = saved.options?.[i.kind] || {
      colors: ['*'],
      finishes: ['original', 'matte', 'gloss'],
    }
    const set = (values) => patch('items', i.id, values)
    const yaw = ops.yawOf(i.rotation)
    const uniform = i.scale.every((v) => Math.abs(v - i.scale[0]) < 1e-6)
    const kindName = kinds.find((k) => k.kind === i.kind)?.label || i.kind
    const anyColor = allowed.colors.includes('*')
    return [
      PanelHeader({
        eyebrow: kindName,
        icon: 'furniture',
        title: labelInput('이름', i.label, (label) => set({ label })),
        actions: [
          IconButton({
            icon: 'copy',
            label: '복제',
            shortcut: cmd + 'D',
            key: 'duplicate',
            onClick: () => duplicate(i.id),
          }),
          IconButton({
            icon: 'delete',
            label: '삭제',
            variant: 'danger',
            shortcut: 'Delete',
            key: 'delete',
            onClick: () => remove(),
          }),
        ],
      }),
      PanelSection({
        title: '배치',
        children: [
          PropertyRow({
            label: '방',
            children: [
              Select({
                label: '방',
                key: 'room',
                size: 'sm',
                value: i.room,
                options: rooms.map((r) => ({ value: r.id, label: r.label })),
                onChange: (room) => {
                  change((d) => ops.moveToRoom(d, i.id, room))
                  canvas?.frame({ type: 'item', id: i.id })
                },
              }),
            ],
          }),
          PropertyRow({
            label: '위치',
            children: [
              NumberInput({
                label: '위치 X',
                prefix: 'X',
                key: 'x',
                value: i.position[0],
                onCommit: (v) =>
                  set({
                    position: [
                      ops.clampPosition(v),
                      i.position[1],
                      i.position[2],
                    ],
                  }),
              }),
              NumberInput({
                label: '위치 Z',
                prefix: 'Z',
                key: 'z',
                value: i.position[2],
                onCommit: (v) =>
                  set({
                    position: [
                      i.position[0],
                      i.position[1],
                      ops.clampPosition(v),
                    ],
                  }),
              }),
            ],
          }),
          PropertyRow({
            label: '높이',
            children: [
              NumberInput({
                label: '높이',
                prefix: 'Y',
                key: 'y',
                step: 0.05,
                value: i.position[1],
                onCommit: (v) =>
                  set({
                    position: [
                      i.position[0],
                      ops.clampPosition(v),
                      i.position[2],
                    ],
                  }),
              }),
            ],
          }),
          PropertyRow({
            label: '방향',
            children: [
              Slider({
                label: '방향',
                key: 'yaw',
                value: yaw,
                min: -180,
                max: 180,
                step: 1,
                format: (v) => Math.round(v) + '°',
                onInput: (v) =>
                  preview(
                    (d) =>
                      (ops.find(d, 'items', i.id).rotation = ops.withYaw(
                        i.rotation,
                        v,
                      )),
                  ),
                onCommit: (v) => set({ rotation: ops.withYaw(i.rotation, v) }),
              }),
            ],
          }),
          PropertyRow({
            children: [
              ButtonGroup({
                label: '빠른 회전',
                attached: true,
                children: [
                  IconButton({
                    icon: 'rotate-left',
                    label: '왼쪽으로 15° 회전',
                    size: 'sm',
                    key: 'rot-left',
                    onClick: () => rotate(-15, i.id),
                  }),
                  IconButton({
                    icon: 'rotate-right',
                    label: '오른쪽으로 15° 회전',
                    size: 'sm',
                    key: 'rot-right',
                    onClick: () => rotate(15, i.id),
                  }),
                ],
              }),
              Button({
                label: '90° 회전',
                icon: 'rotate-right',
                size: 'sm',
                variant: 'ghost',
                key: 'rot-90',
                onClick: () => rotate(90, i.id),
              }),
            ],
          }),
          PropertyRow({
            label: '크기',
            children: [
              Slider({
                label: '크기',
                key: 'scale',
                value: uniform ? i.scale[0] : 1,
                min: 0.25,
                max: 3,
                step: 0.05,
                format: (v) => '×' + v.toFixed(2),
                onInput: (v) =>
                  preview(
                    (d) => (ops.find(d, 'items', i.id).scale = [v, v, v]),
                  ),
                onCommit: (v) => set({ scale: [v, v, v].map(ops.clampScale) }),
              }),
            ],
          }),
          Disclosure({
            summary: uniform
              ? '축별 크기'
              : '축별 크기 · 슬라이더는 세 축을 같게 맞춥니다',
            open: axesOpen || !uniform,
            onToggle: (open) => (axesOpen = open),
            children: [
              PropertyRow({
                children: ['X', 'Y', 'Z'].map((a, n) =>
                  NumberInput({
                    label: '크기 ' + a,
                    prefix: a,
                    key: 's' + a,
                    step: 0.05,
                    min: 0.01,
                    max: 100,
                    value: i.scale[n],
                    onCommit: (v) => {
                      const next = i.scale.slice()
                      next[n] = ops.clampScale(v)
                      set({ scale: next })
                    },
                  }),
                ),
              }),
            ],
          }),
        ],
      }),
      PanelSection({
        title: '외형',
        children: [
          PropertyRow({
            label: '색',
            children: [
              SwatchPicker({
                label: '가구 색',
                value: i.color,
                colors: anyColor ? ['original', ...palette] : allowed.colors,
                allowCustom: anyColor,
                onPreview: (c) =>
                  preview((d) => (ops.find(d, 'items', i.id).color = c)),
                onChange: (color) => set({ color }),
              }),
            ],
          }),
          PropertyRow({
            label: '표면',
            children: [
              Segmented({
                label: '표면',
                key: 'finish',
                value: i.finish,
                options: ['original', 'matte', 'gloss']
                  .filter((f) => allowed.finishes.includes(f))
                  .map((f) => ({ value: f, label: finishNames[f] })),
                onChange: (finish) => set({ finish }),
              }),
            ],
          }),
        ],
      }),
      spotSection(i.id),
    ]
  }
  function spotSection(anchor) {
    const spots = ops.spotsOn(shown, anchor)
    return PanelSection({
      title: '클릭 영역',
      meta: spots.length + '개',
      children: [
        spots.length
          ? ChipList(
              spots.map((s) =>
                Chip({
                  label: s.label,
                  icon: 'spot',
                  key: 'spot:' + s.id,
                  onClick: () =>
                    select({ type: 'spot', id: s.id }, { frame: true }),
                }),
              ),
            )
          : null,
        Button({
          label: '클릭 영역 추가',
          icon: 'add',
          size: 'sm',
          wide: true,
          key: 'add-spot',
          onClick: () => addClickArea(anchor),
        }),
      ].filter(Boolean),
    })
  }
  function roomInspector(r) {
    const items = shown.items.filter((i) => i.room === r.id)
    return [
      PanelHeader({
        eyebrow: '방',
        icon: 'room',
        title: r.label,
        description:
          '가구 ' +
          items.length +
          '개 · 방 기준 클릭 영역 ' +
          ops.spotsOn(shown, r.id).length +
          '개',
        actions: [
          IconButton({
            icon: 'fit',
            label: '이 방 확대',
            key: 'zoom-room',
            onClick: () => world.selectRoom(r.id),
          }),
        ],
      }),
      PanelSection({
        title: '가구 추가',
        children: [
          kinds.length
            ? ChipList(
                kinds.map((k) =>
                  Chip({
                    label: k.label,
                    icon: 'add',
                    key: 'add:' + k.kind,
                    onClick: () => addFurniture(k.kind, r.id),
                  }),
                ),
              )
            : el(
                'p',
                { class: 'studio-muted' },
                '추가할 수 있는 가구 종류가 없습니다.',
              ),
        ],
      }),
      PanelSection({
        title: '가구',
        meta: items.length + '개',
        children: [
          items.length
            ? ChipList(
                items.map((i) =>
                  Chip({
                    label: i.label,
                    icon: 'furniture',
                    key: 'item:' + i.id,
                    onClick: () =>
                      select({ type: 'item', id: i.id }, { frame: true }),
                  }),
                ),
              )
            : el(
                'p',
                { class: 'studio-muted' },
                '이 방에는 아직 가구가 없습니다.',
              ),
        ],
      }),
      spotSection(r.id),
    ]
  }
  function spotInspector(s) {
    const set = (values) => patch('spots', s.id, values)
    const external = s.action.type === 'url'
    const linking = external || addressing === s.id
    const urlRow = PropertyRow({
      label: '주소',
      children: [
        TextInput({
          label: '외부 주소',
          key: 'url',
          type: 'url',
          size: 'sm',
          placeholder: 'https://',
          value: external ? s.action.url : '',
          validate: (v) => ops.urlError(v),
          onCommit: (u) => set({ action: { type: 'url', url: u } }),
        }),
      ],
    })
    urlRow.hidden = !linking
    const editRow = linking
      ? null
      : PropertyRow({
          children: [
            Button({
              label: '연결된 페이지 편집',
              icon: 'page',
              variant: 'ghost',
              size: 'sm',
              key: 'edit-page',
              onClick: () => select({ type: 'page', id: s.action.page }),
            }),
          ],
        })
    const anchorIsRoom = rooms.some((r) => r.id === s.anchor)
    return [
      PanelHeader({
        eyebrow: '클릭 영역',
        icon: 'spot',
        title: labelInput('표시 이름', s.label, (label) => set({ label })),
        actions: [
          IconButton({
            icon: anchorIsRoom ? 'room' : 'furniture',
            label: '기준 대상 선택',
            key: 'anchor',
            onClick: () =>
              select(
                anchorIsRoom
                  ? { type: 'room', id: s.anchor }
                  : { type: 'item', id: s.anchor },
                { frame: true },
              ),
          }),
          IconButton({
            icon: 'delete',
            label: '삭제',
            variant: 'danger',
            shortcut: 'Delete',
            key: 'delete',
            onClick: () => remove(),
          }),
        ],
      }),
      PanelSection({
        title: '연결',
        children: [
          PropertyRow({
            label: '누르면',
            children: [
              Select({
                label: '연결 대상',
                key: 'dest',
                size: 'sm',
                value: linking ? '__url' : s.action.page,
                options: [
                  ...shown.pages.map((p) => ({
                    value: p.id,
                    label: '페이지 · ' + p.title,
                  })),
                  { value: '__url', label: '외부 링크 열기' },
                  { value: '__new', label: '＋ 새 페이지 만들어 연결' },
                ],
                onChange: (v) => {
                  if (v === '__url') {
                    // Keep the current link until a valid address is entered.
                    addressing = s.id
                    renderInspector()
                    properties.querySelector('[data-key="url"]').focus()
                    return
                  }
                  addressing = null
                  if (v === '__new') {
                    const id = newId()
                    change((d) => {
                      const page = ops.addPage(d, { id, title: s.label })
                      ops.find(d, 'spots', s.id).action = {
                        type: 'page',
                        page: page.id,
                      }
                    })
                    notify(
                      '새 페이지를 만들어 연결했습니다. 행사 페이지 탭에서 내용을 채우세요.',
                    )
                  } else set({ action: { type: 'page', page: v } })
                },
              }),
            ],
          }),
          urlRow,
          editRow,
        ].filter(Boolean),
      }),
      PanelSection({
        title: '위치와 범위',
        children: [
          PropertyRow({
            label: '기준',
            children: [
              Select({
                label: '기준 방 또는 가구',
                key: 'anchor-select',
                size: 'sm',
                value: s.anchor,
                options: [
                  ...rooms.map((r) => ({
                    value: r.id,
                    label: '방 · ' + r.label,
                  })),
                  ...shown.items.map((i) => ({
                    value: i.id,
                    label: '가구 · ' + i.label,
                  })),
                ],
                onChange: (anchor) => set({ anchor }),
              }),
            ],
          }),
          PropertyRow({
            label: '위치',
            children: ['X', '높이', 'Z'].map((a, n) =>
              NumberInput({
                label: '상대 위치 ' + a,
                prefix: a === '높이' ? 'Y' : a,
                key: 'p' + n,
                value: s.position[n],
                onCommit: (v) => {
                  const next = s.position.slice()
                  next[n] = ops.clampPosition(v)
                  set({ position: next })
                },
              }),
            ),
          }),
          PropertyRow({
            label: '범위',
            children: ['W', 'H', 'D'].map((a, n) =>
              NumberInput({
                label: '클릭 범위 ' + a,
                prefix: a,
                key: 'z' + n,
                min: 0.01,
                max: 100,
                value: s.size[n],
                onCommit: (v) => {
                  const next = s.size.slice()
                  next[n] = ops.clampScale(v)
                  set({ size: next })
                },
              }),
            ),
          }),
          Callout({
            message:
              '장면의 안내 표시를 끌어 위치를 옮길 수 있습니다. 상자가 방문자가 누를 수 있는 범위입니다.',
          }),
        ],
      }),
    ]
  }
  function pageInspector(p) {
    const set = (values) => patch('pages', p.id, values)
    const linked = shown.spots.filter((s) => s.action.page === p.id)
    return [
      PanelHeader({
        eyebrow: '행사 페이지',
        icon: 'page',
        title: labelInput('제목', p.title, (title) => set({ title })),
        actions: [
          IconButton({
            icon: 'external',
            label: '/events/' + p.id + ' 새 창에서 열기',
            key: 'open-page',
            onClick: () => window.open('/events/' + p.id, '_blank', 'noopener'),
          }),
          IconButton({
            icon: 'delete',
            label: '페이지 삭제',
            variant: 'danger',
            key: 'delete-page',
            onClick: () => removePage(p.id),
          }),
        ],
      }),
      PanelSection({
        title: '내용',
        children: [
          PropertyRow({
            label: '개요',
            stack: true,
            children: [
              TextArea({
                label: '개요',
                key: 'summary',
                rows: 3,
                value: p.summary,
                validate: (v) =>
                  v.length > 500 ? '500자 이내로 입력하세요.' : null,
                onCommit: (summary) => set({ summary }),
              }),
            ],
          }),
          PropertyRow({
            label: '본문',
            stack: true,
            children: [
              TextArea({
                label: '본문',
                key: 'body',
                rows: 8,
                value: p.body,
                validate: (v) =>
                  v.length > 16000 ? '16000자 이내로 입력하세요.' : null,
                onCommit: (body) => set({ body }),
              }),
            ],
          }),
          PropertyRow({
            label: '원문 주소',
            stack: true,
            children: [
              TextInput({
                label: '원문 주소',
                key: 'page-url',
                type: 'url',
                size: 'sm',
                placeholder: 'https://',
                value: p.url,
                validate: (v) => ops.urlError(v, { optional: true }),
                onCommit: (url) => set({ url }),
              }),
            ],
          }),
        ],
      }),
      PanelSection({
        title: '연결된 클릭 영역',
        meta: linked.length + '개',
        children: [
          linked.length
            ? ChipList(
                linked.map((s) =>
                  Chip({
                    label: s.label,
                    icon: 'spot',
                    key: 'spot:' + s.id,
                    onClick: () =>
                      select({ type: 'spot', id: s.id }, { frame: true }),
                  }),
                ),
              )
            : el(
                'p',
                { class: 'studio-muted' },
                '방이나 가구를 선택해 클릭 영역을 추가하고 이 페이지를 연결하세요.',
              ),
        ],
      }),
    ]
  }

  // ---- Render loop ----
  let frame = 0
  function render() {
    cancelAnimationFrame(frame)
    // Wait a frame so a Tab keypress finishes moving focus before rebuilding.
    frame = requestAnimationFrame(() => {
      renderOutline()
      projection?.select(selection)
      renderInspector()
      undoButton.disabled = !history.canUndo
      redoButton.disabled = !history.canRedo
      canvas?.setSelection(selection)
      world?.chooseLight(selection?.type === 'light' ? selection.id : null)
      world?.chooseSpot(selection?.type === 'spot' ? selection.id : null)
      world?.showBox(
        selection?.type === 'spot'
          ? ops.find(shown, 'spots', selection.id)
          : null,
      )
    })
  }
  renderSave()
  render()

  // ---- Keyboard ----
  // Escape first closes an open popover (handled by the overlay mediator).
  document.addEventListener('keydown', (e) => {
    if (document.querySelector('dialog[open]')) return
    const mod = e.metaKey || e.ctrlKey
    const key = e.key.toLowerCase()
    const typing =
      /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) ||
      e.target.isContentEditable
    if (e.key === 'Escape') {
      if (lightPick) return setLightPick(null)
      if (canvas?.cancel()) return
      if (!typing) select(null)
      return
    }
    if (mod && key === 's') {
      e.preventDefault()
      flush().catch(() => {})
      return
    }
    if (typing) return
    if (mod && key === 'z') {
      e.preventDefault()
      e.shiftKey ? redo() : undo()
    } else if (mod && key === 'y') {
      e.preventDefault()
      redo()
    } else if (mod && key === 'd') {
      e.preventDefault()
      duplicate()
    } else if (mod) return
    else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selection && selection.type !== 'room') {
        e.preventDefault()
        remove()
      }
    } else if (key === 'q' || key === 'e') {
      rotate((key === 'q' ? -1 : 1) * (e.shiftKey ? 90 : ops.ROTATE_STEP))
    } else if (key === 'f') {
      if (selection) canvas?.frame(selection)
    } else if (e.key === '?') {
      help.toggle()
    } else if (e.key.startsWith('Arrow') && selectedItem()) {
      e.preventDefault()
      nudge(e.key, e.shiftKey ? 1 : ops.GRID)
    }
  })
  addEventListener('beforeunload', (e) => {
    if (autosave.busy || ['error', 'unauthorized'].includes(autosave.state)) {
      e.preventDefault()
      e.returnValue = ''
      if (autosave.state === 'pending') flush().catch(() => {})
    }
  })

  // ---- Status polling ----
  await publish.refresh().catch((e) => fail(e.message))
  const timer = setInterval(() => {
    if (!document.hidden) publish.refresh().catch(() => {})
  }, 3000)
  addEventListener('pagehide', () => clearInterval(timer), { once: true })

  // ---- Scene ----
  const hooks = {
    layout: () => shown,
    snapping: () => snapping,
    select: (sel) => select(sel),
    toolbar: floating,
    pickLightPoint(at) {
      if (!lightPick) return false
      const light =
        selection?.type === 'light' && ops.find(shown, 'lights', selection.id)
      if (!light) {
        setLightPick(null)
        return false
      }
      const point = world.roomPoint(at.x, at.y, light.room)
      if (!point) {
        notify(roomName(light.room) + '의 바닥이나 물체를 클릭하세요.')
        return true
      }
      let values
      if (lightPick === 'aim') {
        const shape = aimShape(light, point)
        if (!shape) {
          notify('조명과 떨어진 곳을 클릭하세요.')
          return true
        }
        values = { shape }
      } else
        values = {
          position: [
            ops.round(point[0]),
            light.position[1],
            ops.round(point[2]),
          ],
        }
      setLightPick(null)
      patch('lights', light.id, values)
      return true
    },
    dragging(on) {
      view.host.classList.toggle('is-dragging', on)
    },
    itemMoved: () => projection.invalidate(),
    revert: () => apply(),
    commitItem(id, values, { copy }) {
      const item = ops.find(shown, 'items', id)
      const moved = values.room && values.room !== item.room
      if (copy) {
        const next = newId()
        change((d) =>
          Object.assign(ops.duplicateItem(d, id, next, [0, 0, 0]), values),
        )
        select({ type: 'item', id: next })
        notify('복제해서 놓았습니다.')
      } else patch('items', id, values)
      if (moved) notify(roomName(values.room) + '(으)로 옮겼습니다.', true)
    },
    commitSpot(id, position) {
      patch('spots', id, { position })
    },
  }
  try {
    world = await openEditorScene(view, saved, {
      onLight: (id) => select({ type: 'light', id }),
      onSpot: (s) => select({ type: 'spot', id: s.id }),
      onSpotDown: (s, e) => hooks.spotDown?.(s, e),
    })
  } catch (e) {
    view.loading.replaceChildren(
      Icon('alert', 'sm'),
      '3D 장면을 열 수 없습니다 · ' + e.message,
    )
    view.loading.hidden = false
    throw e
  }
  world.update(shown)
  projection = selectionPreview(world, portrait)
  canvas = attachCanvas(world, view, hooks)
  render()
}
