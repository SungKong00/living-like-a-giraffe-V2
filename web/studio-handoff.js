import { api, el, button } from './ui.js'
import { previewCandidate } from './preview.js'
import { yawOf } from './edit-ops.js'

const props = {
  position: '위치',
  rotation: '방향',
  scale: '크기',
  color: '색',
  finish: '표면',
  label: '이름',
  room: '방',
}
const finishes = { original: '원본', matte: '무광', gloss: '유광' }

function describe(prop, value, rooms) {
  if (value == null) return el('span', { class: 'muted' }, '삭제됨')
  if (!prop) return el('span', {}, '있음 · ' + value.label)
  if (prop === 'rotation') return el('span', {}, yawOf(value) + '°')
  if (prop === 'position' || prop === 'scale')
    return el(
      'span',
      {},
      value.map((v) => Math.round(v * 100) / 100).join(' · '),
    )
  if (prop === 'color')
    return value === 'original'
      ? el('span', {}, '원본 색')
      : el(
          'span',
          {},
          el('i', { class: 'chip', style: 'background:' + value }),
          value,
        )
  if (prop === 'finish') return el('span', {}, finishes[value] || value)
  if (prop === 'room')
    return el('span', {}, rooms.find((r) => r.id === value)?.label || value)
  return el('span', {}, String(value))
}

// Blender round trip as three steps: send the full file, take the edited file
// back, then settle every conflict and broken click-area link before applying.
export function openHandoff({ flush, draft, rooms, onError }) {
  let candidate = null,
    choices = {},
    replacements = {},
    busy = ''
  const dialog = el('dialog', { class: 'sheet', 'aria-label': 'Blender 인계' })
  const body = el('div', { class: 'sheet-body' })
  dialog.append(
    el(
      'div',
      { class: 'sheet-head' },
      el('strong', {}, 'Blender 인계'),
      button('닫기', () => dialog.close()),
    ),
    body,
  )
  document.body.append(dialog)
  dialog.addEventListener('close', () => dialog.remove())

  async function task(message, fn) {
    busy = message
    render()
    try {
      await fn()
    } catch (e) {
      onError(e.message)
    } finally {
      busy = ''
      render()
    }
  }
  async function download(which) {
    if (which === 'draft') await flush()
    const res = await fetch('/api/admin/download/' + which)
    if (!res.ok)
      throw Error((await res.json().catch(() => ({}))).error || '다운로드 실패')
    const url = URL.createObjectURL(await res.blob())
    el('a', { href: url, download: 'riragi-' + which + '.blend' }).click()
    setTimeout(() => URL.revokeObjectURL(url), 30000)
  }
  async function upload(file) {
    await flush()
    candidate = await api('admin/upload', 'POST', file)
    choices = {}
    replacements = {}
  }
  async function compare() {
    await flush()
    candidate = await api('admin/compare/' + candidate.model)
    choices = {}
  }
  async function accept() {
    await flush()
    const spots = draft()
      .spots.filter((s) => replacements[s.id] !== '__delete')
      .map((s) => ({ ...s, anchor: replacements[s.id] || s.anchor }))
    await api('admin/import', 'POST', { ...candidate, choices, spots })
    location.reload()
  }

  function render() {
    const layout = draft()
    const file = el('input', {
      type: 'file',
      accept: '.blend',
      id: 'handoff-file',
    })
    file.onchange = () =>
      file.files[0] &&
      task('Blender 파일을 확인하는 중…', () => upload(file.files[0]))
    const parts = [
      el(
        'section',
        { class: 'sheet-step' },
        el('h3', {}, '1. 제작자에게 보낼 파일'),
        el(
          'p',
          {},
          '마지막으로 저장한 초안의 배치·복제본·옵션이 담긴 전체 .blend 파일입니다.',
        ),
        el(
          'div',
          { class: 'button-row' },
          button(
            '초안 내려받기',
            () => task('전체 파일을 만드는 중…', () => download('draft')),
            'primary',
          ),
          button('공개본 내려받기', () =>
            task('전체 파일을 만드는 중…', () => download('published')),
          ),
        ),
      ),
      el(
        'section',
        { class: 'sheet-step' },
        el('h3', {}, '2. 수정한 파일 올리기'),
        el('p', {}, '외부 데이터를 패킹해 저장한 전체 파일 하나를 올립니다.'),
        el(
          'label',
          { class: 'drop', for: 'handoff-file' },
          '.blend 파일 선택',
          file,
        ),
      ),
    ]
    if (candidate) {
      const known = [...candidate.rooms, ...candidate.items]
      const orphans = layout.spots.filter(
        (s) => !known.some((k) => k.id === s.anchor),
      )
      const name = (id) =>
        [...candidate.items, ...layout.items].find((i) => i.id === id)?.label ||
        id
      const unresolved =
        candidate.conflicts.filter((c) => !choices[c.key]).length +
        orphans.filter((s) => !replacements[s.id]).length
      const apply = button(
        '검토 결과를 초안에 적용',
        () => task('초안에 적용하는 중…', accept),
        'primary',
      )
      apply.disabled = unresolved > 0
      parts.push(
        el(
          'section',
          { class: 'sheet-step' },
          el('h3', {}, '3. 바뀐 점 확인'),
          el(
            'p',
            {},
            candidate.conflicts.length || orphans.length
              ? '웹과 제작본이 같은 항목을 다르게 바꿨습니다. 남길 값을 고르세요.'
              : '충돌이 없습니다. 미리 보고 초안에 적용하세요.',
          ),
          ...candidate.conflicts.map((c) => {
            const [id, prop] = c.key.split('.')
            return el(
              'fieldset',
              { class: 'conflict' },
              el(
                'legend',
                {},
                name(id) +
                  (prop ? ' · ' + (props[prop] || prop) : ' · 가구 자체'),
              ),
              ...[
                ['web', '웹', c.web],
                ['file', '제작본', c.file],
              ].map(([side, title, value]) =>
                el(
                  'label',
                  { class: choices[c.key] === side ? 'on' : null },
                  el('input', {
                    type: 'radio',
                    name: c.key,
                    checked: choices[c.key] === side ? '' : null,
                    onchange: () => {
                      choices[c.key] = side
                      render()
                    },
                  }),
                  el('b', {}, title),
                  describe(prop, value, rooms),
                ),
              ),
            )
          }),
          ...orphans.map((s) => {
            const select = el(
              'select',
              { 'aria-label': s.label + ' 연결 복구' },
              el('option', { value: '' }, '연결할 대상을 고르세요'),
              ...known.map((k) => el('option', { value: k.id }, k.label)),
              el('option', { value: '__delete' }, '이 클릭 영역 삭제'),
            )
            select.value = replacements[s.id] || ''
            select.onchange = () => {
              replacements[s.id] = select.value
              render()
            }
            return el(
              'fieldset',
              { class: 'conflict' },
              el('legend', {}, s.label + ' · 연결 대상이 사라짐'),
              select,
            )
          }),
          el(
            'div',
            { class: 'button-row' },
            button('최신 초안과 다시 비교', () =>
              task('다시 비교하는 중…', compare),
            ),
            button('선택한 결과 미리보기', () =>
              task('', () => previewCandidate(candidate, choices)),
            ),
            apply,
          ),
          unresolved
            ? el('small', { class: 'muted' }, '남은 선택 ' + unresolved + '건')
            : null,
        ),
      )
    }
    if (busy) parts.push(el('p', { class: 'callout', role: 'status' }, busy))
    body.replaceChildren(...parts)
    for (const b of body.querySelectorAll('button')) b.disabled ||= !!busy
  }
  render()
  dialog.showModal()
}
