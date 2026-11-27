import { giraffeDimensions } from '../shared/giraffe-proportions.mjs'
import { PanelSection, PropertyRow, Slider } from './ds/index.js'

export function giraffeProportionSection(
  values = {},
  onCommit,
  onPreview,
  dimensions,
) {
  return PanelSection({
    title: '체형',
    children: dimensions.map((key) => {
      const { label, min, max } = giraffeDimensions[key]
      return PropertyRow({
        label,
        children: [
          Slider({
            key: 'giraffe-shape-' + key,
            label,
            min: Math.round(100 * min),
            max: Math.round(100 * max),
            value: Math.round(100 * (values[key] ?? 1)),
            format: (v) => v + '%',
            onInput: (v) => onPreview(key, v / 100),
            onCommit: (v) => onCommit(key, v / 100),
          }),
        ],
      })
    }),
  })
}
