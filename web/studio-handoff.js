import { api } from './ui.js'
import {
  el,
  Button,
  ColorDot,
  Dialog,
  Icon,
  RadioCards,
  Select,
  Spinner,
  Steps,
} from './ds/index.js'
import { previewCandidate } from './preview.js'
import { lightKinds } from '../shared/studio-lights.mjs'
import { yawOf } from './edit-ops.js'

const props = {
  energy: '출력',
  shape: '빛 모양과 방향',
  enabled: '조명 켜짐',
  position: '위치',
  rotation: '방향',
  scale: '크기',
  color: '색',
  finish: '표면',
  label: '이름',
  room: '방',
}
const finishes = { original: '원본', matte: '무광', gloss: '유광' }

function direction([x, y, z, w]) {
  return (
    '방향 ' +
    [-2 * (x * z + w * y), 2 * (w * x - y * z), 2 * (x * x + y * y) - 1]
      .map((v) => v.toFixed(2))
      .join(', ')
  )
}
function describe(prop, value, rooms, source) {
  if (value == null) return '삭제됨'
  if (!prop) return '있음 · ' + value.label
  if (prop === 'enabled') return value ? '켜짐' : '꺼짐'
  if (prop === 'shape') {
    const info = [lightKinds[value.type].label]
    if (value.type === 'spot')
      info.push(
        value.angle + '°',
        '부드러움 ' + Math.round(100 * value.blend) + '%',
      )
    if (value.type === 'area')
      info.push(value.width + ' × ' + value.height + ' m')
    if (value.rotation) {
      info.push(direction(value.rotation))
    }
    return info.join(' · ')
  }
  if (prop === 'rotation') return source ? direction(value) : yawOf(value) + '°'
  if (prop === 'position' || prop === 'scale')
    return value.map((v) => Math.round(v * 100) / 100).join(' · ')
  if (prop === 'color')
    return value === 'original'
      ? '원본 색'
      : el('span', { class: 'handoff-color' }, ColorDot(value), value)
  if (prop === 'finish') return finishes[value] || value
  if (prop === 'room') return rooms.find((r) => r.id === value)?.label || value
  return String(value)
}

// Blender round trip as three steps: send the full file, take the edited file
// back, then settle every conflict and broken click-area link before applying.
export function openHandoff({ flush, draft, rooms, onError }) {
  let candidate = null,
    choices = {},
    replacements = {},
    busy = ''
  const dialog = Dialog({
    title: 'Blender 인계',
    description:
      '제작자와 전체 .blend 파일을 주고받고, 바뀐 점을 확인해 초안에 합칩니다.',
    size: 'lg',
  })

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

  function dropzone() {
    const file = el('input', {
      type: 'file',
      accept: '.blend',
      class: 'sr-only',
      disabled: !!busy,
    })
    file.onchange = () =>
      file.files[0] &&
      task('Blender 파일을 확인하는 중…', () => upload(file.files[0]))
    return el(
      'label',
      { class: 'dropzone' },
      file,
      el('span', { class: 'dropzone__icon' }, Icon('upload', 'lg')),
      el(
        'strong',
        {},
        candidate ? '다른 .blend 파일 선택' : '.blend 파일 선택',
      ),
      el('small', {}, '외부 데이터를 패킹해 저장한 전체 파일 하나'),
    )
  }

  function review(layout) {
    const known = [...candidate.rooms, ...candidate.items]
    const orphans = layout.spots.filter(
      (s) => !known.some((k) => k.id === s.anchor),
    )
    const name = (id) => {
      if (id.startsWith('source:'))
        return (
          candidate.sourceCatalog.find((l) => l.id === id.slice(7))?.label || id
        )
      const isLight = id.startsWith('light:')
      const rows = isLight
        ? [...(candidate.lights ?? []), ...(layout.lights ?? [])]
        : [...candidate.items, ...layout.items]
      return (
        rows.find((row) => row.id === (isLight ? id.slice(6) : id))?.label || id
      )
    }
    const unresolved =
      candidate.conflicts.filter((c) => !choices[c.key]).length +
      orphans.filter((s) => !replacements[s.id]).length
    const decisions = [
      ...candidate.conflicts.map((c) => {
        const [id, prop] = c.key.split('.')
        return RadioCards({
          legend:
            (c.removedSource || name(id)) +
            (prop ? ' · ' + (props[prop] || prop) : ' · 오브젝트'),
          name: c.key,
          value: choices[c.key],
          options: c.removedSource
            ? [
                {
                  value: 'file',
                  title: '제작본의 삭제 반영',
                  content:
                    '이 조명을 유지하려면 Blender에서 복원한 전체 파일을 다시 올리세요.',
                },
              ]
            : [
                {
                  value: 'web',
                  title: '웹',
                  content: describe(
                    prop,
                    c.web,
                    rooms,
                    id.startsWith('source:'),
                  ),
                },
                {
                  value: 'file',
                  title: '제작본',
                  content: describe(
                    prop,
                    c.file,
                    rooms,
                    id.startsWith('source:'),
                  ),
                },
              ],
          onChange: (side) => {
            choices[c.key] = side
            render()
          },
        })
      }),
      ...orphans.map((s) =>
        el(
          'div',
          { class: 'handoff-orphan' },
          el('strong', {}, s.label + ' · 연결 대상이 사라짐'),
          Select({
            label: s.label + ' 연결 복구',
            value: replacements[s.id] || '',
            options: [
              { value: '', label: '연결할 대상을 고르세요' },
              ...known.map((k) => ({ value: k.id, label: k.label })),
              { value: '__delete', label: '이 클릭 영역 삭제' },
            ],
            onChange: (v) => {
              replacements[s.id] = v
              render()
            },
          }),
        ),
      ),
    ]
    const apply = Button({
      label: '검토 결과를 초안에 적용',
      variant: 'primary',
      icon: 'check',
      disabled: unresolved > 0 || !!busy,
      onClick: () => task('초안에 적용하는 중…', accept),
    })
    dialog.setFooter(
      unresolved
        ? el(
            'small',
            { class: 'handoff-remaining' },
            '남은 선택 ' + unresolved + '건',
          )
        : null,
      el('span', { class: 'dialog-spacer' }),
      Button({
        label: '최신 초안과 다시 비교',
        variant: 'ghost',
        disabled: !!busy,
        onClick: () => task('다시 비교하는 중…', compare),
      }),
      Button({
        label: '선택한 결과 미리보기',
        icon: 'preview',
        disabled: !!busy,
        onClick: () => task('', () => previewCandidate(candidate, choices)),
      }),
      apply,
    )
    return el(
      'div',
      { class: 'handoff-review' },
      el(
        'p',
        { class: 'handoff-note' },
        candidate.conflicts.length || orphans.length
          ? '웹과 제작본이 같은 항목을 다르게 바꿨습니다. 남길 값을 고르세요.'
          : '충돌이 없습니다. 미리 보고 초안에 적용하세요.',
      ),
      ...decisions,
    )
  }

  function render() {
    const layout = draft()
    dialog.body.replaceChildren(
      Steps({
        label: 'Blender 인계 단계',
        steps: [
          {
            title: '제작자에게 보낼 파일',
            description:
              '마지막으로 저장한 초안의 배치·복제본·옵션이 담긴 전체 .blend 파일입니다.',
            state: candidate ? 'done' : 'current',
            content: el(
              'div',
              { class: 'handoff-actions' },
              Button({
                label: '초안 내려받기',
                icon: 'download',
                variant: 'primary',
                disabled: !!busy,
                onClick: () =>
                  task('전체 파일을 만드는 중…', () => download('draft')),
              }),
              Button({
                label: '공개본 내려받기',
                icon: 'download',
                disabled: !!busy,
                onClick: () =>
                  task('전체 파일을 만드는 중…', () => download('published')),
              }),
            ),
          },
          {
            title: '수정한 파일 올리기',
            description: '제작자가 고친 파일을 올리면 웹 초안과 비교합니다.',
            state: candidate ? 'done' : 'upcoming',
            content: dropzone(),
          },
          {
            title: '바뀐 점 확인',
            description: candidate
              ? null
              : '파일을 올리면 웹과 다르게 바뀐 항목이 여기에 나타납니다.',
            state: candidate ? 'current' : 'upcoming',
            content: candidate ? review(layout) : null,
          },
        ],
      }),
      busy
        ? el('div', { class: 'handoff-busy', role: 'status' }, Spinner(), busy)
        : '',
    )
    if (!candidate) dialog.setFooter()
  }
  render()
  dialog.open()
}
