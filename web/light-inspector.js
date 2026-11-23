import {
  Button,
  NumberInput,
  PanelHeader,
  PanelSection,
  PropertyRow,
  Select,
  Slider,
  SwatchPicker,
} from './ds/index.js'

export function lightInspector(light, { rooms, title, set, preview, remove }) {
  return [
    PanelHeader({
      eyebrow: '점광원',
      title,
      actions: [
        Button({
          label: '조명 삭제',
          size: 'sm',
          variant: 'danger',
          onClick: remove,
        }),
      ],
    }),
    PanelSection({
      title: '조명',
      children: [
        PropertyRow({
          label: '방',
          children: [
            Select({
              label: '조명 위치 기준 방',
              value: light.room,
              key: 'light-room',
              options: rooms.map(({ id, label }) => ({ value: id, label })),
              onChange: (room) => set({ room }),
            }),
          ],
        }),
        PropertyRow({
          label: '위치',
          children: ['X', 'Y', 'Z'].map((axis, index) =>
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
          label: '출력',
          children: [
            Slider({
              label: '조명 출력',
              key: 'energy',
              min: 0,
              max: 10000,
              step: 1,
              value: light.energy,
              format: (value) => value + ' W',
              onInput: (energy) => preview({ energy }),
              onCommit: (energy) => set({ energy }),
            }),
          ],
        }),
        PropertyRow({
          label: '색',
          children: [
            SwatchPicker({
              label: '조명 색',
              value: light.color,
              colors: ['#ffffff', '#ffd9aa', '#cce4ff'],
              customLabel: '직접 고른 조명 색',
              allowCustom: true,
              onPreview: (color) => preview({ color }),
              onChange: (color) => set({ color }),
            }),
          ],
        }),
      ],
    }),
  ]
}
