import { createHash, randomUUID } from 'node:crypto'

const dayInSeoul = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' })
const automatic = {
  day: '편집 시작 전',
  import: 'Blender 적용 전',
  restore: '복원 전',
}

export function requireRevision(draft, expected) {
  if (draft.id !== expected)
    throw Object.assign(
      Error('다른 변경이 먼저 저장되었습니다. 다시 열어 확인하세요.'),
      { status: 409 },
    )
}

export function versionName(value) {
  const name = typeof value === 'string' ? value.trim() : ''
  if (!name || name.length > 80)
    throw Object.assign(Error('버전 이름은 1~80자로 입력하세요.'), {
      status: 400,
    })
  return name
}

export function versionRecord(draft, kind, title, now = new Date()) {
  // Stable identity makes a retried save of the same revision and name idempotent.
  const id = createHash('sha256')
    .update(
      JSON.stringify([
        draft.id,
        kind,
        title,
        kind === 'day' ? dayInSeoul.format(now) : null,
      ]),
    )
    .digest('hex')
  return {
    id,
    kind,
    title,
    createdAt: now.toISOString(),
    revision: draft.id,
    model: draft.model,
  }
}

export function changeDraft(
  state,
  expected,
  model,
  layout,
  reason,
  now = new Date(),
) {
  requireRevision(state.draft, expected)
  const day = dayInSeoul.format(now)
  const kinds = state.editDay === day ? [] : ['day']
  if (reason) kinds.push(reason)
  return {
    next: {
      ...state,
      editDay: day,
      draft: { id: randomUUID(), model, layout },
    },
    records: kinds.map((kind) =>
      versionRecord(state.draft, kind, automatic[kind], now),
    ),
  }
}
