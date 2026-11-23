import {
  PanelSection,
  PropertyRow,
  Slider,
  Toggle,
  Segmented,
} from './ds/index.js'

import { claySurfaceSettings } from '../shared/clay-motion.mjs'

export const initialClayMotion = Object.freeze(claySurfaceSettings())

export function hatchRow(settings, onCommit, onPreview) {
  const value = claySurfaceSettings(settings)
  return PropertyRow({
    label: '빗금 질감',
    children: [
      Slider({
        key: 'clay-hatch',
        label: '빗금 질감',
        min: 0,
        max: 100,
        value: value.hatch ?? 0,
        format: (v) => v + '%',
        onInput: (hatch) => onPreview({ ...value, hatch }),
        onCommit: (hatch) => onCommit({ ...value, hatch }),
      }),
    ],
  })
}

export function clayMotionSection(
  value = initialClayMotion,
  onCommit,
  onPreview,
) {
  value = claySurfaceSettings(value)
  return PanelSection({
    title: '점토 표면 움직임',
    children: [
      Toggle({
        label: '꿈틀거림',
        hint: '선택한 움직임을 재생합니다.',
        key: 'clay-motion-enabled',
        pressed: value.enabled,
        onChange: (enabled) => onCommit({ ...value, enabled }),
      }),
      ...(value.enabled
        ? [
            Segmented({
              label: '움직임 방식',
              key: 'clay-motion-style',
              value: value.style,
              options: [
                { value: 'surface', label: '점토 표면' },
                { value: 'screen', label: 'v1 화면 일렁임' },
              ],
              onChange: (style) => onCommit({ ...value, style }),
            }),
            PropertyRow({
              label: '전체 강도',
              children: [
                Slider({
                  key: 'clay-motion-strength',
                  label: '꿈틀거림 전체 강도',
                  min: 0,
                  max: 100,
                  value: value.strength,
                  format: (v) => v + '%',
                  onInput: (strength) => onPreview({ ...value, strength }),
                  onCommit: (strength) => onCommit({ ...value, strength }),
                }),
              ],
            }),
          ]
        : []),
    ],
  })
}
