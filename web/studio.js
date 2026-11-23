import { app, api, el, stage } from './ui.js'
import { field } from './fields.js'
import { previewLayout } from './preview.js'
import { EditHistory } from './history.js'
import { openEditorScene } from './scene.js'
import { Autosave } from './autosave.js'
import { attachCanvas } from './studio-canvas.js'
import { publishControl } from './studio-publish.js'
import { openHandoff } from './studio-handoff.js'
import * as ops from './edit-ops.js'
import {
  section,
  row,
  text,
  number,
  slider,
  segmented,
  choice,
  action,
  keepFocus,
} from './studio-fields.js'

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

function login() {
  const secret = el('input', {
    type: 'password',
    autocomplete: 'current-password',
    required: '',
  })
  const form = el(
    'form',
    { class: 'login' },
    el('h1', {}, '월드 스튜디오'),
    field('관리자 키', secret),
    el('button', { class: 'primary' }, '스튜디오 열기'),
  )
  const error = el('p', { class: 'error', role: 'alert' })
  form.append(error)
  form.onsubmit = async (e) => {
    e.preventDefault()
    try {
      await api('login', 'POST', { key: secret.value })
      await studio()
    } catch (err) {
      error.textContent =
        err.status === 403 ? '관리자 키가 맞지 않습니다.' : err.message
    }
  }
  app.replaceChildren(form)
  secret.focus()
}

export async function studio() {
  let saved
  try {
    saved = await api('admin/draft')
  } catch (e) {
    if (e.status === 401) return login()
    throw e
  }
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
  let axesOpen = false

  // ---- Shell ----
  const view = stage()
  const outline = el('aside', { class: 'outline', 'aria-label': '장면 목록' })
  const inspector = el('aside', { class: 'inspector', 'aria-label': '속성' })
  const saveChip = el('button', { type: 'button', class: 'save-chip' })
  const undoButton = action('↶', () => undo(), {
    title: '되돌리기 (' + cmd + 'Z)',
    key: 'undo',
  })
  const redoButton = action('↷', () => redo(), {
    title: '다시 실행 (' + cmd + '⇧Z)',
    key: 'redo',
  })
  undoButton.setAttribute('aria-label', '되돌리기')
  redoButton.setAttribute('aria-label', '다시 실행')

  const autosave = new Autosave({
    async save() {
      const layout = history.value
      if (JSON.stringify(layout) === JSON.stringify(saved.layout)) return
      saved = await api('admin/draft', 'PUT', { revision: saved.id, layout })
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
    onError: (m) => toast(m),
  })

  const top = el(
    'header',
    { class: 'studio-top' },
    el('strong', { class: 'studio-title' }, '월드 스튜디오'),
    saveChip,
    el('div', { class: 'history-buttons' }, undoButton, redoButton),
    el('span', { class: 'spacer' }),
    action('미리보기', () =>
      previewLayout(saved, history.value).catch((e) => toast(e.message)),
    ),
    action('Blender 인계', () =>
      openHandoff({
        flush,
        draft: () => history.value,
        rooms,
        onError: (m) => toast(m),
      }),
    ),
    publish.element,
  )
  const snapButton = el(
    'button',
    {
      type: 'button',
      class: 'toggle on',
      'aria-pressed': 'true',
      title: '0.25m 격자와 15° 단위에 맞춥니다',
      onclick: () => {
        snapping = !snapping
        snapButton.classList.toggle('on', snapping)
        snapButton.setAttribute('aria-pressed', String(snapping))
      },
    },
    '격자 맞춤',
  )
  const help = el(
    'div',
    { class: 'popover help-pop', hidden: '' },
    el('strong', {}, '조작 방법'),
    el(
      'dl',
      {},
      ...shortcuts.flatMap(([k, d]) => [el('dt', {}, k), el('dd', {}, d)]),
    ),
  )
  const helpButton = el(
    'button',
    {
      type: 'button',
      'aria-label': '조작 방법',
      title: '조작 방법 (?)',
      onclick: () => (help.hidden = !help.hidden),
    },
    '?',
  )
  const viewTools = el(
    'div',
    { class: 'view-tools' },
    snapButton,
    el(
      'button',
      { type: 'button', onclick: () => world?.selectRoom(null) },
      '전체 보기',
    ),
    el(
      'button',
      {
        type: 'button',
        'aria-label': '축소',
        onclick: () => world?.zoom(1 / 1.4),
      },
      '−',
    ),
    el(
      'button',
      { type: 'button', 'aria-label': '확대', onclick: () => world?.zoom(1.4) },
      '＋',
    ),
    helpButton,
  )
  const hint = el(
    'p',
    { class: 'canvas-hint' },
    '가구를 끌어 옮기기 · 빈 곳을 끌어 화면 이동 · 오른쪽 버튼으로 시점 회전 · 휠로 확대',
  )
  const floating = el(
    'div',
    {
      class: 'float-tools',
      role: 'toolbar',
      'aria-label': '선택한 가구',
      hidden: '',
    },
    action('복제', () => duplicate(), { title: '복제 (' + cmd + 'D)' }),
    action('↺', () => rotate(-ops.ROTATE_STEP), { title: '왼쪽으로 15° (Q)' }),
    action('↻', () => rotate(ops.ROTATE_STEP), { title: '오른쪽으로 15° (E)' }),
    action('삭제', () => remove(), { cls: 'danger', title: '삭제 (Delete)' }),
  )
  floating
    .querySelectorAll('button')[1]
    .setAttribute('aria-label', '왼쪽으로 회전')
  floating
    .querySelectorAll('button')[2]
    .setAttribute('aria-label', '오른쪽으로 회전')
  view.host.append(viewTools, help, hint)
  app.replaceChildren(
    el(
      'div',
      { class: 'studio-app' },
      top,
      el('div', { class: 'studio-body' }, outline, view.host, inspector),
    ),
  )

  // ---- Feedback ----
  let toastTimer
  function toast(message, undoable) {
    const n = document.querySelector('#notice')
    n.replaceChildren(el('span', {}, message))
    if (undoable)
      n.append(
        el(
          'button',
          {
            type: 'button',
            onclick: () => {
              undo()
              n.hidden = true
            },
          },
          '되돌리기',
        ),
      )
    n.hidden = false
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => (n.hidden = true), 6000)
  }
  function renderSave() {
    const s = autosave.state
    saveChip.className = 'save-chip ' + s
    saveChip.textContent = {
      saved: '✓ 저장됨',
      pending: '저장 대기',
      saving: '저장 중…',
      error: '저장 실패 · 다시 시도',
      conflict: '다른 창에서 변경됨 · 다시 열기',
    }[s]
    saveChip.title = autosave.error || '편집하면 초안에 자동으로 저장됩니다.'
    saveChip.disabled = !['error', 'conflict'].includes(s)
    saveChip.onclick =
      s === 'conflict' ? () => location.reload() : () => flush().catch(() => {})
    if (s === 'error') toast('저장하지 못했습니다 · ' + autosave.error)
  }

  // ---- Edits ----
  function apply() {
    shown = history.value
    world?.update(shown)
    if (selection && !exists(selection)) selection = null
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
    shown = history.value
    edit(shown)
    world?.update(shown)
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
  const listOf = { item: 'items', spot: 'spots', page: 'pages' }
  function exists(sel) {
    if (sel.type === 'room') return rooms.some((r) => r.id === sel.id)
    return !!ops.find(shown, listOf[sel.type], sel.id)
  }
  function select(sel, { frame = false } = {}) {
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
    toast('복제했습니다. 끌어서 원하는 곳에 놓으세요.')
  }
  function remove() {
    if (selection?.type === 'item') {
      const label = selectedItem().label
      const n = change((d) => ops.deleteItem(d, selection.id))
      toast(
        label +
          ' 삭제' +
          (n ? ' · 연결된 클릭 영역 ' + n + '개 함께 삭제' : ''),
        true,
      )
    } else if (selection?.type === 'spot') {
      change((d) => ops.deleteSpot(d, selection.id))
      toast('클릭 영역을 삭제했습니다.', true)
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
    toast('페이지를 삭제했습니다.', true)
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
    toast(roomName(room) + '에 ' + (def?.label || kind) + '을(를) 놓았습니다.')
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
    const tabs = el(
      'div',
      { class: 'tabs', role: 'tablist' },
      ...[
        ['layout', '배치'],
        ['pages', '행사 페이지'],
      ].map(([id, name]) =>
        el(
          'button',
          {
            type: 'button',
            role: 'tab',
            'data-key': 'tab:' + id,
            'aria-selected': String(tab === id),
            class: tab === id ? 'on' : null,
            onclick: () => {
              tab = id
              renderOutline()
            },
          },
          name,
        ),
      ),
    )
    keepFocus(outline, () => [
      tabs,
      ...(tab === 'layout' ? layoutTree() : pageList()),
    ])
  }
  function treeRow(sel, label, { depth = 0, icon, meta } = {}) {
    const on = selection?.type === sel.type && selection.id === sel.id
    return el(
      'button',
      {
        type: 'button',
        class: 'tree-row' + (on ? ' on' : ''),
        style: '--depth:' + depth,
        'data-key': sel.type + ':' + sel.id,
        'aria-current': on ? 'true' : null,
        onclick: () => select(sel, { frame: true }),
      },
      icon
        ? el('span', { class: 'icon icon-' + icon, 'aria-hidden': 'true' })
        : null,
      el('span', { class: 'name' }, label),
      meta ? el('span', { class: 'meta' }, meta) : null,
    )
  }
  function layoutTree() {
    const search = el('input', {
      type: 'search',
      placeholder: '가구·안내 찾기',
      'aria-label': '가구·안내 찾기',
      'data-key': 'search',
    })
    search.value = query
    search.oninput = () => {
      query = search.value
      renderOutline()
    }
    const match = (label) =>
      !query || label.toLowerCase().includes(query.toLowerCase())
    const menu = addMenu()
    const groups = rooms.map((r) => {
      const items = shown.items.filter((i) => i.room === r.id)
      const roomSpots = shown.spots.filter((s) => s.anchor === r.id)
      const children = []
      for (const i of items) {
        const spots = shown.spots.filter((s) => s.anchor === i.id)
        const shownSpots = spots.filter((s) => match(s.label))
        if (!match(i.label) && !shownSpots.length) continue
        children.push(
          treeRow({ type: 'item', id: i.id }, i.label, {
            depth: 1,
            icon: 'item',
          }),
        )
        for (const s of match(i.label) ? spots : shownSpots)
          children.push(
            treeRow({ type: 'spot', id: s.id }, s.label, {
              depth: 2,
              icon: 'spot',
            }),
          )
      }
      for (const s of roomSpots.filter((s) => match(s.label)))
        children.push(
          treeRow({ type: 'spot', id: s.id }, s.label, {
            depth: 1,
            icon: 'spot',
          }),
        )
      if (query && !children.length && !match(r.label)) return null
      const open = query || !collapsed.has(r.id)
      return el(
        'div',
        { class: 'tree-group' },
        el(
          'div',
          { class: 'tree-head' },
          el(
            'button',
            {
              type: 'button',
              class: 'fold',
              'aria-label': (open ? '접기 ' : '펼치기 ') + r.label,
              'aria-expanded': String(!!open),
              onclick: () => {
                collapsed.has(r.id)
                  ? collapsed.delete(r.id)
                  : collapsed.add(r.id)
                renderOutline()
              },
            },
            open ? '▾' : '▸',
          ),
          treeRow({ type: 'room', id: r.id }, r.label, {
            icon: 'room',
            meta: String(items.length),
          }),
        ),
        open ? el('div', { class: 'tree-children' }, ...children) : null,
      )
    })
    return [
      el('div', { class: 'outline-tools' }, search, menu),
      el('div', { class: 'tree' }, ...groups.filter(Boolean)),
    ]
  }
  function addMenu() {
    const details = el(
      'details',
      { class: 'add-menu' },
      el('summary', { 'data-key': 'add-menu' }, '＋ 가구'),
    )
    const list = el(
      'div',
      { class: 'popover menu' },
      el('small', {}, roomName(roomOf(selection) || rooms[0].id) + '에 추가'),
      ...kinds.map((k) =>
        el(
          'button',
          {
            type: 'button',
            onclick: () => {
              details.open = false
              addFurniture(k.kind)
            },
          },
          k.label,
        ),
      ),
    )
    if (!kinds.length)
      list.append(el('small', {}, '추가할 수 있는 가구 종류가 없습니다.'))
    details.append(list)
    return details
  }
  function pageList() {
    return [
      el(
        'div',
        { class: 'outline-tools' },
        action('＋ 새 페이지', addPage, { key: 'add-page', cls: 'wide' }),
      ),
      el(
        'div',
        { class: 'tree' },
        ...shown.pages.map((p) => {
          const n = shown.spots.filter((s) => s.action.page === p.id).length
          return treeRow({ type: 'page', id: p.id }, p.title, {
            icon: 'page',
            meta: n ? '연결 ' + n : '연결 없음',
          })
        }),
      ),
    ]
  }

  // ---- Inspector ----
  function renderInspector() {
    const key = JSON.stringify([selection, shown, axesOpen])
    if (key === inspectorKey) return
    inspectorKey = key
    keepFocus(inspector, () => {
      if (!selection) return emptyInspector()
      const t = selection.type
      if (t === 'item')
        return itemInspector(ops.find(shown, 'items', selection.id))
      if (t === 'spot')
        return spotInspector(ops.find(shown, 'spots', selection.id))
      if (t === 'page')
        return pageInspector(ops.find(shown, 'pages', selection.id))
      return roomInspector(rooms.find((r) => r.id === selection.id))
    })
  }
  function head(kind, title, ...extra) {
    return el(
      'div',
      { class: 'ins-head' },
      el('span', { class: 'kind' }, kind),
      title,
      ...extra,
    )
  }
  function emptyInspector() {
    return [
      el(
        'div',
        { class: 'empty' },
        el('strong', {}, '편집할 대상을 선택하세요'),
        el(
          'p',
          {},
          '장면에서 가구나 초록 안내 표시를 누르거나, 왼쪽 목록에서 고르세요.',
        ),
        el(
          'ul',
          {},
          el('li', {}, '가구는 끌어서 옮기고 다른 방에 놓을 수 있습니다.'),
          el('li', {}, 'Alt를 누른 채 끌면 복제하며 옮깁니다.'),
          el(
            'li',
            {},
            '변경은 초안에 자동 저장되고, 발행하기 전까지 방문자에게 보이지 않습니다.',
          ),
        ),
      ),
    ]
  }
  function itemInspector(i) {
    const allowed = saved.options?.[i.kind] || {
      colors: ['*'],
      finishes: ['original', 'matte', 'gloss'],
    }
    const set = (values) => patch('items', i.id, values)
    const yaw = ops.yawOf(i.rotation)
    const uniform = i.scale.every((v) => Math.abs(v - i.scale[0]) < 1e-6)
    const kindName = kinds.find((k) => k.kind === i.kind)?.label || i.kind
    const spots = ops.spotsOn(shown, i.id)
    const colors = allowed.colors.includes('*')
      ? ['original', ...palette]
      : allowed.colors
    const swatches = el(
      'div',
      { class: 'swatches', role: 'radiogroup', 'aria-label': '가구 색' },
      ...colors.map((c) =>
        el('button', {
          type: 'button',
          role: 'radio',
          'data-key': 'color:' + c,
          'aria-checked': String(i.color === c),
          'aria-label': c === 'original' ? '원본 색' : c,
          title: c === 'original' ? '원본 색' : c,
          class:
            'swatch' +
            (c === 'original' ? ' original' : '') +
            (i.color === c ? ' on' : ''),
          style: c === 'original' ? null : 'background:' + c,
          onclick: () => set({ color: c }),
        }),
      ),
    )
    if (allowed.colors.includes('*')) {
      const custom = el('input', {
        type: 'color',
        'data-key': 'color:custom',
        'aria-label': '직접 고른 색',
        title: '직접 고르기',
        class:
          palette.includes(i.color) || i.color === 'original' ? null : 'on',
      })
      custom.value = i.color === 'original' ? '#ac7958' : i.color
      custom.addEventListener('input', () =>
        preview((d) => (ops.find(d, 'items', i.id).color = custom.value)),
      )
      custom.addEventListener('change', () => set({ color: custom.value }))
      swatches.append(custom)
    }
    return [
      head(
        kindName,
        text('label', i.label, (label) => set({ label }), {
          label: '이름',
          check: ops.labelError,
        }),
      ),
      el(
        'div',
        { class: 'button-row' },
        action('복제', () => duplicate(i.id), { shortcut: cmd + 'D' }),
        action('삭제', () => remove(), { cls: 'danger', shortcut: 'Del' }),
      ),
      section(
        '배치',
        row(
          '방',
          choice(
            'room',
            rooms.map((r) => [r.id, r.label]),
            i.room,
            (room) => {
              change((d) => ops.moveToRoom(d, i.id, room))
              canvas?.frame({ type: 'item', id: i.id })
            },
            '방',
          ),
        ),
        row(
          '위치',
          number(
            'x',
            i.position[0],
            (v) =>
              set({
                position: [ops.clampPosition(v), i.position[1], i.position[2]],
              }),
            { label: '위치 X', unit: 'X' },
          ),
          number(
            'z',
            i.position[2],
            (v) =>
              set({
                position: [i.position[0], i.position[1], ops.clampPosition(v)],
              }),
            { label: '위치 Z', unit: 'Z' },
          ),
        ),
        row(
          '높이',
          number(
            'y',
            i.position[1],
            (v) =>
              set({
                position: [i.position[0], ops.clampPosition(v), i.position[2]],
              }),
            { label: '높이', unit: 'm', step: 0.05 },
          ),
        ),
        row(
          '방향',
          slider(
            'yaw',
            yaw,
            {
              min: -180,
              max: 180,
              step: 1,
              label: '방향',
              format: (v) => Math.round(v) + '°',
            },
            (v) =>
              preview(
                (d) =>
                  (ops.find(d, 'items', i.id).rotation = ops.withYaw(
                    i.rotation,
                    v,
                  )),
              ),
            (v) => set({ rotation: ops.withYaw(i.rotation, v) }),
          ),
        ),
        row(
          '',
          action('↺ 15°', () => rotate(-15, i.id), { key: 'rot-left' }),
          action('↻ 15°', () => rotate(15, i.id), { key: 'rot-right' }),
          action('↻ 90°', () => rotate(90, i.id), { key: 'rot-90' }),
        ),
        row(
          '크기',
          slider(
            'scale',
            uniform ? i.scale[0] : 1,
            {
              min: 0.25,
              max: 3,
              step: 0.05,
              label: '크기',
              format: (v) => '×' + v.toFixed(2),
            },
            (v) =>
              preview((d) => (ops.find(d, 'items', i.id).scale = [v, v, v])),
            (v) => set({ scale: [v, v, v].map(ops.clampScale) }),
          ),
        ),
        el(
          'details',
          {
            class: 'axes',
            open: axesOpen || !uniform ? '' : null,
          },
          el(
            'summary',
            {
              // Record the choice on click: a pending re-render may replace
              // this element before its toggle event fires.
              onclick: (e) => (axesOpen = !e.currentTarget.parentElement.open),
            },
            uniform
              ? '축별 크기'
              : '축별 크기 · 슬라이더는 세 축을 같게 맞춥니다',
          ),
          row(
            '',
            ...['X', 'Y', 'Z'].map((a, n) =>
              number(
                's' + a,
                i.scale[n],
                (v) => {
                  const next = i.scale.slice()
                  next[n] = ops.clampScale(v)
                  set({ scale: next })
                },
                {
                  label: '크기 ' + a,
                  unit: a,
                  step: 0.05,
                  min: 0.01,
                  max: 100,
                },
              ),
            ),
          ),
        ),
      ),
      section(
        '외형',
        row('색', swatches),
        row(
          '표면',
          segmented(
            'finish',
            ['original', 'matte', 'gloss']
              .filter((f) => allowed.finishes.includes(f))
              .map((f) => [f, finishNames[f]]),
            i.finish,
            (finish) => set({ finish }),
            '표면',
          ),
        ),
      ),
      spotSection(i.id, spots),
    ]
  }
  function spotSection(anchor, spots) {
    return section(
      '클릭 영역 ' + spots.length,
      el(
        'div',
        { class: 'chips' },
        ...spots.map((s) =>
          action(
            s.label,
            () => select({ type: 'spot', id: s.id }, { frame: true }),
            {
              cls: 'chip-button',
              key: 'spot:' + s.id,
            },
          ),
        ),
      ),
      action('＋ 클릭 영역 추가', () => addClickArea(anchor), {
        key: 'add-spot',
        cls: 'wide',
      }),
    )
  }
  function roomInspector(r) {
    const items = shown.items.filter((i) => i.room === r.id)
    return [
      head('방', el('h2', {}, r.label)),
      el(
        'p',
        { class: 'muted' },
        '가구 ' +
          items.length +
          '개 · 방 기준 클릭 영역 ' +
          ops.spotsOn(shown, r.id).length +
          '개',
      ),
      el(
        'div',
        { class: 'button-row' },
        action('이 방 확대', () => world.selectRoom(r.id), {
          key: 'zoom-room',
        }),
      ),
      section(
        '가구 추가',
        el(
          'div',
          { class: 'chips' },
          ...kinds.map((k) =>
            action('＋ ' + k.label, () => addFurniture(k.kind, r.id), {
              cls: 'chip-button',
              key: 'add:' + k.kind,
            }),
          ),
        ),
      ),
      section(
        '가구',
        el(
          'div',
          { class: 'chips' },
          ...items.map((i) =>
            action(
              i.label,
              () => select({ type: 'item', id: i.id }, { frame: true }),
              {
                cls: 'chip-button',
                key: 'item:' + i.id,
              },
            ),
          ),
        ),
      ),
      spotSection(r.id, ops.spotsOn(shown, r.id)),
    ]
  }
  function spotInspector(s) {
    const set = (values) => patch('spots', s.id, values)
    const external = s.action.type === 'url'
    const url = text(
      'url',
      external ? s.action.url : '',
      (u) => set({ action: { type: 'url', url: u } }),
      {
        label: '외부 주소',
        type: 'url',
        check: (v) => ops.urlError(v),
      },
    )
    const urlRow = row('주소', url)
    urlRow.hidden = !external
    const editRow = external
      ? null
      : row(
          '',
          action(
            '페이지 편집',
            () => select({ type: 'page', id: s.action.page }),
            { key: 'edit-page', cls: 'link' },
          ),
        )
    const anchors = [
      ...rooms.map((r) => [r.id, '방 · ' + r.label]),
      ...shown.items.map((i) => [i.id, '가구 · ' + i.label]),
    ]
    return [
      head(
        '클릭 영역',
        text('label', s.label, (label) => set({ label }), {
          label: '표시 이름',
          check: ops.labelError,
        }),
      ),
      el(
        'div',
        { class: 'button-row' },
        action(
          '기준 대상 선택',
          () =>
            select(
              rooms.some((r) => r.id === s.anchor)
                ? { type: 'room', id: s.anchor }
                : { type: 'item', id: s.anchor },
              { frame: true },
            ),
          { key: 'anchor' },
        ),
        action('삭제', () => remove(), { cls: 'danger', shortcut: 'Del' }),
      ),
      section(
        '연결',
        row(
          '누르면',
          choice(
            'dest',
            [
              ...shown.pages.map((p) => [p.id, '페이지 · ' + p.title]),
              ['__url', '외부 링크 열기'],
              ['__new', '＋ 새 페이지 만들어 연결'],
            ],
            external ? '__url' : s.action.page,
            (v) => {
              if (v === '__url') {
                // Keep the current link until a valid address is entered.
                urlRow.hidden = false
                if (editRow) editRow.hidden = true
                urlRow.querySelector('input').focus()
              } else if (v === '__new') {
                const id = newId()
                change((d) => {
                  const page = ops.addPage(d, { id, title: s.label })
                  ops.find(d, 'spots', s.id).action = {
                    type: 'page',
                    page: page.id,
                  }
                })
                toast(
                  '새 페이지를 만들어 연결했습니다. 행사 페이지 탭에서 내용을 채우세요.',
                )
              } else set({ action: { type: 'page', page: v } })
            },
            '연결 대상',
          ),
        ),
        urlRow,
        editRow,
      ),
      section(
        '위치와 범위',
        row(
          '기준',
          choice(
            'anchor-select',
            anchors,
            s.anchor,
            (anchor) => set({ anchor }),
            '기준 방 또는 가구',
          ),
        ),
        row(
          '위치',
          ...['X', '높이', 'Z'].map((a, n) =>
            number(
              'p' + n,
              s.position[n],
              (v) => {
                const next = s.position.slice()
                next[n] = ops.clampPosition(v)
                set({ position: next })
              },
              { label: '상대 위치 ' + a, unit: a === '높이' ? 'Y' : a },
            ),
          ),
        ),
        row(
          '범위',
          ...['W', 'H', 'D'].map((a, n) =>
            number(
              'z' + n,
              s.size[n],
              (v) => {
                const next = s.size.slice()
                next[n] = ops.clampScale(v)
                set({ size: next })
              },
              { label: '클릭 범위 ' + a, unit: a, min: 0.01, max: 100 },
            ),
          ),
        ),
        el(
          'p',
          { class: 'muted' },
          '장면의 초록 표시를 끌어 위치를 옮길 수 있습니다. 상자가 방문자가 누를 수 있는 범위입니다.',
        ),
      ),
    ]
  }
  function pageInspector(p) {
    const set = (values) => patch('pages', p.id, values)
    const linked = shown.spots.filter((s) => s.action.page === p.id)
    return [
      head(
        '행사 페이지',
        text('title', p.title, (title) => set({ title }), {
          label: '제목',
          check: ops.labelError,
        }),
      ),
      section(
        '내용',
        el(
          'label',
          { class: 'stack' },
          '개요',
          text('summary', p.summary, (summary) => set({ summary }), {
            label: '개요',
            multiline: true,
            check: (v) => (v.length > 500 ? '500자 이내로 입력하세요.' : null),
          }),
        ),
        el(
          'label',
          { class: 'stack' },
          '본문',
          text('body', p.body, (body) => set({ body }), {
            label: '본문',
            multiline: true,
            check: (v) =>
              v.length > 16000 ? '16000자 이내로 입력하세요.' : null,
          }),
        ),
        el(
          'label',
          { class: 'stack' },
          '원문 주소',
          text('page-url', p.url, (url) => set({ url }), {
            label: '원문 주소',
            type: 'url',
            check: (v) => ops.urlError(v, { optional: true }),
          }),
        ),
      ),
      section(
        '연결된 클릭 영역 ' + linked.length,
        el(
          'div',
          { class: 'chips' },
          ...linked.map((s) =>
            action(
              s.label,
              () => select({ type: 'spot', id: s.id }, { frame: true }),
              {
                cls: 'chip-button',
                key: 'spot:' + s.id,
              },
            ),
          ),
        ),
        linked.length
          ? null
          : el(
              'p',
              { class: 'muted' },
              '방이나 가구를 선택해 클릭 영역을 추가하고 이 페이지를 연결하세요.',
            ),
      ),
      el(
        'div',
        { class: 'button-row' },
        action(
          '/events/' + p.id + ' 열기 ↗',
          () => window.open('/events/' + p.id, '_blank', 'noopener'),
          { key: 'open-page', cls: 'link' },
        ),
        action('페이지 삭제', () => removePage(p.id), {
          cls: 'danger',
          key: 'delete-page',
        }),
      ),
    ]
  }

  // ---- Render loop ----
  let frame = 0
  function render() {
    cancelAnimationFrame(frame)
    // Wait a frame so a Tab keypress finishes moving focus before rebuilding.
    frame = requestAnimationFrame(() => {
      renderOutline()
      renderInspector()
      undoButton.disabled = !history.canUndo
      redoButton.disabled = !history.canRedo
      canvas?.setSelection(selection)
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
  document.addEventListener('keydown', (e) => {
    if (document.querySelector('dialog[open]')) return
    const mod = e.metaKey || e.ctrlKey
    const key = e.key.toLowerCase()
    if (e.key === 'Escape') {
      if (canvas?.cancel()) return
      if (!help.hidden) return (help.hidden = true)
      publish.close()
      if (!/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) select(null)
      return
    }
    if (mod && key === 's') {
      e.preventDefault()
      flush().catch(() => {})
      return
    }
    if (
      /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) ||
      e.target.isContentEditable
    )
      return
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
      help.hidden = !help.hidden
    } else if (e.key.startsWith('Arrow') && selectedItem()) {
      e.preventDefault()
      nudge(e.key, e.shiftKey ? 1 : ops.GRID)
    }
  })
  addEventListener('beforeunload', (e) => {
    if (autosave.busy || autosave.state === 'error') {
      e.preventDefault()
      e.returnValue = ''
      flush().catch(() => {})
    }
  })

  // ---- Status polling ----
  await publish.refresh().catch((e) => toast(e.message))
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
    dragging: (on) => view.host.classList.toggle('dragging', on),
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
        toast('복제해서 놓았습니다.')
      } else patch('items', id, values)
      if (moved) toast(roomName(values.room) + '(으)로 옮겼습니다.', true)
    },
    commitSpot(id, position) {
      patch('spots', id, { position })
    },
  }
  try {
    world = await openEditorScene(view, saved, {
      onSpot: (s) => select({ type: 'spot', id: s.id }),
      onSpotDown: (s, e) => hooks.spotDown?.(s, e),
    })
  } catch (e) {
    view.loading.textContent = '3D 장면을 열 수 없습니다 · ' + e.message
    view.loading.hidden = false
    throw e
  }
  world.update(shown)
  canvas = attachCanvas(world, view, hooks)
  render()
}
