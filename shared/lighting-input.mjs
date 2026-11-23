// Only properties that affect the rendered image belong to the bake identity.
export function lightingInput(layout) {
  const byId = (a, b) => a.id.localeCompare(b.id)
  return [
    layout.items
      .map(({ id, room, kind, position, rotation, scale, color, finish }) => ({
        id,
        room,
        kind,
        position,
        rotation,
        scale,
        color,
        finish,
      }))
      .sort(byId),
    (layout.lights ?? [])
      .map(({ id, room, position, color, energy }) => ({
        id,
        room,
        position,
        color,
        energy,
      }))
      .sort(byId),
  ]
}
