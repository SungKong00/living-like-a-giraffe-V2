import { lightLimit } from '../shared/studio-lights.mjs'
import {
  el,
  Breadcrumbs,
  Button,
  ButtonGroup,
  Callout,
  Chip,
  ChipList,
  Disclosure,
  FileButton,
  FileList,
  IconButton,
  Menu,
  NumberInput,
  PanelHeader,
  PanelSection,
  PropertyRow,
  Segmented,
  Select,
  Slider,
  SwatchPicker,
  TextArea,
  TextInput,
  Toggle,
} from './ds/index.js'
import { giraffeProportionSection } from './giraffe-proportion-controls.js'
import { clayMotionSection, hatchRow } from './clay-motion-controls.js'
import { lightInspector } from './light-inspector.js'
import * as ops from './edit-ops.js'
import { routeDefaults, routeLimits } from '../shared/character-route.mjs'
import {
  clayDefaults,
  clayFor,
  clayPresetOf,
  clayPresets,
  clayScopes,
} from './clay-field.js'

// The right panel. Strategy: one builder per entity type, looked up by the
// selection's type. Each builder reads top to bottom as
// PanelHeader → PanelSection*, and a row whose value replaces an inherited one
// (a Blender original, the model's own material, later the world defaults)
// passes PropertyRow's `override` so every editor marks overrides the same way.
// To edit a new kind of object, add its type to studio-entities.js and its
// builder here.

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
const MODEL = '모델 원본'

export const inspectors = Object.freeze({
  world: worldInspector,
  room: roomInspector,
  item: itemInspector,
  character: characterInspector,
  light: lightEditor,
  spot: spotInspector,
  page: pageInspector,
})

/** Where the selection sits: each wider scope is one click away. */
export function scopePath(editor) {
  const sel = editor.selection
  const { entities } = editor
  const chain =
    sel.type === 'page'
      ? [
          {
            label: '행사 페이지',
            icon: 'page',
            onSelect: () => editor.showPages(),
          },
          { label: entities.name(sel) },
        ]
      : entities.path(sel).map((at, index, all) => ({
          label: entities.name(at),
          icon: entities.icon(at),
          key: 'crumb:' + at.type + ':' + at.id,
          onSelect:
            index < all.length - 1
              ? () => editor.select(at, { frame: true })
              : undefined,
        }))
  // The world is the root scope; a one-step path would only repeat the title.
  return chain.length > 1
    ? [Breadcrumbs({ label: '선택 범위', items: chain })]
    : []
}

export const labelInput = (label, value, commit) =>
  TextInput({
    appearance: 'title',
    key: 'label',
    label,
    value,
    validate: ops.labelError,
    onCommit: commit,
  })

const muted = (text) => el('p', { class: 'studio-muted' }, text)

const chips = (editor, sels, empty) =>
  sels.length
    ? ChipList(
        sels.map((sel) =>
          Chip({
            label: editor.entities.name(sel),
            icon: editor.entities.icon(sel),
            key: 'chip:' + sel.type + ':' + sel.id,
            onClick: () => editor.select(sel, { frame: true }),
          }),
        ),
      )
    : muted(empty)

// ---- 월드 ----
// The widest scope. Values here apply to every room and object unless an
// object's own editor overrides them. Each entry below is one category of
// world-wide settings; defaults for objects, the background and characters join
// this list as they are built, and the objects' own editors mark overrides
// with PropertyRow's `override`.
const worldSections = [
  composition,
  (editor) =>
    clayMotionSection(
      editor.layout.defaults?.clayMotion,
      editor.setClayMotion,
      editor.previewClayMotion,
    ),
  worldClay('world'),
  worldClay('objects'),
  worldClay('characters'),
  worldCharacters,
  characterLibrarySection,
  worldLighting,
]

function worldInspector(_world, editor) {
  return [
    PanelHeader({
      eyebrow: '전체 범위',
      icon: 'world',
      title: '월드',
      description:
        '모든 방과 개체에 공통으로 적용되는 범위입니다. 개체 편집기에서 바꾼 값은 여기보다 우선합니다.',
    }),
    ...worldSections.map((section) => section(editor)),
  ]
}

function composition(editor) {
  const { layout, rooms } = editor
  return PanelSection({
    title: '구성',
    children: [
      PropertyRow({
        label: '방',
        children: [
          chips(
            editor,
            rooms.map((r) => ({ type: 'room', id: r.id })),
            '방이 없습니다.',
          ),
        ],
      }),
      PropertyRow({
        label: '개체',
        children: [
          muted(
            [
              ['가구', layout.items.length],
              ['캐릭터', layout.characters?.length ?? 0],
              [
                '조명',
                editor.sourceCatalog.length + (layout.lights?.length ?? 0),
              ],
              ['클릭 영역', layout.spots.length],
              ['행사 페이지', layout.pages.length],
            ]
              .map(([label, n]) => label + ' ' + n)
              .join(' · '),
          ),
        ],
      }),
    ],
  })
}

function worldLighting(editor) {
  const lights = editor.layout.lights ?? []
  const sources = editor.sourceCatalog
  const edited = editor.layout.sourceLights ?? []
  return PanelSection({
    title: '조명',
    meta:
      '추가 ' + lights.length + '/' + lightLimit + ' · 원본 ' + sources.length,
    children: [
      PropertyRow({
        label: '월드 전체',
        stack: true,
        children: [
          chips(
            editor,
            sources
              .filter((l) => !l.room)
              .map((l) => ({ type: 'light', id: l.id })),
            '방에 속하지 않은 원본 조명이 없습니다.',
          ),
        ],
      }),
      PropertyRow({
        label: 'Blender 원본 수정',
        stack: true,
        override: edited.length && {
          from: 'Blender 원본',
          subject: '수정한 원본 조명 ' + edited.length + '개',
          onReset: () => editor.resetAllSources(),
        },
        children: [
          muted(
            edited.length
              ? edited.length + '개를 수정했습니다.'
              : '모두 원본 그대로입니다.',
          ),
        ],
      }),
      Callout({
        message:
          '방에 속한 조명은 왼쪽 목록에서 그 방 아래에 있습니다. 새 조명은 목록의 추가 메뉴에서 놓습니다.',
      }),
    ],
  })
}

// ---- 조명 ----
// Blender lights inherit every value from the model; the draft stores only
// the fields a producer changed, and each of those rows can be reset.
function lightEditor(light, editor) {
  const source = editor.sourceMap.get(light.id)
  const edit =
    source && editor.layout.sourceLights?.find((e) => e.id === light.id)
  const set = (values) => editor.changeLight(light.id, values)
  return lightInspector(light, {
    rooms: editor.rooms,
    tool: editor.view.lightTool,
    setTool: editor.setLightTool,
    picking: editor.view.lightPick,
    pick: editor.setLightPick,
    source,
    reset: () => editor.changeLight(light.id, null),
    modified: !!edit,
    overridden: (field) => !!edit && field in edit,
    resetField: (field) => editor.resetSourceField(light.id, field),
    title: source
      ? light.label
      : labelInput('조명 이름', light.label, (label) => set({ label })),
    set,
    preview: (values) => editor.changeLight(light.id, values, true),
    remove: () => editor.remove(),
  })
}

// ---- 방 ----
function roomInspector(r, editor) {
  const { layout, kinds } = editor
  const items = layout.items.filter((i) => i.room === r.id)
  const lights = [
    ...(layout.lights ?? []).filter((l) => l.room === r.id),
    ...editor.sourceCatalog.filter((l) => l.room === r.id),
  ]
  return [
    PanelHeader({
      eyebrow: '방',
      icon: 'room',
      title: r.label,
      description:
        '가구 ' +
        items.length +
        '개 · 조명 ' +
        lights.length +
        '개 · 방 기준 클릭 영역 ' +
        ops.spotsOn(layout, r.id).length +
        '개',
      actions: [
        IconButton({
          icon: 'fit',
          label: '이 방 확대',
          key: 'zoom-room',
          onClick: () => editor.zoomRoom(r.id),
        }),
      ],
    }),
    PanelSection({
      title: '가구',
      meta: items.length + '개',
      children: [
        chips(
          editor,
          items.map((i) => ({ type: 'item', id: i.id })),
          '이 방에는 아직 가구가 없습니다.',
        ),
        kinds.length
          ? Disclosure({
              summary: '이 방에 가구 놓기',
              open: editor.view.roomAddOpen,
              onToggle: (open) => (editor.view.roomAddOpen = open),
              children: [
                ChipList(
                  kinds.map((k) =>
                    Chip({
                      label: k.label,
                      icon: 'add',
                      key: 'add:' + k.kind,
                      onClick: () => editor.addFurniture(k.kind, r.id),
                    }),
                  ),
                ),
              ],
            })
          : null,
      ].filter(Boolean),
    }),
    PanelSection({
      title: '조명',
      meta: lights.length + '개',
      children: [
        chips(
          editor,
          lights.map((l) => ({ type: 'light', id: l.id })),
          '이 방에 속한 조명이 없습니다.',
        ),
      ],
    }),
    claySection(r.id, editor, 'world'),
    spotSection(r.id, editor),
  ]
}

// ---- 가구 ----
function itemInspector(i, editor) {
  const allowed = editor.options(i.kind) || {
    colors: ['*'],
    finishes: ['original', 'matte', 'gloss'],
  }
  const set = (values) => editor.patch('items', i.id, values)
  const preview = (edit) =>
    editor.preview((d) => edit(ops.find(d, 'items', i.id)))
  const yaw = ops.yawOf(i.rotation)
  const uniform = i.scale.every((v) => Math.abs(v - i.scale[0]) < 1e-6)
  const kindName = editor.kinds.find((k) => k.kind === i.kind)?.label || i.kind
  const anyColor = allowed.colors.includes('*')
  const at = (n, v) =>
    i.position.map((p, k) => (k === n ? ops.clampPosition(v) : p))
  return [
    PanelHeader({
      eyebrow: kindName,
      icon: 'furniture',
      title: labelInput('이름', i.label, (label) => set({ label })),
      actions: [
        IconButton({
          icon: 'copy',
          label: '복제',
          shortcut: editor.cmd + 'D',
          key: 'duplicate',
          onClick: () => editor.duplicate(i.id),
        }),
        IconButton({
          icon: 'delete',
          label: '삭제',
          variant: 'danger',
          shortcut: 'Delete',
          key: 'delete',
          onClick: () => editor.remove(),
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
              options: editor.rooms.map((r) => ({
                value: r.id,
                label: r.label,
              })),
              onChange: (room) => editor.moveToRoom(i.id, room),
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
              onCommit: (v) => set({ position: at(0, v) }),
            }),
            NumberInput({
              label: '위치 Z',
              prefix: 'Z',
              key: 'z',
              value: i.position[2],
              onCommit: (v) => set({ position: at(2, v) }),
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
              onCommit: (v) => set({ position: at(1, v) }),
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
                preview((d) => (d.rotation = ops.withYaw(i.rotation, v))),
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
                  onClick: () => editor.rotate(-15, i.id),
                }),
                IconButton({
                  icon: 'rotate-right',
                  label: '오른쪽으로 15° 회전',
                  size: 'sm',
                  key: 'rot-right',
                  onClick: () => editor.rotate(15, i.id),
                }),
              ],
            }),
            Button({
              label: '90° 회전',
              icon: 'rotate-right',
              size: 'sm',
              variant: 'ghost',
              key: 'rot-90',
              onClick: () => editor.rotate(90, i.id),
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
              onInput: (v) => preview((d) => (d.scale = [v, v, v])),
              onCommit: (v) => set({ scale: [v, v, v].map(ops.clampScale) }),
            }),
          ],
        }),
        Disclosure({
          summary: uniform
            ? '축별 크기'
            : '축별 크기 · 슬라이더는 세 축을 같게 맞춥니다',
          open: editor.view.axesOpen || !uniform,
          onToggle: (open) => (editor.view.axesOpen = open),
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
      meta: '비워 두면 ' + MODEL,
      children: [
        PropertyRow({
          label: '색',
          override: i.color !== 'original' && {
            from: MODEL,
            onReset: () => set({ color: 'original' }),
          },
          children: [
            SwatchPicker({
              label: '가구 색',
              value: i.color,
              colors: anyColor ? ['original', ...palette] : allowed.colors,
              allowCustom: anyColor,
              onPreview: (c) => preview((d) => (d.color = c)),
              onChange: (color) => set({ color }),
            }),
          ],
        }),
        PropertyRow({
          label: '표면',
          override: i.finish !== 'original' && {
            from: MODEL,
            onReset: () => set({ finish: 'original' }),
          },
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
    claySection(i.id, editor, 'objects'),
    spotSection(i.id, editor),
  ]
}

function spotSection(anchor, editor) {
  const spots = ops.spotsOn(editor.layout, anchor)
  return PanelSection({
    title: '클릭 영역',
    meta: spots.length + '개',
    children: [
      spots.length
        ? chips(
            editor,
            spots.map((s) => ({ type: 'spot', id: s.id })),
            '',
          )
        : null,
      Button({
        label: '클릭 영역 추가',
        icon: 'add',
        size: 'sm',
        wide: true,
        key: 'add-spot',
        onClick: () => editor.addClickArea(anchor),
      }),
    ].filter(Boolean),
  })
}

// ---- 클릭 영역 ----
function spotInspector(s, editor) {
  const { layout, rooms, view } = editor
  const set = (values) => editor.patch('spots', s.id, values)
  const external = s.action.type === 'url'
  const linking = external || view.addressing === s.id
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
            onClick: () => editor.select({ type: 'page', id: s.action.page }),
          }),
        ],
      })
  return [
    PanelHeader({
      eyebrow: '클릭 영역',
      icon: 'spot',
      title: labelInput('표시 이름', s.label, (label) => set({ label })),
      actions: [
        IconButton({
          icon: 'delete',
          label: '삭제',
          variant: 'danger',
          shortcut: 'Delete',
          key: 'delete',
          onClick: () => editor.remove(),
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
                ...layout.pages.map((p) => ({
                  value: p.id,
                  label: '페이지 · ' + p.title,
                })),
                { value: '__url', label: '외부 링크 열기' },
                { value: '__new', label: '＋ 새 페이지 만들어 연결' },
              ],
              onChange: (v) => editor.linkSpot(s, v),
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
                ...layout.items.map((i) => ({
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

// ---- 행사 페이지 ----
function pageInspector(p, editor) {
  const set = (values) => editor.patch('pages', p.id, values)
  const linked = editor.layout.spots.filter((s) => s.action.page === p.id)
  return [
    PanelHeader({
      eyebrow: '행사 페이지',
      icon: 'page',
      title: labelInput('제목', p.title, (title) => set({ title })),
      actions: [
        IconButton({
          icon: 'external',
          label: '초안으로 새 창에서 보기',
          key: 'open-page',
          onClick: () => editor.openPage(p.id),
        }),
        IconButton({
          icon: 'delete',
          label: '페이지 삭제',
          variant: 'danger',
          key: 'delete-page',
          onClick: () => editor.removePage(p.id),
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
        chips(
          editor,
          linked.map((s) => ({ type: 'spot', id: s.id })),
          '아직 이 페이지를 여는 클릭 영역이 없습니다.',
        ),
        pageSpotMenu(p, editor),
      ],
    }),
  ]
}

// Adds a click area that opens this page, on a room or a piece of furniture.
function pageSpotMenu(p, editor) {
  const { layout, rooms } = editor
  return Menu({
    trigger: Button({
      label: '클릭 영역 추가',
      icon: 'add',
      size: 'sm',
      variant: 'secondary',
      key: 'add-page-spot',
    }),
    label: '이 페이지를 여는 클릭 영역 추가',
    // Narrow enough to stay inside the panel, which clips what overflows.
    width: 'sm',
    // The button sits at the bottom of the panel, so the menu opens upward.
    placement: 'top-start',
    sections: () => [
      {
        heading: '방에 붙이기',
        items: rooms.map((r) => ({
          label: r.label,
          icon: 'room',
          onSelect: () => editor.addClickArea(r.id, p.id),
        })),
      },
      {
        heading: '가구에 붙이기',
        items: layout.items.map((i) => ({
          label: i.label,
          hint: editor.roomName(i.room),
          icon: 'furniture',
          onSelect: () => editor.addClickArea(i.id, p.id),
        })),
      },
    ],
  }).element
}

// ---- 점토 ----
const WORLD_SCOPE = '월드'
const presetNames = {
  original: '원본',
  light: '약하게',
  medium: '보통',
  strong: '강하게',
}
const notPublished =
  '편집 화면에서만 보이며 관람 화면에는 아직 반영되지 않습니다.'

// Preset buttons and the three values behind them. `onPreview` follows a
// slider while it moves; `onCommit` records one edit.
function clayRows({ key, value, onPreview, onCommit, override, editor }) {
  const slider = (label, prop) =>
    Slider({
      label: '점토 ' + label,
      key: key + '-' + prop,
      min: 0,
      max: 100,
      step: 1,
      value: value[prop],
      format: (v) => String(Math.round(v)),
      onInput: (v) => onPreview({ ...value, [prop]: v }),
      onCommit: (v) => onCommit({ ...value, [prop]: v }),
    })
  return [
    PropertyRow({
      label: '단계',
      override,
      children: [
        Segmented({
          label: '점토 단계',
          key: key + '-preset',
          size: 'sm',
          value: clayPresetOf(value),
          options: Object.entries(presetNames).map(([v, label]) => ({
            value: v,
            label,
          })),
          onChange: (preset) => onCommit({ ...clayPresets[preset] }),
        }),
      ],
    }),
    Disclosure({
      summary: '세부 조절',
      open: !!editor.view.clayDetail[key],
      onToggle: (open) => (editor.view.clayDetail[key] = open),
      children: [
        ...(key === 'clay-world'
          ? [
              hatchRow(
                editor.layout.defaults?.clayMotion,
                editor.setClayMotion,
                editor.previewClayMotion,
              ),
            ]
          : []),
        PropertyRow({ label: '굴곡', children: [slider('굴곡', 'strength')] }),
        PropertyRow({
          label: '눌림',
          children: [slider('눌림 깊이', 'depth')],
        }),
        PropertyRow({
          label: '자국',
          children: [slider('자국 크기', 'width')],
        }),
      ],
    }),
  ]
}

// One section per kind: the rooms' own geometry, movable furniture and
// characters each have a world-wide default that their objects follow.
function worldClay(scope) {
  return (editor) => {
    const value = clayDefaults(editor.layout)[scope] ?? clayPresets.original
    const preset = clayPresetOf(value)
    const overridden = Object.keys(editor.layout.overrides?.clay ?? {}).filter(
      (id) => ownerScope(editor, id) === scope,
    ).length
    return PanelSection({
      title: '점토 · ' + clayScopes[scope].label,
      meta:
        (preset === 'custom' ? '직접 조절' : presetNames[preset]) +
        (overridden ? ' · 따로 정한 ' + overridden + '개' : ''),
      children: [
        muted(clayScopes[scope].hint + '의 기본 질감입니다.'),
        ...clayRows({
          key: 'clay-' + scope,
          value,
          editor,
          onPreview: (v) => editor.setWorldClay(scope, v, true),
          onCommit: (v) => editor.setWorldClay(scope, v),
        }),
        ...(scope === 'world' ? [muted(notPublished)] : []),
      ],
    })
  }
}
const ownerScope = (editor, id) =>
  editor.rooms.some((r) => r.id === id)
    ? 'world'
    : editor.layout.items.some((i) => i.id === id)
      ? 'objects'
      : 'characters'

function claySection(id, editor, scope) {
  const own = editor.layout.overrides?.clay?.[id]
  const from = clayScopes[scope].label + ' 기본'
  return PanelSection({
    title: '점토',
    meta: own
      ? '이 ' + (scope === 'world' ? '방' : '개체') + '만 따로'
      : from + ' 따름',
    children: clayRows({
      key: 'clay',
      value: clayFor(editor.layout, id, scope),
      editor,
      override: own && {
        from,
        subject: '점토',
        onReset: () => editor.setClay(id, null),
      },
      onPreview: (v) => editor.setClay(id, v, true),
      onCommit: (v) => editor.setClay(id, v),
    }),
  })
}

// ---- 캐릭터 ----
const STILL = '__still'
// Motions that move `model` (any model when omitted), plus 정지. A value no
// longer in the library stays listed so the field never shows the wrong clip.
function motionOptions(editor, current, model) {
  const options = [{ value: STILL, label: '정지' }]
  for (const m of editor.characterLibrary.motions)
    if (!model || m.matched[model])
      for (const clip of m.clips)
        options.push({
          value: m.id + '/' + clip.name,
          label: m.name + ' · ' + clip.name,
        })
  if (current && !options.some((o) => o.value === current))
    options.push({
      value: current,
      label: '맞지 않는 동작 · ' + current.split('/').slice(1).join('/'),
    })
  return options
}
const clipsOf = (motion) => (motion == null ? [] : [motion].flat())
// One clip is stored as a string, several as a list, none as null (still).
const motionOf = (list) =>
  list.length === 0 ? null : list.length === 1 ? list[0] : list
const clipLabel = (editor, value) => {
  const [file, ...rest] = value.split('/')
  const m = editor.characterLibrary.motions.find((x) => x.id === file)
  return (m ? m.name + ' · ' : '맞지 않는 동작 · ') + rest.join('/')
}
const MOTION_LIMIT = 8

/**
 * Rows for a motion value and its play order: the first clip, the clips that
 * follow it, a picker to add one, and 차례대로/무작위 when there are several.
 * `override(key, subject)` gives a row's override badge; `prefix` names the
 * controls ('기본' in the world panel, '캐릭터' in a character).
 */
function motionRows(editor, o) {
  const list = clipsOf(o.motion)
  const options = (current) => motionOptions(editor, current, o.model)
  const rows = [
    PropertyRow({
      label: o.prefix === '기본' ? '기본 동작' : '동작',
      override: o.override?.('motion', '동작'),
      stack: list.length > 1,
      children: [
        Select({
          label: o.prefix + ' 동작',
          key: o.key + '-motion',
          size: 'sm',
          value: list[0] ?? STILL,
          // An inherited value says where it comes from, so "정지" is not
          // mistaken for this character's own choice.
          options: options(list[0]).map((x) =>
            o.inherited && x.value === (list[0] ?? STILL)
              ? { ...x, label: x.label + ' · 월드 기본' }
              : x,
          ),
          onChange: (v) =>
            o.onMotion(v === STILL ? null : motionOf([v, ...list.slice(1)])),
        }),
        list.length > 1 &&
          FileList({
            label: o.prefix + ' 이어서 재생할 동작',
            items: list.slice(1).map((value, i) => ({
              icon: 'motion',
              name: clipLabel(editor, value),
              detail: i + 2 + '번째',
              key: o.key + '-next-' + i,
              removeLabel: clipLabel(editor, value) + ' 빼기',
              onRemove: () =>
                o.onMotion(motionOf(list.filter((_, k) => k !== i + 1))),
            })),
          }),
      ].filter(Boolean),
    }),
  ]
  if (list.length && list.length < MOTION_LIMIT)
    rows.push(
      PropertyRow({
        label: '이어서',
        children: [
          Select({
            label: o.prefix + ' 이어서 재생할 동작 추가',
            key: o.key + '-add',
            size: 'sm',
            value: '',
            options: [
              { value: '', label: '동작 추가…' },
              ...options().filter((x) => x.value !== STILL),
            ],
            onChange: (v) => v && o.onMotion([...list, v]),
          }),
        ],
      }),
    )
  if (list.length > 1 && o.onOrder)
    rows.push(
      PropertyRow({
        label: '순서',
        override: o.override?.('order', '순서'),
        children: [
          Segmented({
            label: o.prefix + ' 동작 순서',
            key: o.key + '-order',
            size: 'sm',
            value: o.order,
            options: [
              { value: 'sequence', label: '차례대로' },
              { value: 'random', label: '무작위' },
            ],
            onChange: o.onOrder,
          }),
        ],
      }),
    )
  return rows
}
const fileSize = (bytes) =>
  bytes < 1048576
    ? Math.max(1, Math.round(bytes / 1024)) + 'KB'
    : (bytes / 1048576).toFixed(1) + 'MB'

function worldCharacters(editor) {
  const world = editor.layout.defaults?.character ?? {}
  const count = editor.layout.characters?.length ?? 0
  return PanelSection({
    title: '캐릭터',
    meta: count + '개',
    children: [
      ...motionRows(editor, {
        prefix: '기본',
        key: 'character-default',
        motion: world.motion ?? null,
        order: world.order ?? 'sequence',
        onMotion: (v) => editor.setCharacterDefault('motion', v),
        onOrder: (v) => editor.setCharacterDefault('order', v),
      }),
      PropertyRow({
        label: '기본 속도',
        children: [
          Slider({
            label: '기본 동작 속도',
            key: 'character-default-speed',
            min: 0.1,
            max: 3,
            step: 0.05,
            value: world.speed ?? 1,
            format: (v) => '×' + v.toFixed(2),
            onInput: (v) => editor.setCharacterDefault('speed', v, true),
            onCommit: (v) => editor.setCharacterDefault('speed', v),
          }),
        ],
      }),
      muted(
        '모든 캐릭터가 따르는 값입니다. 동작을 여러 개 고르면 하나씩 이어서 재생합니다. 기본 동작이 맞지 않는 모델은 멈춰 있습니다. 캐릭터 편집기에서 따로 정할 수 있습니다.',
      ),
    ],
  })
}

function characterLibrarySection(editor) {
  const { models, motions } = editor.characterLibrary
  const names = new Map(models.map((m) => [m.id, m.name]))
  const open = models.find((m) => m.id === editor.view.libraryModel)
  return PanelSection({
    title: '캐릭터 자료실',
    meta: '모델 ' + models.length + ' · 동작 ' + motions.length,
    children: [
      PropertyRow({
        label: '모델',
        stack: true,
        children: [
          FileList({
            label: '캐릭터 모델',
            empty: '아직 모델이 없습니다.',
            items: models.map((m) => {
              const uses = editor.fileUsers('models', m.id)
              return {
                icon: 'character',
                name: m.name,
                key: 'library-model-' + m.id,
                selected: open?.id === m.id,
                onSelect: () => editor.selectLibraryModel(m.id),
                detail: [
                  m.builtin ? '기본 모델' : null,
                  '키 ' + meters(m.height),
                  '관절 ' + m.joints + '개',
                  uses ? uses + '개 배치' : null,
                ]
                  .filter(Boolean)
                  .join(' · '),
              }
            }),
          }),
          open ? null : muted('모델을 누르면 이름·기본 키·파일을 바꿉니다.'),
        ],
      }),
      ...(open ? librarySettings(editor, open) : []),
      PropertyRow({
        label: '새 모델',
        children: [
          FileButton({
            label: '모델 올리기',
            accept: '.glb,model/gltf-binary',
            key: 'character-model',
            onFile: (file) => editor.uploadModel(file),
          }),
        ],
      }),
      PropertyRow({
        label: '동작 파일',
        stack: true,
        children: [
          FileList({
            label: '동작 파일',
            empty: '아직 동작 파일이 없습니다.',
            items: motions.map((m) => {
              const fits = models.filter((model) => m.matched[model.id])
              const uses = editor.fileUsers('motions', m.id)
              return {
                icon: 'motion',
                name: m.name,
                detail: [
                  m.clips.map((c) => c.name).join(', '),
                  fits.length
                    ? fits.map((model) => names.get(model.id)).join(', ')
                    : '맞는 모델 없음',
                  uses ? uses + '곳에서 사용' : null,
                ]
                  .filter(Boolean)
                  .join(' · '),
                // A model's own actions leave with the model; files in use
                // stay until their characters change.
                ...(m.builtin || m.model || uses
                  ? {}
                  : {
                      removeLabel: m.name + ' 동작 파일 삭제',
                      onRemove: () => editor.removeMotion(m.id),
                    }),
              }
            }),
          }),
          FileButton({
            label: '동작 파일 올리기',
            accept: '.glb,model/gltf-binary',
            key: 'character-motion',
            onFile: (file) => editor.uploadMotion(file),
          }),
        ],
      }),
      muted(
        'Blender에서 아마추어와 스킨이 있는 모델, 같은 아마추어의 동작(액션)을 GLB로 내보내 올립니다. 동작은 뼈 이름이 맞는 모델에서만 고를 수 있습니다. 쓰는 중인 모델과 동작은 지울 수 없습니다. 관람 화면은 공개할 때의 파일을 계속 씁니다.',
      ),
    ].filter(Boolean),
  })
}

const meters = (v) => (Math.round(v * 100) / 100).toString() + 'm'

// Ground one walk cycle covers at 100%: measured from the walk clip of a
// character walking a route, until the operator sets it.
function strideRows(editor, m) {
  const measured = editor.modelStride(m.id)
  const value = m.stride ?? measured
  if (!value)
    return [
      PropertyRow({
        label: '걸음 길이',
        children: [
          muted('이 모델의 캐릭터가 경로를 걸으면 걷기 동작에서 잽니다.'),
        ],
      }),
    ]
  return [
    PropertyRow({
      label: '걸음 길이',
      override: m.stride !== undefined && {
        from: '걷기 동작',
        subject: '걸음 길이',
        onReset: () => editor.updateModel(m.id, { stride: null }),
      },
      children: [
        NumberInput({
          label: '모델 걸음 길이',
          prefix: 'm',
          key: 'library-model-stride',
          step: 0.05,
          min: 0.05,
          max: 20,
          value: Math.round(value * 100) / 100,
          onCommit: (stride) => editor.updateModel(m.id, { stride }),
        }),
      ],
    }),
    muted(
      '걷기 동작 한 주기에 나아가는 거리입니다. 경로를 걸을 때 발이 미끄러지지 않는 속도를 정합니다.',
    ),
  ]
}

// Settings of one library model: name, default height, file and removal.
function librarySettings(editor, m) {
  const uses = editor.fileUsers('models', m.id)
  const measured = Math.abs(m.height - m.measured) < 0.005
  return [
    PropertyRow({
      label: '이름',
      children: [
        TextInput({
          label: '모델 이름',
          key: 'library-model-name',
          size: 'sm',
          value: m.name,
          validate: (v) => (v.trim() ? null : '이름을 입력하세요.'),
          onCommit: (name) => editor.updateModel(m.id, { name }),
        }),
      ],
    }),
    PropertyRow({
      label: '기본 키',
      override: !measured && {
        from: '파일',
        subject: '기본 키',
        onReset: () => editor.updateModel(m.id, { height: m.measured }),
      },
      children: [
        NumberInput({
          label: '모델 기본 키',
          prefix: 'm',
          key: 'library-model-height',
          step: 0.1,
          min: 0.1,
          max: 20,
          value: m.height,
          onCommit: (height) => editor.updateModel(m.id, { height }),
        }),
      ],
    }),
    muted(
      '크기 100%인 캐릭터가 이 키로 보입니다. 파일 그대로는 ' +
        meters(m.measured) +
        '입니다.',
    ),
    ...strideRows(editor, m),
    PropertyRow({
      label: '구성',
      stack: true,
      children: [
        muted(
          '착용물 ' +
            (m.wearables.length
              ? m.wearables.map((w) => w.label).join(', ')
              : '없음') +
            ' · 점토 얼굴 보호 ' +
            (m.protect
              ? '정점 그룹'
              : '정점 그룹 없음(리라지 기린과 같은 골격이면 높이 기준)'),
        ),
      ],
    }),
    PropertyRow({
      label: '파일',
      stack: true,
      children: m.builtin
        ? [muted('기본 모델은 저장소의 원본 파일을 씁니다.')]
        : [
            FileButton({
              label: '새 버전 올리기',
              accept: '.glb,model/gltf-binary',
              key: 'library-model-file',
              onFile: (file) => editor.replaceModel(m.id, file),
            }),
            muted(
              [
                m.bytes ? fileSize(m.bytes) : null,
                '배치한 캐릭터는 그대로 두고 파일만 바꿉니다.',
              ]
                .filter(Boolean)
                .join(' · '),
            ),
          ],
    }),
    m.builtin
      ? null
      : PropertyRow({
          label: '삭제',
          stack: true,
          children: [
            Button({
              label: '자료실에서 빼기',
              icon: 'delete',
              size: 'sm',
              variant: 'danger',
              key: 'library-model-remove',
              disabled: uses > 0,
              onClick: () => editor.removeModel(m.id),
            }),
            muted(
              uses
                ? '캐릭터 ' +
                    uses +
                    '개가 쓰고 있어 뺄 수 없습니다. 먼저 그 캐릭터의 모델을 바꾸세요.'
                : '같은 파일을 다시 올리면 돌아옵니다.',
            ),
          ],
        }),
  ]
}

// ---- 경로 ----
const seconds = (v) => (Math.round(v * 10) / 10).toString() + '초'
const routeModes = [
  { value: 'loop', label: '돌아오기' },
  { value: 'pingpong', label: '왕복' },
]
// What a point does, in a few words, for its heading.
function stopSummary(editor, stop) {
  if (!stop) return '지나가기'
  const clips = clipsOf(stop.motion)
  const parts = ['멈추기']
  if (clips.length)
    parts.push(
      clipLabel(editor, clips[0]).split(' · ').at(-1) +
        (clips.length > 1 ? ' 외 ' + (clips.length - 1) : '') +
        ((stop.repeat ?? 1) > 1 ? ' ×' + stop.repeat : ''),
    )
  if (stop.wait) parts.push(seconds(stop.wait) + ' 대기')
  return parts.join(' · ')
}
// Rows of one route point: pass or stop, and what a stop does in order —
// face, motion (and how many times), wait.
function routePointRows(c, editor, modelId, p, i) {
  const n = i + 1
  const stop = p.stop
  const key = 'route-' + i
  // A stop with nothing set is still a stop: it turns on the spot.
  const setStop = (values) => {
    const next = { ...stop, ...values }
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k]
    if (next.motion == null) delete next.repeat
    editor.setRouteStop(c.id, i, next)
  }
  const rows = [
    PropertyRow({
      label: '할 일',
      children: [
        Segmented({
          label: n + '번 지점에서 할 일',
          key: key + '-kind',
          size: 'sm',
          value: stop ? 'stop' : 'pass',
          options: [
            { value: 'pass', label: '지나가기' },
            { value: 'stop', label: '멈추기' },
          ],
          onChange: (v) =>
            editor.setRouteStop(c.id, i, v === 'stop' ? { wait: 1 } : null),
        }),
        IconButton({
          icon: 'delete',
          label: n + '번 지점 지우기',
          size: 'sm',
          key: key + '-remove',
          onClick: () => editor.removeRoutePoint(c.id, i),
        }),
      ],
    }),
  ]
  if (!stop) return rows
  const facing = typeof stop.face === 'number'
  rows.push(
    PropertyRow({
      label: '방향',
      children: [
        Segmented({
          label: n + '번 지점에서 바라볼 방향',
          key: key + '-face',
          size: 'sm',
          value: facing ? 'angle' : 'next',
          options: [
            { value: 'next', label: '다음 지점 쪽' },
            { value: 'angle', label: '직접 정하기' },
          ],
          onChange: (v) =>
            setStop({ face: v === 'angle' ? Math.round(c.yaw) : undefined }),
        }),
        facing &&
          NumberInput({
            label: n + '번 지점에서 바라볼 각도',
            prefix: '°',
            key: key + '-angle',
            step: ops.ROTATE_STEP,
            min: -360,
            max: 360,
            value: stop.face,
            onCommit: (face) => setStop({ face }),
          }),
      ].filter(Boolean),
    }),
    ...motionRows(editor, {
      prefix: n + '번 지점',
      key,
      model: modelId,
      motion: stop.motion ?? null,
      onMotion: (motion) => setStop({ motion: motion ?? undefined }),
    }),
  )
  if (stop.motion != null)
    rows.push(
      PropertyRow({
        label: '반복',
        children: [
          NumberInput({
            label: n + '번 지점 동작 반복 횟수',
            prefix: '회',
            key: key + '-repeat',
            step: 1,
            min: routeLimits.repeat.min,
            max: routeLimits.repeat.max,
            value: stop.repeat ?? 1,
            onCommit: (repeat) => setStop({ repeat: Math.round(repeat) }),
          }),
        ],
      }),
    )
  rows.push(
    PropertyRow({
      label: '대기',
      children: [
        NumberInput({
          label: n + '번 지점 대기 시간',
          prefix: '초',
          key: key + '-wait',
          step: 0.5,
          min: routeLimits.wait.min,
          max: routeLimits.wait.max,
          value: stop.wait ?? 0,
          onCommit: (wait) => setStop({ wait: wait || undefined }),
        }),
      ],
    }),
  )
  return rows
}
function routeSection(c, editor, modelId) {
  const route = c.route
  const drawing = editor.view.routing?.id === c.id
  const drawingNote =
    drawing &&
    Callout({
      message:
        '방 바닥을 눌러 지점을 더하세요. Enter나 마지막 지점을 다시 눌러 마치고, Esc로 취소합니다.',
    })
  const draw = PropertyRow({
    label: drawing ? '바닥을 클릭' : '장면에서',
    stack: true,
    children: [
      Button({
        label: drawing
          ? '그리기 마치기'
          : route
            ? '지점 더하기'
            : '경로 그리기',
        icon: 'pointer',
        size: 'sm',
        variant: drawing ? 'primary' : 'secondary',
        key: 'route-draw',
        onClick: () =>
          drawing ? editor.finishRoute() : editor.startRoute(c.id),
      }),
      !route &&
        muted(
          '바닥에 지점을 찍으면 캐릭터가 그 순서대로 걷습니다. 지점마다 지나가거나, 멈춰서 동작을 하고 기다리게 할 수 있습니다.',
        ),
    ].filter(Boolean),
  })
  if (!route)
    return PanelSection({
      title: '경로',
      meta: '없음',
      children: [drawingNote, draw].filter(Boolean),
    })
  const info = editor.routeInfo(c.id)
  const playing = editor.view.routePlay
  const speed = route.speed ?? info?.speed ?? routeDefaults.speed
  const slides = info?.ready && (info.pace < 0.5 || info.pace > 2)
  const walks = motionOptions(editor, route.walk, modelId).filter(
    (o) => o.value !== STILL,
  )
  return PanelSection({
    title: '경로',
    meta:
      '지점 ' +
      route.points.length +
      '개' +
      (info?.duration ? ' · 한 바퀴 ' + seconds(info.duration) : ''),
    children: [
      drawingNote,
      PropertyRow({
        label: '미리보기',
        children: [
          Button({
            label: playing ? '처음으로' : '경로 재생',
            icon: playing ? 'reset' : 'play',
            size: 'sm',
            variant: playing ? 'primary' : 'secondary',
            key: 'route-play',
            onClick: () => editor.playRoute(!playing),
          }),
        ],
      }),
      info?.loaded && !info.ready
        ? Callout({
            tone: 'warning',
            message:
              '걷기 동작을 읽지 못해 첫 지점에 서 있습니다. 이 모델에 맞는 걷기 동작을 고르세요.',
          })
        : null,
      PropertyRow({
        label: '반복',
        children: [
          Segmented({
            label: '경로 반복 방식',
            key: 'route-mode',
            size: 'sm',
            value: route.mode ?? routeDefaults.mode,
            options: routeModes,
            onChange: (mode) => editor.setRoute(c.id, { mode }),
          }),
        ],
      }),
      PropertyRow({
        label: '속도',
        override: route.speed !== undefined && {
          from: '걸음에 맞춘 속도',
          subject: '속도',
          onReset: () => editor.setRoute(c.id, { speed: undefined }),
        },
        children: [
          Slider({
            label: '경로 걷는 속도',
            key: 'route-speed',
            min: routeLimits.speed.min,
            max: routeLimits.speed.max,
            step: 0.05,
            value: Math.min(
              routeLimits.speed.max,
              Math.max(routeLimits.speed.min, speed),
            ),
            format: (v) => v.toFixed(2) + 'm/s',
            onInput: (v) => editor.setRoute(c.id, { speed: v }, true),
            onCommit: (v) => editor.setRoute(c.id, { speed: v }),
          }),
        ],
      }),
      slides
        ? Callout({
            tone: 'warning',
            message:
              '걸음과 맞지 않는 속도라 발이 미끄러져 보일 수 있습니다. 걸음에 맞는 속도는 ' +
              info.natural.toFixed(2) +
              'm/s입니다.',
          })
        : null,
      PropertyRow({
        label: '걷기',
        children: [
          Select({
            label: '경로 걷기 동작',
            key: 'route-walk',
            size: 'sm',
            value: route.walk,
            options: walks,
            onChange: (walk) => editor.setRoute(c.id, { walk }),
          }),
        ],
      }),
      PropertyRow({
        label: '서 있을 때',
        children: [
          Select({
            label: '경로에서 서 있을 때 동작',
            key: 'route-idle',
            size: 'sm',
            value: route.idle ?? STILL,
            options: motionOptions(editor, route.idle, modelId).map((o) =>
              o.value === STILL ? { ...o, label: '정지 자세' } : o,
            ),
            onChange: (v) =>
              editor.setRoute(c.id, { idle: v === STILL ? undefined : v }),
          }),
        ],
      }),
      ...route.points.flatMap((p, i) => [
        el(
          'h4',
          { class: 'studio-route-point' },
          n(i) + ' 지점 · ' + stopSummary(editor, p.stop),
        ),
        ...routePointRows(c, editor, modelId, p, i),
      ]),
      draw,
      PropertyRow({
        children: [
          Button({
            label: '경로 지우기',
            icon: 'delete',
            size: 'sm',
            variant: 'ghost',
            key: 'route-remove',
            onClick: () => editor.removeRoute(c.id),
          }),
        ],
      }),
    ].filter(Boolean),
  })
}
const n = (i) => i + 1 + '번'

const modelStates = {
  ready: null,
  loading: '여는 중',
  missing: '모델 없음',
}

function characterInspector(c, editor) {
  const set = (values) => editor.patch('characters', c.id, values)
  const preview = (values) =>
    editor.preview((d) =>
      Object.assign(ops.find(d, 'characters', c.id), values),
    )
  const at = (n, v) =>
    c.position.map((p, k) => (k === n ? ops.clampPosition(v) : p))
  const library = editor.characterLibrary
  const modelId = editor.characterModel(c)
  const model = library.models.find((m) => m.id === modelId)
  const dimensions = editor.proportionDimensions(c.id)
  const state = editor.characterState(c)
  const effective = editor.characterMotion(c)
  const inherit = (key, subject) =>
    c[key] !== undefined && {
      from: WORLD_SCOPE,
      subject,
      onReset: () => editor.inheritCharacter(c.id, key),
    }
  const placing = editor.view.placing === c.id
  const modelOptions = library.models.map((m) => ({
    value: m.id,
    label: m.name,
  }))
  if (!model) modelOptions.push({ value: modelId ?? '', label: '없는 모델' })
  return [
    PanelHeader({
      eyebrow: '캐릭터',
      icon: 'character',
      title: labelInput('캐릭터 이름', c.label, (label) => set({ label })),
      actions: [
        IconButton({
          icon: 'copy',
          label: '캐릭터 복제',
          shortcut: editor.cmd + 'D',
          key: 'duplicate',
          onClick: () => editor.duplicate(),
        }),
        IconButton({
          icon: 'delete',
          label: '캐릭터 삭제',
          variant: 'danger',
          shortcut: 'Delete',
          key: 'delete',
          onClick: () => editor.remove(),
        }),
      ],
    }),
    placing &&
      Callout({
        message:
          '캐릭터가 포인터를 따라갑니다. 놓을 방의 바닥을 클릭하세요. Esc를 누르면 지금 자리에 둡니다.',
      }),
    PanelSection({
      title: '모델',
      meta: modelStates[state] ?? (model ? '관절 ' + model.joints + '개' : ''),
      children: [
        PropertyRow({
          label: '모델',
          children: [
            Select({
              label: '캐릭터 모델',
              key: 'character-model',
              size: 'sm',
              value: modelId ?? '',
              options: modelOptions,
              onChange: (v) => editor.setCharacterModel(c.id, v),
            }),
          ],
        }),
        state === 'ready' &&
          PropertyRow({
            label: '얼굴',
            children: [
              muted(
                {
                  vertices: '점토 보호 · 모델의 정점 그룹',
                  giraffe: '점토 보호 · 기린 머리 높이 기준',
                }[editor.clayProtection(c.id)] ?? '점토 보호 없음',
              ),
            ],
          }),
        state === 'missing' &&
          Callout({
            tone: 'warning',
            message:
              '이 모델을 열 수 없습니다. 자료실에서 지워졌거나 파일이 손상되었습니다. 다른 모델을 고르세요.',
          }),
      ].filter(Boolean),
    }),
    c.route
      ? PanelSection({
          title: '동작',
          meta: '경로를 걷는 중',
          children: [
            muted(
              '경로가 있는 캐릭터는 제자리 동작 대신 아래 경로의 걷기와 지점별 동작을 합니다.',
            ),
          ],
        })
      : PanelSection({
          title: '동작',
          meta:
            c.motion === undefined &&
            c.speed === undefined &&
            c.order === undefined
              ? '월드 따름'
              : '이 캐릭터만 따로',
          children: [
            ...motionRows(editor, {
              prefix: '캐릭터',
              key: 'character',
              model: modelId,
              motion: effective.motion,
              order: effective.order,
              inherited: c.motion === undefined,
              override: inherit,
              onMotion: (motion) => set({ motion }),
              onOrder: (order) => set({ order }),
            }),
            PropertyRow({
              label: '속도',
              override: inherit('speed', '속도'),
              children: [
                Slider({
                  label: '캐릭터 동작 속도',
                  key: 'character-speed',
                  min: 0.1,
                  max: 3,
                  step: 0.05,
                  value: effective.speed,
                  format: (v) => '×' + v.toFixed(2),
                  onInput: (speed) => preview({ speed }),
                  onCommit: (speed) => set({ speed }),
                }),
              ],
            }),
          ],
        }),
    routeSection(c, editor, modelId),
    PanelSection({
      title: '배치',
      children: [
        PropertyRow({
          label: placing ? '바닥을 클릭 · Esc로 마침' : '장면에서',
          stack: true,
          children: [
            Button({
              label: placing ? '현재 위치에 두기' : '포인터로 놓기',
              icon: 'pointer',
              size: 'sm',
              variant: placing ? 'primary' : 'secondary',
              key: 'character-place',
              onClick: () => editor.setPlacing(placing ? null : c.id),
            }),
            muted(
              '장면에서 캐릭터를 끌어 옮깁니다. 방향키로 조금씩, Q·E로 돌립니다.',
            ),
          ],
        }),
        PropertyRow({
          label: '방',
          children: [
            Select({
              label: '캐릭터가 있는 방',
              key: 'character-room',
              size: 'sm',
              value: c.room,
              options: editor.rooms.map((r) => ({
                value: r.id,
                label: r.label,
              })),
              onChange: (room) => set({ room }),
            }),
          ],
        }),
        PropertyRow({
          label: '위치',
          children: [
            NumberInput({
              label: '캐릭터 위치 X',
              prefix: 'X',
              key: 'cx',
              value: c.position[0],
              onCommit: (v) => set({ position: at(0, v) }),
            }),
            NumberInput({
              label: '캐릭터 위치 Z',
              prefix: 'Z',
              key: 'cz',
              value: c.position[2],
              onCommit: (v) => set({ position: at(2, v) }),
            }),
          ],
        }),
        PropertyRow({
          label: '높이',
          children: [
            NumberInput({
              label: '캐릭터 높이',
              prefix: 'Y',
              key: 'cy',
              step: 0.05,
              value: c.position[1],
              onCommit: (v) => set({ position: at(1, v) }),
            }),
          ],
        }),
        PropertyRow({
          label: '방향',
          children: [
            Slider({
              label: '캐릭터 방향',
              key: 'cyaw',
              min: -180,
              max: 180,
              step: 1,
              value: ((((c.yaw + 180) % 360) + 360) % 360) - 180,
              format: (v) => Math.round(v) + '°',
              onInput: (yaw) => preview({ yaw }),
              onCommit: (yaw) => set({ yaw }),
            }),
          ],
        }),
        PropertyRow({
          label: '크기',
          children: [
            Slider({
              label: '캐릭터 크기',
              key: 'cscale',
              min: 0.25,
              max: 3,
              step: 0.05,
              value: c.scale,
              // The model's default height is 100%.
              format: (v) =>
                Math.round(v * 100) +
                '%' +
                (model ? ' · ' + meters(v * model.height) : ''),
              onInput: (scale) => preview({ scale }),
              onCommit: (scale) => set({ scale }),
            }),
          ],
        }),
      ],
    }),
    // Body proportions need the Riragi giraffe's joint layout.
    dimensions?.length
      ? giraffeProportionSection(
          c.proportions,
          (key, value) => editor.setCharacterProportion(c.id, key, value),
          (key, value) => editor.setCharacterProportion(c.id, key, value, true),
          dimensions,
        )
      : state === 'ready' &&
        PanelSection({
          title: '체형',
          meta: '이 모델은 지원 안 함',
          children: [
            muted(
              '목·머리·다리·몸통 비율은 리라지 점토 기린과 같은 관절 구성에서 조절합니다.',
            ),
          ],
        }),
    model?.wearables?.length
      ? PanelSection({
          title: '착용물',
          meta: (c.wear?.length ?? 0) + '/' + model.wearables.length,
          children: [
            ...model.wearables.map((w) =>
              Toggle({
                label: w.label,
                key: 'wear-' + w.id,
                pressed: !!c.wear?.includes(w.id),
                onChange: (on) => editor.setCharacterWear(c.id, w.id, on),
              }),
            ),
            muted('체형을 바꾸면 착용물도 몸에 맞춰집니다.'),
          ],
        })
      : null,
    PanelSection({
      title: '관람',
      meta: c.page ? '페이지 연결' : '연결 없음',
      children: [
        PropertyRow({
          label: '누르면',
          children: [
            Select({
              label: '누르면 열 행사 페이지',
              key: 'character-page',
              size: 'sm',
              value: c.page ?? '',
              options: [
                { value: '', label: '열지 않음' },
                ...editor.layout.pages.map((p) => ({
                  value: p.id,
                  label: p.title,
                })),
              ],
              onChange: (page) => set({ page: page || undefined }),
            }),
          ],
        }),
        muted(
          '공개하면 관람 화면에 보입니다. 방을 고르면 그 방의 캐릭터만 움직입니다.',
        ),
      ],
    }),
    claySection(c.id, editor, 'characters'),
  ].filter(Boolean)
}
