import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import {
  lightKinds,
  lightWithDefaults,
  lightLimit,
} from '../shared/studio-lights.mjs'
import {
  Button,
  IconButton,
  Menu,
  NumberInput,
  PanelHeader,
  PanelSection,
  PropertyRow,
  Select,
  Slider,
  SwatchPicker,
  Toggle,
} from './ds/index.js'

export function lightMenu(roomName, count, add) {
  const trigger = Button({
    label: '조명 추가',
    size: 'sm',
    iconEnd: 'chevron-down',
    disabled: count >= lightLimit,
  })
  if (trigger.disabled)
    trigger.title =
      '월드에 조명을 최대 ' + lightLimit + '개까지 둘 수 있습니다.'
  return Menu({
    trigger,
    label: '조명 추가',
    heading: roomName + '에 조명 추가',
    items: Object.entries(lightKinds).map(([type, kind]) => ({
      label: kind.label + ' · ' + kind.use,
      onSelect: () => add(type),
    })),
  }).element
}

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

export function lightInspector(
  row,
  { rooms, title, set, preview, remove, picking, pick },
) {
  const light = lightWithDefaults(row)
  const shape = light.shape,
    kind = lightKinds[shape.type]
  const property = (label, ...children) => PropertyRow({ label, children })
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
  const beam =
    shape.type === 'spot'
      ? [
          shapeSlider('빔 각도', 'angle', 1, 180, '°'),
          shapeSlider('가장자리 부드러움', 'blend', 0, 100, '%', 100),
        ]
      : shape.type === 'area'
        ? [property('크기 (m)', size('폭', 'width'), size('높이', 'height'))]
        : []
  return [
    PanelHeader({
      eyebrow: kind.label,
      title,
      description: kind.description,
      actions: [
        Toggle({
          label: '조명 켜기',
          pressed: light.enabled,
          onChange: (enabled) => set({ enabled }),
        }),
        IconButton({
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
        property(
          '밝기',
          Slider({
            label: '조명 출력',
            key: 'energy',
            min: 0,
            max: 10000,
            step: 1,
            value: light.energy,
            format: (v) => v + ' W',
            onInput: (energy) => preview({ energy }),
            onCommit: (energy) => set({ energy }),
          }),
        ),
        property(
          '출력 (W)',
          NumberInput({
            label: '정확한 조명 출력',
            key: 'watts',
            min: 0,
            max: 10000,
            step: 1,
            value: light.energy,
            onCommit: (energy) => set({ energy }),
          }),
        ),
        property(
          '빛 색상',
          SwatchPicker({
            label: '조명 색',
            value: light.color,
            colors: ['#ffffff', '#ffd9aa', '#ffc18a', '#cce4ff', '#b7c7ff'],
            customLabel: '직접 고른 조명 색',
            allowCustom: true,
            onPreview: (color) => preview({ color }),
            onChange: (color) => set({ color }),
          }),
        ),
        ...beam,
      ],
    }),
    PanelSection({
      title: '배치',
      children: [
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
        property(
          '위치 (m)',
          ...['X', 'Y', 'Z'].map((axis, index) =>
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
        ),
        PropertyRow({
          label: picking ? '이 방의 표면을 클릭 · Esc 취소' : '장면에서 지정',
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
