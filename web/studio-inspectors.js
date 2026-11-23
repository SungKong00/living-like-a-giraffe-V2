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
  EmptyState,
  Icon,
  IconButton,
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
} from './ds/index.js'
import { lightInspector } from './light-inspector.js'
import * as ops from './edit-ops.js'

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
  light: lightEditor,
  spot: spotInspector,
  page: pageInspector,
})

/** Where the selection sits: each wider scope is one click away. */
export function scopePath(editor) {
  const sel = editor.selection
  if (!sel) return []
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

export function emptyInspector() {
  return [
    EmptyState({
      icon: 'pointer',
      title: '편집할 대상을 선택하세요',
      description:
        '장면에서 가구나 안내 표시를 누르거나, 왼쪽 목록에서 고르세요. 모두에 적용되는 값은 목록 맨 위의 월드에서 바꿉니다.',
      children: [
        el(
          'ul',
          { class: 'studio-tips' },
          el(
            'li',
            {},
            Icon('world', 'sm'),
            '월드 › 방 › 가구 순으로 넓은 범위의 값을 개체가 이어받고, 개체에서 바꾼 값이 우선합니다.',
          ),
          el(
            'li',
            {},
            Icon('furniture', 'sm'),
            '가구는 끌어서 옮기고 다른 방에 놓을 수 있습니다. Alt를 누른 채 끌면 복제합니다.',
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
// world-wide settings; defaults for objects, the background and giraffes join
// this list as they are built, and the objects' own editors mark overrides
// with PropertyRow's `override`.
const worldSections = [composition, worldLighting]

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
            '가구 ' +
              layout.items.length +
              ' · 클릭 영역 ' +
              layout.spots.length +
              ' · 행사 페이지 ' +
              layout.pages.length,
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
          label: '/events/' + p.id + ' 새 창에서 열기',
          key: 'open-page',
          onClick: () => window.open('/events/' + p.id, '_blank', 'noopener'),
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
          '방이나 가구를 선택해 클릭 영역을 추가하고 이 페이지를 연결하세요.',
        ),
      ],
    }),
  ]
}
