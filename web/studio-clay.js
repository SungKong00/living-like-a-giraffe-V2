import { api, app } from './ui.js'
import {
  el,
  Brand,
  Button,
  ButtonGroup,
  Segmented,
  Slider,
  PanelHeader,
  PanelSection,
  PropertyRow,
  Badge,
  Toolbar,
  Callout,
  Spinner,
  renderKeepingFocus,
} from './ds/index.js'
import {
  clayMotionSection,
  hatchRow,
  initialClayMotion,
} from './clay-motion-controls.js'
import { giraffeProportionSection } from './giraffe-proportion-controls.js'
import { clayScene } from './clay-scene.js'
import { clayPresets as presets, clayPresetOf } from './clay-field.js'
import './views/studio-clay.css'

const levels = [
  { value: 'original', label: '원본' },
  { value: 'light', label: '약하게' },
  { value: 'medium', label: '보통' },
  { value: 'strong', label: '강하게' },
]
const sampleSubjects = [
  { value: 'bench', label: '벤치' },
  { value: 'giraffe', label: '네발 기린' },
  { value: 'biped', label: '두발 기린' },
]
const controls = [
  ['strength', '굴곡 강도', '모서리와 윤곽이 휘는 정도'],
  ['depth', '눌림 깊이', '손으로 누른 자리가 패이는 정도'],
  ['width', '자국 크기', '하나의 눌림이 차지하는 너비'],
]

export async function studioClay() {
  const library = await api('admin/characters')
  const subjects = sampleSubjects.filter(
    (s) =>
      s.value !== 'giraffe' || library.models.some((m) => m.id === 'riragi'),
  )
  const initial = new URLSearchParams(location.search).get('model')
  let kind = subjects.find((s) => s.value === initial)?.value ?? 'bench',
    outfit = 'none',
    poses = { giraffe: 'rest', biped: 'look' },
    scene,
    pending = 0
  let motion = initialClayMotion,
    proportions = {}
  function previewSurface(value) {
    motion = value
    scene?.setMotion(value)
  }
  function commitSurface(value) {
    previewSurface(value)
    drawPanel()
  }
  function shape(key, value) {
    proportions = { ...proportions, [key]: value }
    scene?.setProportions(proportions)
  }
  const settings = {
    bench: { ...presets.medium },
    giraffe: { ...presets.light },
    biped: { ...presets.light },
  }
  const canvas = el('canvas', {
    'aria-label': '원본과 점토 시안 3D 비교',
    tabindex: 0,
  })
  const panel = el('aside', {
    class: 'clay-preview__panel',
    'aria-label': '점토 조형 설정',
  })
  const variant = el('div', {
    class: 'clay-preview__right-label',
    'aria-live': 'polite',
  })
  const status = el(
    'div',
    { class: 'clay-preview__status', role: 'status' },
    Spinner(),
    '모델을 여는 중…',
  )
  const subject = el('div', { class: 'clay-preview__subject' })
  const presetRow = el('div', { class: 'clay-preview__preset' })
  const view = el(
    'div',
    { class: 'clay-preview__view' },
    canvas,
    el('div', { class: 'clay-preview__left-label' }, Badge({ label: '원본' })),
    variant,
    status,
    el(
      'div',
      { class: 'clay-preview__camera-tools' },
      Toolbar({
        label: '비교 시점',
        children: [
          el(
            'span',
            { class: 'clay-preview__gesture' },
            '드래그로 회전 · 휠로 확대',
          ),
          Button({
            label: '시점 초기화',
            size: 'sm',
            variant: 'ghost',
            icon: 'reset',
            onClick: () => scene?.frame(),
          }),
        ],
      }),
    ),
  )
  function updateLevel() {
    const current = settings[kind]
    const level = levels.find(({ value }) => value === clayPresetOf(current))
    variant.replaceChildren(
      Badge({
        label: '시안 · ' + (level?.label ?? '직접 조절'),
        tone: 'accent',
      }),
    )
    renderKeepingFocus(presetRow, () => [
      Segmented({
        key: 'clay-level',
        label: '점토 강도',
        options: levels,
        value: level?.value ?? 'custom',
        onChange: (value) => {
          settings[kind] = { ...presets[value] }
          drawPanel()
          schedule()
        },
      }),
    ])
  }
  function schedule() {
    if (pending) return
    pending = requestAnimationFrame(() => {
      pending = 0
      scene?.apply(settings[kind])
    })
  }
  async function showSubject(requested) {
    if (!scene) return
    status.hidden = false
    status.replaceChildren(Spinner(), '모델을 여는 중…')
    try {
      await scene.show(requested)
      if (kind !== requested) return
      scene.dress(outfit)
      scene.pose(poses[kind])
      scene.setProportions(proportions)
      scene.apply(settings[kind])
      status.hidden = true
      drawPanel()
    } catch (error) {
      if (kind === requested)
        status.replaceChildren(
          Callout({
            tone: 'danger',
            message: '시안 모델을 열 수 없습니다. ' + error.message,
          }),
        )
    }
  }
  function drawPanel() {
    const giraffe = kind !== 'bench'
    subject.replaceChildren(
      Segmented({
        label: '시안 모델',
        key: 'model',
        options: subjects,
        value: kind,
        onChange: (value) => {
          kind = value
          showSubject(kind)
          drawPanel()
          schedule()
          subject.querySelector('[aria-checked="true"]').focus()
        },
      }),
    )
    const fields = controls.map(([key, label, description]) => {
      function adjust(v) {
        settings[kind][key] = v
        updateLevel()
        schedule()
      }
      return PropertyRow({
        label,
        stack: true,
        children: [
          el(
            'div',
            { class: 'clay-preview__field' },
            Slider({
              label,
              key: 'clay-' + key,
              min: 0,
              max: 100,
              step: 1,
              value: settings[kind][key],
              format: (v) => v + '%',
              onInput: adjust,
              onCommit: adjust,
            }),
            el('span', { class: 'clay-preview__hint' }, description),
          ),
        ],
      })
    })
    renderKeepingFocus(panel, () => [
      PanelHeader({
        eyebrow: '비교 모델',
        title:
          kind === 'biped'
            ? '두발 점토 기린'
            : giraffe
              ? '점토 기린'
              : '사우나 나무 벤치',
      }),
      PanelSection({ title: '모델', children: [subject] }),
      PanelSection({ title: '점토 강도', children: [presetRow] }),
      clayMotionSection(motion, commitSurface, previewSurface),
      PanelSection({
        title: '세부 조절',
        children: [...fields, hatchRow(motion, commitSurface, previewSurface)],
      }),
      ...(giraffe
        ? [
            giraffeProportionSection(
              proportions,
              (key, value) => {
                shape(key, value)
                drawPanel()
              },
              shape,
              scene?.proportionDimensions ?? [],
            ),
            ...(kind === 'giraffe'
              ? [
                  PanelSection({
                    title: '착용',
                    children: [
                      Segmented({
                        key: 'giraffe-outfit',
                        label: '착용',
                        value: outfit,
                        options: [
                          { value: 'none', label: '기본' },
                          { value: 'cape', label: '케이프' },
                          { value: 'flower', label: '꽃핀' },
                          { value: 'both', label: '함께' },
                        ],
                        onChange(value) {
                          outfit = value
                          scene?.dress(value)
                          drawPanel()
                        },
                      }),
                    ],
                  }),
                ]
              : []),
            PanelSection({
              title: '포즈',
              children: [
                Segmented({
                  key: 'giraffe-pose',
                  label: '포즈',
                  value: poses[kind],
                  options: [
                    { value: 'rest', label: '서 있기' },
                    {
                      value: 'look',
                      label: kind === 'biped' ? '두 발 걷기' : '두리번거리기',
                    },
                  ],
                  onChange(value) {
                    poses[kind] = value
                    scene?.pose(value)
                    drawPanel()
                  },
                }),
              ],
            }),
          ]
        : []),
    ])
    updateLevel()
  }
  app.replaceChildren(
    el(
      'section',
      { class: 'studio clay-preview' },
      el(
        'header',
        { class: 'studio-bar' },
        el(
          'div',
          { class: 'studio-bar__start' },
          Brand({ product: '스튜디오', href: '/studio' }),
          el('span', { class: 'studio-bar__divider', 'aria-hidden': 'true' }),
          el('h1', { class: 'clay-preview__title' }, '점토 시안'),
        ),
        ButtonGroup({
          label: '스튜디오 탐색',
          children: [
            Button({
              label: '월드 편집기',
              href: '/studio',
              variant: 'ghost',
              icon: 'arrow-left',
            }),
          ],
        }),
      ),
      el('div', { class: 'clay-preview__body' }, view, panel),
    ),
  )
  drawPanel()
  try {
    scene = await clayScene(canvas)
    scene.setMotion(motion)
    await showSubject(kind)
  } catch (error) {
    status.replaceChildren(
      Callout({
        tone: 'danger',
        message: '시안 모델을 열 수 없습니다. ' + error.message,
      }),
    )
    console.error(error)
  }
  window.addEventListener(
    'pagehide',
    (e) => {
      if (!e.persisted) {
        cancelAnimationFrame(pending)
        scene?.dispose()
      }
    },
    { once: true },
  )
}
