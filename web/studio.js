import {
  editSource,
  resolvedSources,
  sourceValues,
} from '../shared/source-lights.mjs'
import { lightKinds } from '../shared/studio-lights.mjs'
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
  Toggle,
  Field,
  StatusText,
  Callout,
  Kbd,
  toast,
  Popover,
  ObjectPreview,
  Dialog,
  Toolbar,
  ToolbarDivider,
  Icon,
} from './ds/index.js'
import { previewLayout } from './preview.js'
import { EditHistory } from './history.js'
import { aimShape, showLightPosition } from './light-inspector.js'
import { entities as entityQueries, WORLD } from './studio-entities.js'
import { outline as outlinePanel } from './studio-outline.js'
import { inspectors, scopePath } from './studio-inspectors.js'
import { selectionPreview } from './selection-preview.js'
import { openEditorScene } from './scene.js'
import { Autosave } from './autosave.js'
import { attachCanvas } from './studio-canvas.js'
import { publishControl } from './studio-publish.js'
import { openHandoff, resumeUpload } from './studio-handoff.js'
import * as ops from './edit-ops.js'
import {
  characterLayer,
  characterModel,
  characterMotion,
  motionList,
} from './studio-characters.js'
import { clayLayer, updateStudioClay } from './studio-clay-layer.js'
import { routeGuide } from './route-guide.js'
import { characterClips, routeLimits } from '../shared/character-route.mjs'
import { openVersions } from './studio-versions.js'
import { clayDefaults } from './clay-field.js'

const newId = () => crypto.randomUUID()
const mac = /Mac|iPhone|iPad/.test(navigator.platform)
const cmd = mac ? '⌘' : 'Ctrl+'
const shortcuts = [
  ['끌기', '가구·전구·안내 표시 옮기기'],
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
  const sourceCatalog = saved.sourceLights ?? []
  const sourceMap = new Map(sourceCatalog.map((l) => [l.id, l]))
  const lightById = (id) =>
    ops.find(shown, 'lights', id) ||
    resolvedSources(sourceCatalog, shown.sourceLights).find((l) => l.id === id)
  function changeLight(id, values, temporary = false) {
    const source = sourceMap.get(id)
    const edit = (d) => {
      if (source)
        editSource(
          d,
          source,
          values?.shape ? { rotation: values.shape.rotation } : values,
        )
      else Object.assign(ops.find(d, 'lights', id), values)
    }
    if (!temporary) return change(edit)
    // This layout is a disposable copy. Dragging never writes into history.
    edit(shown)
    world?.updateLights(shown)
    transient = true
  }
  const cloud = saved.publishing === 'helper'
  const rooms = saved.rooms
  const kinds = saved.kinds || []
  let shown = history.value,
    selection = WORLD,
    snapping = true,
    world = null,
    canvas = null
  // Panel state that must survive re-rendering. Panels read and write it as
  // `editor.view`; the draft itself changes only through commands.
  const ui = {
    tab: 'scene',
    query: '',
    filter: 'all',
    collapsed: new Set(),
    axesOpen: false,
    roomAddOpen: false,
    // Spot whose destination was switched to an external link that has not
    // been typed yet, so a re-render does not hide the address field.
    addressing: null,
    lightPick: null,
    lightTool: 'move',
    // Character following the pointer until a floor click places it.
    placing: null,
    // Route being drawn: `{ id, base, added }`, the points clicked so far.
    routing: null,
    // The selected character walks its route from the start as a preview.
    routePlay: false,
    // Library model whose settings are open in the world panel.
    libraryModel: null,
    // Which clay sections show their detail sliders, by section key.
    clayDetail: {},
    // Inspector field (by data-key) to focus after the next render.
    focus: null,
  }
  // Rigged models and motion files shared by every character.
  let characterLibrary = { models: [], motions: [], fallback: null }
  let cast = null
  let guide = null
  const clay = clayLayer()
  // Scene parts drawn by the studio itself rather than by scene.js.
  // `moving`: a slider is still being dragged. Rooms are large, so their
  // clay waits for the release.
  function refreshScene({ moving = false } = {}) {
    if (!world) return
    cast?.update(shown)
    syncRoute()
    updateStudioClay(clay, world, cast, shown, moving)
    projection?.invalidate()
  }
  // The selected character's route shows its path and stands at the first
  // point until the editor plays it; the others keep walking.
  function syncRoute() {
    const c =
      selection?.type === 'character' &&
      ops.find(shown, 'characters', selection.id)
    const route = c && c.route ? c : null
    guide?.show(route)
    cast?.rehearse(route ? c.id : null, ui.routePlay && !ui.routing)
  }
  const entities = entityQueries({
    get layout() {
      return shown
    },
    rooms,
    get world() {
      return world
    },
    get cast() {
      return cast
    },
    light: lightById,
  })

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
    helper: cloud,
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
      ButtonGroup({
        label: '편집 기록',
        children: [
          undoButton,
          redoButton,
          IconButton({
            icon: 'history',
            label: '버전 기록',
            onClick: () =>
              openVersions({
                flush,
                current: () => saved,
                library: () => characterLibrary,
              }),
          }),
        ],
      }),
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
        label: cloud ? 'Blender 파일' : 'Blender 인계',
        icon: 'handoff',
        variant: 'ghost',
        onClick: () =>
          openHandoff({
            cloud,
            revision: () => saved.id,
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
    el('span', {}, '가구·전구를 끌어 옮기기'),
    el('span', {}, '빈 곳을 끌어 화면 이동'),
    el('span', {}, '오른쪽 버튼으로 시점 회전'),
  )
  const floating = Toolbar({
    label: '선택한 모델',
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
  const scope = el('div', { class: 'studio-inspector__scope', hidden: true })
  const portrait = ObjectPreview({
    label: '선택 모델 미리보기',
    onOrbit: (yaw, pitch) => projection?.orbit(yaw, pitch),
  })
  const properties = el('div')
  inspector.append(scope, portrait, properties)
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
        conflict: ['다른 창에서 변경됨 · 다시 열기', reopen],
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
    if (s === 'conflict')
      fail(
        '다른 창에서 먼저 저장해 이 창의 편집은 더 저장되지 않습니다. 다시 열어 이어서 편집하세요.',
      )
  }
  // Reopening after a conflict drops this window's unsaved edits on purpose.
  let reopening = false
  function reopen() {
    reopening = true
    location.reload()
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
  // `restore`: the selection undo or redo brings back, when it still exists.
  function apply(restore) {
    transient = false
    shown = history.value
    world?.update(shown)
    refreshScene()
    if (restore && entities.exists(restore)) return select(restore)
    if (!entities.exists(selection)) return select(null)
    render()
  }
  function change(edit) {
    let result
    history.change((d) => (result = edit(d)), selection)
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
    refreshScene({ moving: true })
  }
  // Undo shows what it changed: the selection made before that edit returns.
  function undo() {
    if (ui.routing) return cancelRoute()
    if (canvas?.cancel() || !history.canUndo) return
    const restore = history.undo(selection)
    autosave.schedule()
    apply(restore)
  }
  function redo() {
    if (canvas?.cancel() || !history.canRedo) return
    const restore = history.redo(selection)
    autosave.schedule()
    apply(restore)
  }
  function select(target, { frame = false } = {}) {
    const sel = target ?? WORLD
    setLightPick(null)
    setPlacing(null)
    endRouting()
    if (selection.id !== sel.id || selection.type !== sel.type) {
      ui.routePlay = false
      canvas?.cancel()
      ui.lightTool = 'move'
      // An address left unfinished keeps the spot's existing link.
      ui.addressing = null
      inspector.scrollTop = 0
    }
    selection = sel
    if (target) ui.tab = sel.type === 'page' ? 'pages' : 'scene'
    if (frame && sel.type === 'world') world?.selectRoom(null)
    else if (frame) canvas?.frame(sel)
    render()
  }
  const selectedItem = () =>
    selection?.type === 'item' && ops.find(shown, 'items', selection.id)
  // New objects go into the room that contains the selection.
  const targetRoom = () => entities.roomOf(selection) || rooms[0].id
  const roomName = (id) => rooms.find((r) => r.id === id)?.label || id

  const selectedCharacter = () =>
    selection?.type === 'character' &&
    ops.find(shown, 'characters', selection.id)
  function duplicate(id = selectedItem()?.id) {
    const character = !id && selectedCharacter()
    if (character) {
      const copy = newId()
      change((d) => ops.duplicateCharacter(d, character.id, copy))
      select({ type: 'character', id: copy })
      notify('복제했습니다. 끌어서 원하는 곳에 놓으세요.')
      return
    }
    if (!id) return
    const copy = newId()
    change((d) => ops.duplicateItem(d, id, copy))
    select({ type: 'item', id: copy })
    notify('복제했습니다. 끌어서 원하는 곳에 놓으세요.')
  }
  function remove() {
    if (selection?.type === 'light') {
      if (sourceMap.has(selection.id)) return
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
    } else if (selection?.type === 'character') {
      const label = selectedCharacter().label
      change((d) => ops.deleteCharacter(d, selection.id))
      notify(label + ' 삭제', true)
    } else if (selection?.type === 'page') removePage(selection.id)
  }

  // ---- Clay and characters ----
  // One default per scope: 'world' (rooms), 'objects', 'characters'.
  function setWorldClay(scope, settings, temporary = false) {
    const edit = (d) => {
      // Older drafts kept one value for every scope; split it first.
      d.defaults ??= {}
      d.defaults.clay = { ...clayDefaults(d) }
      ops.setDefault(d, 'clay', scope, { ...settings })
    }
    temporary ? preview(edit) : change(edit)
  }
  function setClay(id, settings, temporary = false) {
    const edit = (d) => ops.setClay(d, id, settings)
    temporary ? preview(edit) : change(edit)
  }
  function setCharacterDefault(key, value, temporary = false) {
    const edit = (d) => ops.setDefault(d, 'character', key, value)
    temporary ? preview(edit) : change(edit)
  }
  function inheritCharacter(id, key) {
    change((d) => ops.inheritCharacter(d, id, key))
  }
  const modelName = (id) =>
    characterLibrary.models.find((m) => m.id === id)?.name
  // Adds a character of `model` and lets it follow the pointer until a
  // click on a floor places it. Escape leaves it on the free spot it got.
  function addCharacter(
    model = characterLibrary.fallback,
    room = targetRoom(),
  ) {
    const id = newId()
    ui.collapsed.delete('room:' + room)
    const info = characterLibrary.models.find((m) => m.id === model)
    change((d) => {
      const added = ops.addCharacter(d, {
        id,
        room,
        model: model ?? undefined,
        name: info?.name ?? '캐릭터',
      })
      if (info) ops.selectCharacterModel(d, added, model, characterLibrary)
    })
    select({ type: 'character', id }, { frame: true })
    setPlacing(id)
  }
  function setPlacing(id) {
    if (ui.placing === id) return
    // Leaving placement puts a character moved by the pointer back.
    if (ui.placing && !id) cast?.update(shown)
    ui.placing = id
    view.host.classList.toggle('is-placing-light', !!id)
    render()
  }
  // ---- Routes ----
  // The walk clip a new route starts with: a clip named for walking that
  // moves the model, else the motion the character plays, else any clip.
  function walkClip(c) {
    const model = characterModel(characterLibrary, c)
    const clips = characterLibrary.motions
      .filter((m) => m.matched[model])
      .flatMap((m) => m.clips.map((clip) => m.id + '/' + clip.name))
    const own = motionList(characterMotion(shown, c).motion)
    return (
      clips.find((clip) =>
        /걷|walk/i.test(clip.split('/').slice(1).join('/')),
      ) ??
      own.find((clip) => clips.includes(clip)) ??
      clips[0] ??
      null
    )
  }
  const drafted = (r, hover) => ({
    ...r.base,
    points: [
      ...r.base.points,
      ...[...r.added, ...(hover ? [hover] : [])].map((at) => ({ at })),
    ],
  })
  function showRouting(hover) {
    const r = ui.routing
    preview((d) => ops.setRoute(d, r.id, drafted(r, hover)))
  }
  // Floor clicks add points to character `id`'s route until it is finished.
  function startRoute(id) {
    const c = ops.find(history.value, 'characters', id)
    if (!c) return
    const walk = c.route?.walk ?? walkClip(c)
    if (!walk)
      return fail(
        '이 모델을 움직이는 동작이 자료실에 없습니다. 걷기 동작 파일을 먼저 올리세요.',
      )
    if (c.route?.points.length >= routeLimits.points.max)
      return notify(
        '지점은 ' + routeLimits.points.max + '개까지 둘 수 있습니다.',
      )
    setPlacing(null)
    ui.routePlay = false
    ui.routing = {
      id,
      base: c.route ?? { points: [{ at: [0, 0] }], walk },
      added: [],
    }
    view.host.classList.add('is-placing-light')
    syncRoute()
    render()
  }
  // Leaves drawing without touching the selection; the preview goes away.
  function endRouting() {
    if (!ui.routing) return
    ui.routing = null
    view.host.classList.toggle('is-placing-light', !!ui.placing)
    transient = false
    shown = history.value
    world?.update(shown)
    refreshScene()
  }
  function cancelRoute() {
    endRouting()
    render()
  }
  function finishRoute() {
    const r = ui.routing
    if (!r) return
    endRouting()
    if (r.added.length) {
      change((d) => ops.setRoute(d, r.id, drafted(r)))
      notify('경로에 지점 ' + r.added.length + '개를 더했습니다.', true)
    } else render()
  }
  // The pointer's floor point as an offset from character `c`, or null when
  // it is not over the floor of the character's own room.
  function routeOffset(at, c, e) {
    const spot = floorAt(at, c, e)
    if (!spot || spot.room !== c.room) return null
    return [
      ops.round(spot.position[0] - c.position[0]),
      ops.round(spot.position[2] - c.position[2]),
    ]
  }
  let routeDrag = null
  function fitsRoom(c, room, position) {
    return !c.route || !guide || guide.fits(c.route, room, position)
  }
  const routeLeaves = () =>
    notify('경로가 방 바닥을 벗어나 옮기지 않았습니다. 지점을 먼저 옮기세요.')
  // The floor point under the pointer as `{ room, position }`, or null.
  // It follows the grid like a drag; ⌘/Ctrl turns snapping off for a moment.
  function floorAt(at, c, e) {
    const hit = world.floorPoint(at.x, at.y, c.room)
    if (!hit) return null
    const [x, , z] = hit.point
    const align =
      snapping !== !!(e?.metaKey || e?.ctrlKey) ? ops.snap : ops.round
    return {
      room: hit.room,
      position: [align(x), c.position[1], align(z)],
    }
  }
  function useLibrary(next) {
    characterLibrary = next
    cast?.setLibrary(next)
    outlineKey = inspectorKey = ''
    refreshScene()
    render()
    world?.wake()
  }
  async function upload(path, file, done) {
    try {
      const next = await api(
        path + '?name=' + encodeURIComponent(file.name),
        'POST',
        file,
      )
      useLibrary(next.library ?? next)
      notify(done)
      return next
    } catch (e) {
      fail(e.message)
    }
  }
  // Uploads a model; `room` adds a character of it there afterwards.
  async function uploadModel(file, { room } = {}) {
    const next = await upload(
      'admin/characters/models',
      file,
      file.name + ' 모델을 올렸습니다.',
    )
    if (next && room) addCharacter(next.id, room)
  }
  // The add menu cannot hold a file input, so it opens a picker of its own.
  function chooseModelFile(room) {
    const input = el('input', {
      type: 'file',
      accept: '.glb,model/gltf-binary',
    })
    input.addEventListener('change', () => {
      if (input.files[0]) uploadModel(input.files[0], { room })
    })
    input.click()
  }
  const uploadMotion = (file) =>
    upload('admin/characters/motions', file, file.name + ' 동작을 올렸습니다.')
  // Characters (and the world default) that would lose a library file.
  function fileUsers(kind, id) {
    const characters = shown.characters ?? []
    return kind === 'models'
      ? characters.filter((c) => characterModel(characterLibrary, c) === id)
      : [shown.defaults?.character, ...characters].filter((c) =>
          characterClips(c).some((clip) => clip.startsWith(id + '/')),
        )
  }
  // Files in use stay; their characters are changed first.
  async function removeFile(kind, id) {
    const users = fileUsers(kind, id).length
    if (users)
      return fail(
        (kind === 'models' ? '이 모델' : '이 동작 파일') +
          '을 쓰는 곳이 ' +
          users +
          '개 있어 지울 수 없습니다. 다른 것으로 바꾼 뒤 지우세요.',
      )
    try {
      useLibrary(await api('admin/characters/' + kind + '/' + id, 'DELETE'))
      notify('자료실에서 뺐습니다. 같은 파일을 다시 올리면 돌아옵니다.')
    } catch (e) {
      fail(e.message)
    }
  }
  // A new file for a model: characters keep it, and motions embedded in the
  // old file move to the same clips in the new one.
  async function replaceModel(id, file) {
    const next = await upload(
      'admin/characters/models/' + id + '/file',
      file,
      modelName(id) + ' 모델을 새 파일로 바꿨습니다.',
    )
    const moved = next?.motion
    if (!moved) return
    const clips =
      next.library.motions
        .find((m) => m.id === moved.to)
        ?.clips.map((c) => c.name) ?? []
    change((d) => ops.moveMotionFile(d, moved.from, moved.to, clips))
  }
  async function updateModel(id, values) {
    try {
      useLibrary(await api('admin/characters/models/' + id, 'PATCH', values))
    } catch (e) {
      fail(e.message)
    }
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
    const character = !id && selectedCharacter()
    if (character)
      return patch('characters', character.id, {
        yaw: ((((character.yaw + deg + 180) % 360) + 360) % 360) - 180,
      })
    if (!id) return
    change((d) => {
      const i = ops.find(d, 'items', id)
      i.rotation = ops.rotateBy(i.rotation, deg)
    })
  }
  function nudge(key, step) {
    const item = selectedItem() || selectedCharacter()
    const list = selection.type === 'item' ? 'items' : 'characters'
    const axis = item && canvas?.screenAxis(item.room, key)
    if (!axis) return
    change((d) => {
      const i = ops.find(d, list, item.id)
      i.position = i.position.map((v, n) =>
        ops.clampPosition(v + axis[n] * step),
      )
    })
  }
  function addFurniture(kind, room = targetRoom()) {
    const id = newId()
    const def = kinds.find((k) => k.kind === kind)
    change((d) => ops.addItem(d, { id, kind, label: def?.label || kind, room }))
    select({ type: 'item', id }, { frame: true })
    notify(roomName(room) + '에 ' + (def?.label || kind) + '을(를) 놓았습니다.')
  }
  // `pageId`: the page the new area opens; the first page otherwise.
  function addClickArea(anchor, pageId) {
    const id = newId()
    change((d) => {
      const page =
        (pageId && ops.find(d, 'pages', pageId)) ||
        d.pages[0] ||
        ops.addPage(d, { id: newId() })
      ops.addSpot(d, { id, anchor, page })
    })
    select({ type: 'spot', id }, { frame: true })
    if (pageId)
      notify('클릭 영역을 만들어 연결했습니다. 장면에서 끌어 위치를 맞추세요.')
  }
  // The public /events route shows the published world; `?draft` reads the
  // saved draft instead. The tab opens first so the click is not blocked.
  async function openPage(id) {
    const tab = window.open('about:blank', '_blank')
    if (!tab) return fail('브라우저가 새 창을 막았습니다. 팝업을 허용하세요.')
    tab.opener = null
    await flush().catch(() => {})
    tab.location.href = '/events/' + encodeURIComponent(id) + '?draft'
  }
  function addPage() {
    const id = newId()
    change((d) => ops.addPage(d, { id }))
    // A new page starts with a placeholder title, ready to be typed over.
    ui.focus = 'label'
    select({ type: 'page', id })
  }
  function patch(list, id, values) {
    change((d) => Object.assign(ops.find(d, list, id), values))
  }

  function addLight(type, room = targetRoom()) {
    const id = newId(),
      kind = lightKinds[type]
    const item = selectedItem()
    const position = item
      ? [item.position[0], item.position[1] + 3, item.position[2]]
      : [0, 3, 0]
    const names = new Set((shown.lights ?? []).map((l) => l.label))
    let n = 1
    while (names.has(kind.label + ' ' + n)) n++
    ui.collapsed.delete('room:' + room)
    ui.query = ''
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
    if (ui.lightPick === mode) return
    ui.lightPick = mode
    view.host.classList.toggle('is-placing-light', !!mode)
    render()
  }
  function setLightTool(mode) {
    canvas?.cancel()
    ui.lightTool = mode
    setLightPick(null)
    render()
  }
  // Reset one value of a Blender light to the model's original.
  function resetSourceField(id, field) {
    const source = sourceMap.get(id)
    const original = sourceValues(source)[field]
    if (original === undefined) return
    change((d) => editSource(d, source, { [field]: original }))
  }
  function resetAllSources() {
    change((d) => {
      delete d.sourceLights
    })
    notify('모든 Blender 원본 조명을 원본값으로 되돌렸습니다.', true)
  }
  function linkSpot(s, value) {
    if (value === '__url') {
      // Keep the current link until a valid address is entered.
      ui.addressing = s.id
      renderInspector()
      properties.querySelector('[data-key="url"]').focus()
      return
    }
    ui.addressing = null
    if (value === '__new') {
      const id = newId()
      change((d) => {
        const page = ops.addPage(d, { id, title: s.label })
        ops.find(d, 'spots', s.id).action = { type: 'page', page: page.id }
      })
      notify(
        '새 페이지를 만들어 연결했습니다. 행사 페이지 탭에서 내용을 채우세요.',
      )
    } else patch('spots', s.id, { action: { type: 'page', page: value } })
  }
  function moveToRoom(id, room) {
    change((d) => ops.moveToRoom(d, id, room))
    canvas?.frame({ type: 'item', id })
  }

  // ---- Panels ----
  // The facade the outline and inspector modules build from. Panels read the
  // shown draft and view state through it and change the draft only through
  // its commands, so every edit goes through history and autosave.
  const editor = Object.freeze({
    get layout() {
      return shown
    },
    get selection() {
      return selection
    },
    rooms,
    kinds,
    entities,
    sourceCatalog,
    sourceMap,
    view: ui,
    cmd,
    options: (kind) => saved.options?.[kind],
    isSelected: (sel) =>
      selection?.type === sel.type && selection?.id === sel.id,
    roomName,
    targetRoom,
    select,
    showPages() {
      ui.tab = 'pages'
      select(null)
    },
    change,
    patch,
    preview,
    duplicate,
    remove,
    rotate,
    moveToRoom,
    addFurniture,
    addLight,
    addClickArea,
    addPage,
    openPage,
    removePage,
    linkSpot,
    changeLight,
    resetSourceField,
    resetAllSources,
    setLightPick,
    setLightTool,
    zoomRoom: (id) => world?.selectRoom(id),
    get characterLibrary() {
      return characterLibrary
    },
    characterMotion: (c) => characterMotion(shown, c),
    characterModel: (c) => characterModel(characterLibrary, c),
    characterState: (c) => cast?.state(shown, c) ?? 'loading',
    proportionDimensions: (id) => cast?.proportionDimensions(id),
    clayProtection: (id) => cast?.protection(id) ?? null,
    setWorldClay,
    setClayMotion: (settings) =>
      change((d) => ops.setDefault(d, 'clayMotion', null, settings)),
    previewClayMotion(settings) {
      transient = true
      world?.setClayMotion(settings)
    },
    setClay,
    setCharacterDefault,
    setCharacterModel: (id, model) =>
      change((d) =>
        ops.selectCharacterModel(
          d,
          ops.find(d, 'characters', id),
          model,
          characterLibrary,
        ),
      ),
    setCharacterWear: (id, wear, on) =>
      change((d) => ops.setWear(d, id, wear, on)),
    setCharacterProportion(id, key, value, temporary = false) {
      const edit = (layout) => {
        const c = ops.find(layout, 'characters', id)
        c.proportions ??= {}
        c.proportions[key] = value
      }
      temporary ? preview(edit) : change(edit)
    },
    inheritCharacter,
    addCharacter,
    setPlacing,
    // How the scene plays a character's route (see characterLayer.route).
    routeInfo: (id) => cast?.route(id) ?? null,
    // Stride measured from a walking character of this model, if any.
    modelStride: (id) =>
      (shown.characters ?? [])
        .filter((c) => characterModel(characterLibrary, c) === id)
        .map((c) => cast?.route(c.id)?.stride)
        .find((v) => v > 0) ?? null,
    startRoute,
    finishRoute,
    cancelRoute,
    setRoute(id, values, temporary = false) {
      const edit = (d) => ops.patchRoute(d, id, values)
      temporary ? preview(edit) : change(edit)
    },
    removeRoute(id) {
      ui.routePlay = false
      change((d) => ops.setRoute(d, id, null))
      notify('경로를 지웠습니다.', true)
    },
    setRouteStop: (id, index, stop) =>
      change((d) => ops.setRouteStop(d, id, index, stop)),
    removeRoutePoint: (id, index) =>
      change((d) => ops.removeRoutePoint(d, id, index)),
    playRoute(on) {
      ui.routePlay = on
      syncRoute()
      render()
    },
    uploadModel,
    chooseModelFile,
    uploadMotion,
    removeModel: (id) => removeFile('models', id),
    replaceModel,
    updateModel,
    selectLibraryModel(id) {
      ui.libraryModel = ui.libraryModel === id ? null : id
      inspectorKey = ''
      render()
    },
    fileUsers: (kind, id) => fileUsers(kind, id).length,
    removeMotion: (id) => removeFile('motions', id),
    renderOutline,
    renderInspector,
  })

  // Rebuilding identical panels can swallow a click whose press and release
  // land on different elements, so skip rebuilds when nothing changed.
  let outlineKey = '',
    inspectorKey = ''
  function renderOutline() {
    const key = JSON.stringify([
      ui.tab,
      ui.query,
      ui.filter,
      [...ui.collapsed],
      selection,
      shown,
    ])
    if (key === outlineKey) return
    outlineKey = key
    const focused = document.activeElement
    const inTree =
      outline.contains(focused) &&
      focused.classList.contains('ui-tree-item__main')
    renderKeepingFocus(outline, () => outlinePanel(editor))
    // A command that changes the selection (duplicate, undo) also moves the
    // list's keyboard focus, so arrow keys and Enter act on what is selected.
    // This also catches focus dropped when the focused row was removed.
    const selected = JSON.stringify(selection)
    if (selected === outlineSelection) return
    outlineSelection = selected
    const current = outline.querySelector(
      '.ui-tree-item__main[aria-current="true"]',
    )
    if (inTree && current && document.activeElement !== current) current.focus()
  }
  let outlineSelection = ''
  function renderInspector() {
    const key = JSON.stringify([
      selection,
      shown,
      ui.axesOpen,
      ui.roomAddOpen,
      ui.addressing,
      ui.lightPick,
      ui.placing,
      ui.routing?.id,
      ui.routing?.added.length,
      ui.routePlay,
      ui.clayDetail,
      ui.lightTool,
    ])
    if (key === inspectorKey) return
    inspectorKey = key
    scope.replaceChildren(...scopePath(editor))
    scope.hidden = !scope.childElementCount
    renderKeepingFocus(properties, () =>
      inspectors[selection.type](entities.find(selection), editor),
    )
    if (ui.focus) {
      const field = properties.querySelector('[data-key="' + ui.focus + '"]')
      ui.focus = null
      field?.focus()
      field?.select?.()
    }
  }
  // ---- Render loop ----
  let frame = 0
  function render() {
    cancelAnimationFrame(frame)
    // Wait a frame so a Tab keypress finishes moving focus before rebuilding.
    frame = requestAnimationFrame(() => {
      renderOutline()
      projection?.select(entities.modelRoot(selection), selection)
      syncRoute()
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
  // Populate the add menu before it can be opened, while the 3D scene is still starting.
  characterLibrary = await api('admin/characters').catch((e) => {
    fail('캐릭터 자료를 읽지 못했습니다 · ' + e.message)
    return characterLibrary
  })
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
      if (ui.lightPick) return setLightPick(null)
      if (ui.routing) return cancelRoute()
      if (ui.placing) return setPlacing(null)
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
    if (e.key === 'Enter' && ui.routing) {
      e.preventDefault()
      return finishRoute()
    }
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
      if (selection && entities.removable(selection)) {
        e.preventDefault()
        remove()
      }
    } else if (key === 'q' || key === 'e') {
      rotate((key === 'q' ? -1 : 1) * (e.shiftKey ? 90 : ops.ROTATE_STEP))
    } else if (key === 'f') {
      if (selection) select(selection, { frame: true })
    } else if (e.key === '?') {
      help.toggle()
    } else if (
      e.key.startsWith('Arrow') &&
      (selectedItem() || selectedCharacter())
    ) {
      e.preventDefault()
      nudge(e.key, e.shiftKey ? 1 : ops.GRID)
    }
  })
  addEventListener('beforeunload', (e) => {
    if (reopening) return
    if (
      autosave.busy ||
      ['error', 'unauthorized', 'conflict'].includes(autosave.state)
    ) {
      e.preventDefault()
      e.returnValue = ''
      if (autosave.state === 'pending') flush().catch(() => {})
    }
  })

  // ---- Status polling ----
  await publish.refresh().catch((e) => fail(e.message))
  const timer = setInterval(() => {
    if (document.hidden) return
    publish.refresh().catch(() => {})
    if (cloud) resumeUpload().catch(() => {})
  }, 3000)
  addEventListener('pagehide', () => clearInterval(timer), { once: true })

  // ---- Scene ----
  const hooks = {
    layout: () => shown,
    light: lightById,
    isSource: (id) => sourceMap.has(id),
    lightTool: () => (ui.lightPick ? null : ui.lightTool),
    previewLight(id, values) {
      changeLight(id, values, true)
      if (values.position) showLightPosition(properties, values.position)
    },
    commitLight: (id, values) => changeLight(id, values),
    snapping: () => snapping,
    select: (sel) => select(sel),
    toolbar: floating,
    // Placement: the character follows the pointer; a click drops it.
    placing: () => ui.placing,
    placeHover(at, e) {
      const c = ops.find(shown, 'characters', ui.placing)
      const spot = c && floorAt(at, c, e)
      const root = c && cast?.root(c.id)
      if (!spot || !root) return
      root.parent = world.rooms.get(spot.room)
      root.position.set(...spot.position)
      guide?.moveTo(spot.room, spot.position)
      world.wake()
    },
    place(at, e) {
      const c = ops.find(shown, 'characters', ui.placing)
      const spot = c && floorAt(at, c, e)
      if (!spot) {
        notify('방의 바닥을 클릭하세요.')
        return
      }
      if (!fitsRoom(c, spot.room, spot.position)) return routeLeaves()
      setPlacing(null)
      patch('characters', c.id, spot)
      if (spot.room !== c.room)
        notify(roomName(spot.room) + '(으)로 옮겼습니다.', true)
    },
    // Route drawing: each floor click in the character's room adds a point.
    routing: () => !!ui.routing,
    routeHover(at, e) {
      const c = ops.find(history.value, 'characters', ui.routing.id)
      const offset = c && routeOffset(at, c, e)
      if (offset) showRouting(offset)
    },
    routeClick(at, e) {
      const r = ui.routing
      const c = ops.find(history.value, 'characters', r.id)
      const offset = c && routeOffset(at, c, e)
      if (!offset) return notify('캐릭터가 있는 방의 바닥을 누르세요.')
      const last = r.added.at(-1) ?? r.base.points.at(-1).at
      // The last point pressed again ends the route.
      if (Math.hypot(offset[0] - last[0], offset[1] - last[1]) < 0.01)
        return finishRoute()
      r.added.push(offset)
      if (r.base.points.length + r.added.length >= routeLimits.points.max)
        return finishRoute()
      showRouting()
      inspectorKey = ''
      render()
    },
    // Route points of the selected character can be dragged along the floor.
    routePointAt: (at) =>
      selection?.type === 'character' && guide ? guide.pointAt(at.x, at.y) : -1,
    routePointMove(index, at, e) {
      const c = ops.find(history.value, 'characters', selection.id)
      const offset = c && routeOffset(at, c, e)
      if (!offset) return
      routeDrag = { id: c.id, index, offset }
      preview((d) => ops.moveRoutePoint(d, c.id, index, offset))
    },
    routePointDrop() {
      const drag = routeDrag
      routeDrag = null
      if (!drag) return apply()
      change((d) => ops.moveRoutePoint(d, drag.id, drag.index, drag.offset))
    },
    modelRoot: entities.modelRoot,
    character: (id) => ops.find(shown, 'characters', id),
    characterMoving: (room, position) => guide?.moveTo(room, position),
    commitCharacter(id, values) {
      const c = ops.find(shown, 'characters', id)
      if (c && !fitsRoom(c, values.room ?? c.room, values.position)) {
        apply()
        return routeLeaves()
      }
      patch('characters', id, values)
      if (values.room)
        notify(roomName(values.room) + '(으)로 옮겼습니다.', true)
    },
    pickLightPoint(at) {
      if (!ui.lightPick) return false
      const light = selection?.type === 'light' && lightById(selection.id)
      if (!light) {
        setLightPick(null)
        return false
      }
      const point = world.roomPoint(at.x, at.y, light.room)
      if (!point) {
        notify(
          light.room
            ? roomName(light.room) + '의 바닥이나 물체를 클릭하세요.'
            : '방의 바닥이나 물체를 클릭하세요.',
        )
        return true
      }
      let values
      if (ui.lightPick === 'aim') {
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
      changeLight(light.id, values)
      return true
    },
    dragging(on) {
      view.host.classList.toggle('is-dragging', on)
    },
    itemMoved: () => projection.invalidate(),
    revert() {
      routeDrag = null
      apply()
      if (selection?.type === 'light') {
        const light = lightById(selection.id)
        if (light) showLightPosition(properties, light.position)
      }
    },
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
      onLightDown: (id, e) => hooks.lightDown?.(id, e),
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
  // A model that finishes loading replaces its stand-ins.
  guide = routeGuide(world)
  cast = characterLayer(world, {
    onLoad() {
      refreshScene()
      inspectorKey = ''
      render()
      world.wake()
    },
    // A route's clips were read: the inspector can show its pace.
    onRoute() {
      inspectorKey = ''
      render()
    },
  })
  cast.setLibrary(characterLibrary)
  refreshScene()
  projection = selectionPreview(
    world,
    portrait,
    () => selection?.type === 'character' && cast.playing(selection.id),
  )
  canvas = attachCanvas(world, view, hooks)
  render()
}
