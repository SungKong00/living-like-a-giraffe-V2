// The model owns identity, scope, native shape and defaults. A draft owns only
// editable differences, so untouched Blender data survives at native precision.
const sourceFields = ["enabled", "energy", "color", "position", "rotation"];

export function sourceValues(light, edit = {}) {
  return {
    id: light.id,
    enabled: light.enabled,
    energy: light.energy,
    color: light.color,
    position: light.position,
    ...(light.shape.rotation ? { rotation: light.shape.rotation } : {}),
    ...edit,
  };
}

export function sourceDifference(light, values) {
  const base = sourceValues(light);
  const changed = {};
  for (const key of sourceFields) {
    const a = base[key],
      b = values[key];
    if (b === undefined || a === undefined) continue;
    const close = (sign) =>
      a.every((v, i) => Math.abs(v - sign * b[i]) < 0.00002);
    if (
      Array.isArray(a) && Array.isArray(b)
        ? close(1) || (key === "rotation" && close(-1))
        : a === b
    )
      continue;
    changed[key] = b;
  }
  return Object.keys(changed).length ? { id: light.id, ...changed } : null;
}

export function editSource(layout, light, values) {
  const rows = layout.sourceLights ?? [];
  const current = rows.find((edit) => edit.id === light.id);
  const next =
    values &&
    sourceDifference(light, { ...sourceValues(light, current), ...values });
  const edits = rows.filter((edit) => edit.id !== light.id);
  if (next) edits.push(next);
  if (edits.length) layout.sourceLights = edits;
  else delete layout.sourceLights;
}

export function resolvedSources(catalog, edits = []) {
  const byId = new Map(edits.map((edit) => [edit.id, edit]));
  return catalog.map((light) => {
    const values = sourceValues(light, byId.get(light.id));
    const { rotation, ...fields } = values;
    return {
      ...light,
      ...fields,
      shape: rotation ? { ...light.shape, rotation } : light.shape,
    };
  });
}
