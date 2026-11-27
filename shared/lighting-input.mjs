// Only properties that affect the rendered image belong to the bake identity.
export function lightingInput(layout) {
  const byId = (a, b) => a.id.localeCompare(b.id);
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
      .filter((light) => light.enabled !== false)
      .map(({ id, room, position, color, energy, shape }) => ({
        id,
        room,
        position,
        color,
        energy,
        ...(shape && shape.type !== "point" ? { shape } : {}),
      }))
      .sort(byId),
    ...(layout.sourceLights?.length
      ? [
          layout.sourceLights
            .map(({ id, enabled, energy, color, position, rotation }) =>
              enabled === false
                ? { id, enabled }
                : { id, enabled, energy, color, position, rotation },
            )
            .sort(byId),
        ]
      : []),
  ];
}
