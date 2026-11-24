import { migrate } from './layout.mjs'

export function editorView(snap, model) {
  return {
    id: snap.id,
    model: snap.model,
    layout: migrate(snap.layout),
    rooms: model.rooms,
    render: 'editor',
    options: model.options,
    kinds: [...new Map(model.items.map((i) => [i.kind, i.label]))].map(
      ([kind, label]) => ({ kind, label }),
    ),
    lights: model.lights,
    sourceLights: model.sourceLights,
    asset: '/api/admin/model/' + snap.model,
  }
}

export function visitorView(snap, model, asset) {
  return {
    id: snap.id,
    layout: snap.layout,
    rooms: model.rooms,
    render: 'visitor',
    asset,
  }
}

export function publishedState(state, snapshot) {
  const same =
    state.published.id === snapshot.id &&
    state.published.asset === snapshot.asset
  return {
    ...state,
    published: snapshot,
    previous: same ? state.previous : state.published,
    job: { ...state.job, status: '공개 완료' },
  }
}
