import {
  helperControls,
  rememberTask,
  pendingTask,
  forgetTask,
} from './helper-controls.js'
import { api } from './ui.js'
import {
  el,
  Button,
  ColorDot,
  Dialog,
  FileDrop,
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

// A file may finish uploading before the first installation opens a new tab.
// Pick up just that browser's waiting upload even with the file dialog closed.
const pickup = helperControls('inspect')
let pickingUp = false
export async function resumeUpload() {
  const id = pendingTask('inspect')
  if (!id || pickingUp) return
  pickingUp = true
  try {
    const incoming = await api('admin/upload-status')
    if (incoming?.id !== id || incoming.status !== '대기' || !incoming.helper)
      forgetTask('inspect', id)
    else await pickup.check(incoming.helper, true)
  } finally {
    pickingUp = false
  }
}

// Blender round trip as three steps: send the full file, take the edited file
// back, then settle every conflict and broken click-area link before applying.
export function openHandoff({
  flush,
  draft,
  rooms,
  onError,
  cloud = false,
  revision,
}) {
  const controls = helperControls('inspect', onError)
  let incoming,
    timer,
    checkNumber = 0
  let candidate = null,
    choices = {},
    replacements = {},
    busy = ''
  const dialog = Dialog({
    title: cloud ? 'Blender 파일' : 'Blender 인계',
    onClose: () => clearTimeout(timer),
    description: cloud
      ? '공개 장면을 Blender에서 수정하고 웹 초안에 반영합니다.'
      : '제작자와 전체 .blend 파일을 주고받고, 바뀐 점을 확인해 초안에 합칩니다.',
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
    el('a', {
      href: url,
      download:
        /filename="([^"]+)"/.exec(
          res.headers.get('Content-Disposition') || '',
        )?.[1] || 'riragi-' + which + '.blend',
    }).click()
    setTimeout(() => URL.revokeObjectURL(url), 30000)
  }
  async function upload(file) {
    await flush()
    if (cloud && file.size > 16 * 1024 * 1024)
      throw Error('16 MiB 이하의 .blend 파일을 선택하세요.')
    if (!file.name.toLowerCase().endsWith('.blend'))
      throw Error('.blend 파일 하나를 선택하세요.')
    const result = cloud
      ? await new Promise((resolve, reject) => {
          const req = new XMLHttpRequest()
          req.open('POST', '/api/admin/upload')
          req.responseType = 'json'
          req.setRequestHeader('Content-Type', 'application/octet-stream')
          req.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              busy =
                '파일 올리는 중 · ' +
                Math.round((event.loaded / event.total) * 100) +
                '%'
              render()
            }
          }
          req.onload = () =>
            req.status >= 200 && req.status < 300
              ? resolve(req.response)
              : reject(
                  Error(req.response?.error || '파일을 올리지 못했습니다.'),
                )
          req.onerror = req.ontimeout = () =>
            reject(Error('연결을 확인하고 파일을 다시 올리세요.'))
          req.timeout = 120000
          req.send(file)
        })
      : await api('admin/upload', 'POST', file)
    if (cloud) rememberTask('inspect', result.id)
    candidate = cloud ? null : result
    if (cloud) await checkUpload()

    choices = {}
    replacements = {}
  }
  async function checkUpload() {
    const number = ++checkNumber
    clearTimeout(timer)
    const current = await api('admin/upload-status')
    if (number !== checkNumber) return
    await controls.check(current?.helper, current?.status === '대기')
    if (!dialog.isOpen || number !== checkNumber) return
    incoming = current
    if (candidate?.model !== incoming?.id) candidate = null
    if (!candidate && incoming?.status === '검토 가능') {
      const result = await api('admin/compare/' + incoming.id)
      if (!dialog.isOpen || number !== checkNumber) return
      candidate = result
      choices = {}
      replacements = {}
    }
    render()
    if (!candidate)
      timer = setTimeout(
        () => checkUpload().catch((e) => onError(e.message)),
        3000,
      )
  }
  async function compare() {
    await flush()
    candidate = await api('admin/compare/' + candidate.model)
    choices = {}
  }
  async function accept() {
    await flush()
    if (cloud && candidate.revision !== revision())
      throw Error(
        '다른 편집자가 초안을 저장했습니다. 스튜디오를 다시 열어 확인하세요.',
      )
    const spots = draft()
      .spots.filter((s) => replacements[s.id] !== '__delete')
      .map((s) => ({ ...s, anchor: replacements[s.id] || s.anchor }))
    await api('admin/import', 'POST', { ...candidate, choices, spots })
    location.reload()
  }

  function dropzone() {
    return FileDrop({
      accept: '.blend',
      disabled: !!busy,
      onError,
      label: candidate
        ? '다른 .blend 파일 선택'
        : '.blend 파일을 끌어놓거나 선택',
      description: cloud
        ? '현재 공개본에서 수정한 .blend · 최대 16 MiB'
        : '외부 데이터를 패킹해 저장한 전체 파일 하나',
      onFile: (file) => task('파일 올리는 중…', () => upload(file)),
    })
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
          legend: c.replaceModel
            ? '초안의 Blender 장면 교체'
            : (c.removedSource || name(id)) +
              (prop ? ' · ' + (props[prop] || prop) : ' · 오브젝트'),
          name: c.key,
          value: choices[c.key],
          options: c.replaceModel
            ? [
                {
                  value: 'file',
                  title: '올린 장면으로 교체',
                  content:
                    '초안의 가구와 조명을 올린 파일로 교체합니다. 행사 글과 연결은 유지합니다.',
                },
              ]
            : c.removedSource
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
          ? '초안에 적용할 항목과 연결을 확인하세요.'
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
            title: cloud ? '현재 공개 장면' : '제작자에게 보낼 파일',
            description: cloud
              ? '방문자가 보는 장면의 가구와 조명이 담겨 있습니다.'
              : '마지막으로 저장한 초안의 배치·복제본·옵션이 담긴 전체 .blend 파일입니다.',
            state: candidate ? 'done' : 'current',
            content: el(
              'div',
              { class: 'handoff-actions' },
              !cloud &&
                Button({
                  label: '초안 내려받기',
                  icon: 'download',
                  variant: 'primary',
                  disabled: !!busy,
                  onClick: () =>
                    task('전체 파일을 만드는 중…', () => download('draft')),
                }),
              Button({
                label: cloud ? '공개본 .blend 내려받기' : '공개본 내려받기',
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
            content: el(
              'div',
              {},
              dropzone(),
              cloud &&
                !candidate &&
                controls.panel(incoming?.helper, checkUpload),
              cloud &&
                incoming?.helper &&
                el(
                  'div',
                  {},
                  el(
                    'p',
                    {},
                    incoming.status === '대기'
                      ? '연결되면 이 컴퓨터에서 검토용 장면을 만듭니다.'
                      : '도우미가 수정본을 확인하고 있습니다.',
                  ),
                ),
              cloud &&
                incoming?.error &&
                el('p', { role: 'alert' }, incoming.error),
            ),
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
  if (cloud) checkUpload().catch((e) => onError(e.message))
}
