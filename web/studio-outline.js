import { lightKinds, lightLimit } from '../shared/studio-lights.mjs'
import { resolvedSources } from '../shared/source-lights.mjs'
import {
  el,
  Button,
  EmptyState,
  Menu,
  Segmented,
  Tabs,
  TextInput,
  TreeItem,
} from './ds/index.js'
import { WORLD } from './studio-entities.js'

// The left panel. The 장면 tab lists the world as one scope tree —
// 월드 › 방 › 가구·캐릭터 › 클릭 영역, with each light under the scope it lights —
// and the 행사 페이지 tab lists pages. One 추가 menu creates every kind of
// object in the selected scope, so new object kinds join that menu instead of
// adding another button to the panel.

const filters = [
  { value: 'all', label: '전체' },
  { value: 'item', label: '가구' },
  { value: 'light', label: '조명' },
  { value: 'spot', label: '클릭 영역' },
  { value: 'character', label: '캐릭터' },
]

export function outline(editor) {
  const { view } = editor
  return [
    el(
      'div',
      { class: 'studio-outline__head' },
      Tabs({
        label: '목록',
        value: view.tab,
        items: [
          { id: 'scene', label: '장면' },
          {
            id: 'pages',
            label: '행사 페이지',
            count: editor.layout.pages.length,
          },
        ],
        onChange: (id) => {
          view.tab = id
          editor.renderOutline()
        },
      }),
      ...(view.tab === 'scene' ? sceneTools(editor) : pageTools(editor)),
    ),
    el(
      'div',
      {
        class: 'studio-outline__list',
        role: 'list',
        onclick: (event) => {
          if (event.target === event.currentTarget) editor.select(null)
        },
      },
      ...(view.tab === 'scene' ? sceneTree(editor) : pageList(editor)),
    ),
  ]
}

function sceneTools(editor) {
  const { view } = editor
  return [
    el(
      'div',
      { class: 'studio-outline__tools' },
      TextInput({
        label: '장면에서 찾기',
        placeholder: '이름으로 찾기',
        type: 'search',
        icon: 'search',
        size: 'sm',
        key: 'search',
        value: view.query,
        onInput: (v) => {
          view.query = v
          editor.renderOutline()
        },
      }),
      addMenu(editor),
    ),
    Segmented({
      label: '목록 필터',
      key: 'filter',
      size: 'sm',
      value: view.filter,
      options: filters,
      onChange: (value) => {
        view.filter = value
        editor.renderOutline()
      },
    }),
  ]
}

/** One menu that adds every kind of object to the selected scope. */
export function addMenu(editor) {
  const trigger = Button({
    label: '추가',
    icon: 'add',
    size: 'sm',
    variant: 'secondary',
    key: 'add',
  })
  return Menu({
    trigger,
    label: '추가',
    width: 'md',
    placement: 'bottom-start',
    sections: () => {
      const room = editor.targetRoom()
      const roomName = editor.roomName(room)
      const lights = editor.layout.lights?.length ?? 0
      const full = lights >= lightLimit
      const sel = editor.selection
      const anchor =
        sel?.type === 'item' || sel?.type === 'room'
          ? { id: sel.id, name: editor.entities.name(sel) }
          : null
      return [
        {
          heading: '가구 · ' + roomName + '에 놓기',
          items: editor.kinds.map((k) => ({
            label: k.label,
            icon: 'furniture',
            onSelect: () => editor.addFurniture(k.kind, room),
          })),
        },
        {
          // Each model is one entry; the new character then follows the
          // pointer until a floor click places it.
          heading: '캐릭터 · ' + roomName + '에 놓기',
          items: [
            ...editor.characterLibrary.models.map((m) => ({
              label: m.name,
              hint: m.builtin ? '기본 모델' : '관절 ' + m.joints + '개',
              icon: 'character',
              onSelect: () => editor.addCharacter(m.id, room),
            })),
            ...(editor.libraryReadOnly
              ? []
              : [
                  {
                    label: '새 모델 올리기…',
                    hint: '리깅된 GLB',
                    icon: 'upload',
                    onSelect: () => editor.chooseModelFile(room),
                  },
                ]),
          ],
        },
        {
          heading: full
            ? '조명 · 최대 ' + lightLimit + '개를 모두 썼습니다'
            : '조명 · ' + roomName + '에 놓기',
          items: Object.entries(lightKinds).map(([type, kind]) => ({
            label: kind.label,
            hint: kind.use,
            icon: type === 'point' ? 'light' : 'light-' + type,
            disabled: full,
            onSelect: () => editor.addLight(type, room),
          })),
        },
        {
          heading: '클릭 영역',
          items: anchor
            ? [
                {
                  label: anchor.name + '에 클릭 영역',
                  icon: 'spot',
                  onSelect: () => editor.addClickArea(anchor.id),
                },
              ]
            : [],
        },
        {
          heading: '행사 페이지',
          items: [
            {
              label: '새 행사 페이지',
              icon: 'page',
              onSelect: () => editor.addPage(),
            },
          ],
        },
      ]
    },
  }).element
}

function sceneTree(editor) {
  const { view, layout, rooms } = editor
  const query = view.query.trim().toLowerCase()
  const show = (type) => view.filter === 'all' || view.filter === type
  const match = (label) => !query || label.toLowerCase().includes(query)
  const narrowed = !!query || view.filter !== 'all'
  const sources = resolvedSources(editor.sourceCatalog, layout.sourceLights)
  const row = (sel, label, props = {}) =>
    TreeItem({
      label,
      key: sel.type + ':' + sel.id,
      icon: editor.entities.icon(sel),
      selected: editor.isSelected(sel),
      onSelect: () => editor.select(sel, { frame: true }),
      ...props,
    })
  const lightRows = (room, depth) =>
    show('light')
      ? [
          ...(layout.lights ?? []).filter((l) => l.room === room),
          ...sources.filter((l) => (l.room ?? null) === room),
        ]
          .filter((l) => match(l.label))
          .map((l) => {
            const native = editor.sourceMap.has(l.id)
            const off = l.enabled === false
            return row({ type: 'light', id: l.id }, l.label, {
              depth,
              meta: [native ? 'Blender' : null, off ? '꺼짐' : null]
                .filter(Boolean)
                .join(' · '),
            })
          })
      : []
  const group = (sel, label, props, children) => {
    const key = sel.type + ':' + sel.id
    const open = narrowed || !view.collapsed.has(key)
    return el(
      'div',
      { class: 'studio-outline__group', role: 'listitem' },
      row(sel, label, {
        ...props,
        ...(children.length
          ? {
              expanded: open,
              onToggle: () => {
                view.collapsed.has(key)
                  ? view.collapsed.delete(key)
                  : view.collapsed.add(key)
                editor.renderOutline()
              },
            }
          : {}),
      }),
      ...(open ? children : []),
    )
  }

  const worldChildren = lightRows(null, 1)
  const groups = []
  if (!narrowed || worldChildren.length)
    groups.push(group(WORLD, '월드', { meta: '기본 설정' }, worldChildren))
  for (const r of rooms) {
    const items = layout.items.filter((i) => i.room === r.id)
    const children = []
    for (const i of items) {
      const spots = layout.spots.filter((s) => s.anchor === i.id)
      if (view.filter === 'spot') {
        for (const s of spots.filter((s) => match(s.label) || match(i.label)))
          children.push(
            row({ type: 'spot', id: s.id }, s.label, {
              depth: 1,
              meta: i.label,
            }),
          )
        continue
      }
      if (!show('item')) continue
      const shownSpots = view.filter === 'all' ? spots : []
      const spotMatches = shownSpots.filter((s) => match(s.label))
      if (!match(i.label) && !spotMatches.length) continue
      children.push(row({ type: 'item', id: i.id }, i.label, { depth: 1 }))
      for (const s of match(i.label) ? shownSpots : spotMatches)
        children.push(row({ type: 'spot', id: s.id }, s.label, { depth: 2 }))
    }
    if (show('spot'))
      for (const s of layout.spots.filter(
        (s) => s.anchor === r.id && match(s.label),
      ))
        children.push(row({ type: 'spot', id: s.id }, s.label, { depth: 1 }))
    if (show('character'))
      for (const c of (layout.characters ?? []).filter(
        (c) => c.room === r.id && match(c.label),
      ))
        children.push(
          row({ type: 'character', id: c.id }, c.label, {
            depth: 1,
            meta: characterMeta(editor, c),
          }),
        )
    children.push(...lightRows(r.id, 1))
    if (narrowed && !children.length && !(query && match(r.label))) continue
    groups.push(
      group(
        { type: 'room', id: r.id },
        r.label,
        { meta: String(items.length + charactersIn(layout, r.id)) },
        children,
      ),
    )
  }
  if (!groups.length)
    return [
      EmptyState({
        title: '찾는 항목이 없습니다',
        description: '다른 이름이나 필터로 찾아보세요.',
      }),
    ]
  return groups
}

function pageTools(editor) {
  return [
    Button({
      label: '새 페이지',
      icon: 'add',
      size: 'sm',
      wide: true,
      key: 'add-page',
      onClick: () => editor.addPage(),
    }),
  ]
}

function pageList(editor) {
  const { layout } = editor
  if (!layout.pages.length)
    return [
      EmptyState({
        icon: 'page',
        title: '행사 페이지가 없습니다',
        description: '새 페이지를 만들어 클릭 영역과 연결하세요.',
      }),
    ]
  return layout.pages.map((p) => {
    const n = layout.spots.filter((s) => s.action.page === p.id).length
    const sel = { type: 'page', id: p.id }
    return TreeItem({
      label: p.title,
      key: 'page:' + p.id,
      icon: 'page',
      meta: n ? '연결 ' + n : '연결 없음',
      selected: editor.isSelected(sel),
      onSelect: () => editor.select(sel),
    })
  })
}

const charactersIn = (layout, room) =>
  (layout.characters ?? []).filter((c) => c.room === room).length

// The clip a character plays (the first and how many follow), or 정지.
function characterMeta(editor, c) {
  const clips = [editor.characterMotion(c).motion ?? []].flat()
  if (!clips.length) return '정지'
  const first = clips[0].split('/').slice(1).join('/')
  return clips.length > 1 ? first + ' 외 ' + (clips.length - 1) : first
}
