export function claySurfaceSettings(value) {
  if (value?.style) return value
  // Old scenes stored the hatch relief under the animation switch.
  return {
    enabled: false,
    strength: value?.strength ?? 45,
    style: 'surface',
    hatch: value?.enabled ? value.strength : 0,
  }
}
