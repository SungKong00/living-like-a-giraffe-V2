import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { lightKinds, lightWithDefaults } from '../shared/studio-lights.mjs'
import {
  Button,
  IconButton,
  NumberInput,
  PanelHeader,
  PanelSection,
  PropertyRow,
  Select,
  Segmented,
  Slider,
  SwatchPicker,
  Toggle,
} from './ds/index.js'

// Apply the shortest rotation from the current beam to the picked target.
// This retains a rectangular panel's roll when a producer adjusts its aim.
export function aimShape(light, target) {
  const toward = Vector3.FromArray(target).subtract(
    Vector3.FromArray(light.position),
  )
  if (toward.lengthSquared() < 0.000001) return null
  const old = Quaternion.FromArray(light.shape.rotation).normalize()
  const forward = new Vector3(0, 0, -1).applyRotationQuaternion(old)
  const delta = Quaternion.Identity()
  Quaternion.FromUnitVectorsToRef(forward, toward.normalize(), delta)
  return { ...light.shape, rotation: delta.multiply(old).normalize().asArray() }
}

const axes = ['X', 'Y', 'Z']
// Keep the numeric readout in sync during a canvas drag without replacing the
// inspector or moving keyboard focus. The final edit rebuilds it as usual.
export function showLightPosition(panel, position) {
  axes.forEach((axis, index) => {
    const field = panel.querySelector('input[data-key="light-' + axis + '"]')
    if (field) field.value = position[index]
  })
}

export function lightInspector(
  row,
  {
    rooms,
    title,
    set,
    preview,
    remove,
    picking,
    pick,
    source,
    tool,
    setTool,
    modified,
    reset,
    overridden = () => false,
    resetField,
  },
) {
  const light = lightWithDefaults(row)
  const shape = light.shape,
    kind = lightKinds[shape.type]
  const property = (label, ...children) => PropertyRow({ label, children })
  // A Blender light keeps its original values until a producer changes one;
  // those rows are marked and can be reset one at a time.
  const native = (field, subject) =>
    source &&
    overridden(field) && {
      from: 'Blender 원본',
      subject,
      onReset: () => resetField(field),
    }
  function shapeSlider(label, prop, min, max, suffix, factor = 1) {
    const update = (fn, value) =>
      fn({ shape: { ...shape, [prop]: value / factor } })
    return property(
      label,
      Slider({
        label,
        key: prop,
        min,
        max,
        value: shape[prop] * factor,
        step: 1,
        format: (v) => Math.round(v) + suffix,
        onInput: (v) => update(preview, v),
        onCommit: (v) => update(set, v),
      }),
    )
  }
  const size = (label, prop) =>
    NumberInput({
      label: '면광원 ' + label,
      prefix: label,
      key: prop,
      min: 0.01,
      max: 100,
      step: 0.1,
      value: shape[prop],
      onCommit: (v) => set({ shape: { ...shape, [prop]: v } }),
    })
  const place = (mode, label) =>
    Button({
      label: picking === mode ? '지정 취소' : label,
      variant: picking === mode ? 'primary' : 'secondary',
      size: 'sm',
      icon: mode === 'aim' ? 'pointer' : 'spot',
      onClick: () => pick(picking === mode ? null : mode),
    })
  const beam = source
    ? []
    : shape.type === 'spot'
      ? [
          shapeSlider('빔 각도', 'angle', 1, 180, '°'),
          shapeSlider('가장자리 부드러움', 'blend', 0, 100, '%', 100),
        ]
      : shape.type === 'area'
        ? [property('크기 (m)', size('폭', 'width'), size('높이', 'height'))]
        : []
  return [
    PanelHeader({
      eyebrow: source ? 'Blender 원본 · ' + kind.label : kind.label,
      title,
      description: source
        ? (rooms.find((r) => r.id === light.room)?.label ?? '월드 전체') +
          ' · 원본 조명의 밝기와 위치를 조절합니다.'
        : kind.description,
      actions: [
        Toggle({
          label: '조명 켜기',
          pressed: light.enabled,
          onChange: (enabled) => set({ enabled }),
        }),
        source
          ? Button({
              label: '원본값 복원',
              size: 'sm',
              disabled: !modified,
              onClick: reset,
            })
          : IconButton({
              label: '조명 삭제',
              icon: 'delete',
              variant: 'ghost',
              size: 'sm',
              onClick: remove,
            }),
      ],
    }),
    PanelSection({
      title: '빛',
      children: [
        PropertyRow({
          label: '밝기',
          override: native('energy', '밝기'),
          children: [
            Slider({
              label: '조명 출력',
              key: 'energy',
              min: 0,
              max: source
                ? Math.max(20000, Math.ceil(light.energy / 10000) * 10000)
                : 10000,
              step: 1,
              value: light.energy,
              format: (v) => v + ' W',
              onInput: (energy) => preview({ energy }),
              onCommit: (energy) => set({ energy }),
            }),
          ],
        }),
        property(
          '출력 (W)',
          NumberInput({
            label: '정확한 조명 출력',
            key: 'watts',
            min: 0,
            max: source ? 10000000 : 10000,
            step: 1,
            value: light.energy,
            onCommit: (energy) => set({ energy }),
          }),
        ),
        PropertyRow({
          label: '빛 색상',
          override: native('color', '빛 색상'),
          children: [
            SwatchPicker({
              label: '조명 색',
              value: light.color,
              colors: ['#ffffff', '#ffd9aa', '#ffc18a', '#cce4ff', '#b7c7ff'],
              customLabel: '직접 고른 조명 색',
              allowCustom: true,
              onPreview: (color) => preview({ color }),
              onChange: (color) => set({ color }),
            }),
          ],
        }),
        ...beam,
      ],
    }),
    PanelSection({
      title: '배치',
      meta:
        tool === 'rotate' ? '고리를 드래그해 회전' : '초록 화살표로 높이 조절',
      children: [
        ...(shape.type === 'point'
          ? []
          : [
              PropertyRow({
                label: '장면 도구',
                override: native('rotation', '방향'),
                children: [
                  Segmented({
                    label: '조명 조작 도구',
                    key: 'light-transform',
                    value: tool,
                    options: [
                      { value: 'move', label: '이동' },
                      { value: 'rotate', label: '회전' },
                    ],
                    onChange: setTool,
                  }),
                ],
              }),
            ]),
        ...(source
          ? []
          : [
              property(
                '방',
                Select({
                  label: '조명 위치 기준 방',
                  value: light.room,
                  key: 'light-room',
                  options: rooms.map(({ id, label }) => ({ value: id, label })),
                  onChange: (room) => set({ room }),
                }),
              ),
            ]),
        PropertyRow({
          label: '위치 (m)',
          override: native('position', '위치'),
          children: axes.map((axis, index) =>
            NumberInput({
              label: '조명 위치 ' + axis,
              prefix: axis,
              key: 'light-' + axis,
              value: light.position[index],
              min: -10000,
              max: 10000,
              onCommit: (value) =>
                set({
                  position: light.position.map((v, i) =>
                    i === index ? value : v,
                  ),
                }),
            }),
          ),
        }),
        PropertyRow({
          label: picking
            ? light.room
              ? '이 방의 표면을 클릭 · Esc 취소'
              : '방의 표면을 클릭 · Esc 취소'
            : '장면에서 지정',
          stack: true,
          children: [
            place('move', '위치 지정'),
            ...(shape.type === 'point' ? [] : [place('aim', '비출 곳 지정')]),
          ],
        }),
      ],
    }),
  ]
}
