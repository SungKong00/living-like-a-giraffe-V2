import { helperControls, rememberTask } from './helper-controls.js'
import { api } from './ui.js'
import {
  el,
  Badge,
  Button,
  Callout,
  Popover,
  StatusText,
  Steps,
} from './ds/index.js'
import { previewReview } from './preview.js'

const building = (job) => ['대기', '베이크', '최적화'].includes(job?.status)
const stages = [
  ['대기', '순서 대기'],
  ['베이크', '조명 굽기'],
  ['최적화', '휴대폰용 최적화'],
]

// State pattern, table form: classify() names the situation once and each
// state describes everything the control shows for it. Adding a server state
// means adding one entry here instead of another branch in the renderer.
const busyBadge = (job, percent = job.bakePercent) => [
  Number.isInteger(percent) ? '조명 굽기 · ' + percent + '%' : job.status + '…',
  'neutral',
]
const states = {
  live: {
    badge: null,
    status: ['방문자가 이 초안을 보고 있습니다', 'success'],
    primary: { label: '공개본이 최신입니다' },
    steps: ['done', 'done', 'done'],
  },
  idle: {
    badge: null,
    status: ['공개되지 않은 변경이 있습니다', 'warning'],
    primary: { label: '구운 결과 준비', action: 'prepare' },
    steps: ['current', 'upcoming', 'upcoming'],
  },
  failed: {
    badge: null,
    status: ['공개되지 않은 변경이 있습니다', 'warning'],
    primary: { label: '다시 준비', action: 'prepare' },
    steps: ['current', 'upcoming', 'upcoming'],
  },
  preparing: {
    badge: busyBadge,
    status: ['결과를 만드는 중입니다', 'warning'],
    primary: { label: '결과 준비 중…' },
    steps: ['current', 'upcoming', 'upcoming'],
  },
  ready: {
    badge: () => ['검토 가능', 'highlight'],
    status: ['공개할 결과가 준비되었습니다', 'success'],
    primary: { label: '구운 결과 열기', action: 'review' },
    steps: ['done', 'current', 'upcoming'],
  },
  publishing: {
    badge: busyBadge,
    status: ['공개 파일을 만드는 중입니다', 'warning'],
    primary: { label: '발행 처리 중…' },
    steps: ['done', 'done', 'current'],
  },
}

function classify(status, revision) {
  const job = status?.job
  const current = job?.revision === revision
  if (job?.kind === 'publish' && building(job)) return 'publishing'
  if (current && job.kind === 'review' && building(job)) return 'preparing'
  if (current && job.kind === 'review' && job.status === '검토 가능')
    return 'ready'
  if (status?.published === revision) return 'live'
  if (current && job.status === '실패') return 'failed'
  return 'idle'
}

// The publish control lives in the top bar. Its popover walks through
// prepare → review → publish and always says what the visitor sees now.
export function publishControl({ flush, revision, onError, helper = false }) {
  const controls = helperControls('publish', onError)
  let status = null,
    watched = null,
    cancelled = false
  const badgeSlot = el('span', { class: 'publish-badge' })
  const trigger = Button({
    label: '발행',
    icon: 'publish',
    variant: 'primary',
    badge: badgeSlot,
  })
  const popover = Popover({
    trigger,
    label: '발행',
    width: 'lg',
    placement: 'bottom-end',
    content: () => panel(),
  })

  async function run(fn) {
    try {
      await fn()
    } catch (e) {
      onError(e.message)
    }
    await refresh()
  }
  const actions = {
    async prepare() {
      await flush()
      cancelled = false
      const job = await api('admin/reviews', 'POST', { revision: revision() })
      if (helper) rememberTask('publish', job.job)
    },
    async review() {
      popover.close()
      await previewReview(status.job.id, refresh)
    },
  }
  async function direct() {
    if (!confirm('구운 결과를 확인하지 않고 처리가 끝나는 즉시 공개할까요?'))
      return
    await flush()
    await api('admin/publish', 'POST', { revision: revision() })
  }
  async function restore() {
    if (
      !confirm(
        '방문자 화면을 직전 공개본으로 되돌릴까요? 편집 중인 초안은 그대로 남습니다.',
      )
    )
      return
    await api('admin/restore', 'POST')
  }

  async function refresh() {
    status = await api('admin/status')
    if (helper)
      await controls.check(status.helper, status.job?.status === '대기')
    const job = status.job
    // Saving the draft drops a review prepared for an older revision; tell the
    // operator instead of silently returning to the first step.
    const pending =
      job?.kind === 'review' && (building(job) || job.status === '검토 가능')
    if (watched && !(pending && job.revision === watched)) {
      if (job?.revision !== watched) cancelled = true
      watched = null
    }
    if (pending) {
      watched = job.revision
      cancelled = false
    }
    render()
    return status
  }

  function render() {
    const key = classify(status, revision())
    const state = states[key]
    const badge =
      state.badge?.(status.job, controls.bakePercent) ||
      (cancelled ? ['다시 준비', 'warning'] : null)
    badgeSlot.replaceChildren(
      badge ? Badge({ label: badge[0], tone: badge[1] }) : '',
    )
    popover.refresh()
  }

  function meter(job) {
    const at = stages.findIndex(([id]) => id === job.status)
    return el(
      'div',
      { class: 'publish-meter', 'aria-label': '진행 단계' },
      ...stages.map(([, name], n) =>
        el(
          'span',
          {
            class: 'publish-meter__stage',
            'data-state': n < at ? 'done' : n === at ? 'current' : 'upcoming',
          },
          name,
        ),
      ),
    )
  }

  function panel() {
    if (!status)
      return [
        el('p', { class: 'publish-panel__loading' }, '상태를 불러오는 중…'),
      ]
    const key = classify(status, revision())
    const state = states[key]
    const [statusLabel, tone] = state.status
    const busy = key === 'preparing' || key === 'publishing'
    const directButton = Button({
      label: '검토 없이 바로 발행',
      variant: 'link',
      disabled: key !== 'idle' && key !== 'failed',
      onClick: () => run(direct),
    })
    return el(
      'div',
      { class: 'publish-panel' },
      el(
        'header',
        { class: 'publish-panel__head' },
        el('strong', { class: 'publish-panel__title' }, '발행'),
        StatusText({ label: statusLabel, tone, pulse: busy }),
      ),
      !helper &&
        Steps({
          label: '발행 단계',
          steps: [
            {
              title: '구운 결과 준비',
              description:
                '서버가 최종 조명과 휴대폰용 모델을 만듭니다. 창을 닫아도 계속됩니다.',
              state: state.steps[0],
              content: key === 'preparing' ? meter(status.job) : null,
            },
            {
              title: '비공개로 확인',
              description:
                '방문자 화면과 같은 렌더러로 방과 안내를 눌러 봅니다.',
              state: state.steps[1],
            },
            {
              title: '공개',
              description:
                '확인 화면의 ‘이 결과 공개’로 같은 파일을 공개합니다.',
              state: state.steps[2],
              content: key === 'publishing' ? meter(status.job) : null,
            },
          ],
        }),
      helper &&
        key !== 'live' &&
        el(
          'p',
          {},
          {
            idle: '도우미로 초안의 조명을 구운 뒤, 방문자에게 보일 장면을 확인하세요.',
            failed: '미리보기를 다시 만들 수 있습니다.',
            preparing:
              status.job?.status === '대기'
                ? '도우미가 연결되면 이 컴퓨터에서 조명 굽기를 시작합니다.'
                : '편집자의 컴퓨터에서 조명을 굽고 있습니다.',
            ready: '장면을 확인한 뒤 ‘이 결과 공개’를 누르세요.',
            publishing: '도우미가 작업을 마치면 바로 공개됩니다.',
          }[key],
        ),
      helper && controls.panel(status.helper, refresh),
      cancelled && !['preparing', 'ready'].includes(key)
        ? Callout({
            tone: 'warning',
            message:
              '결과를 준비한 뒤 초안이 바뀌어 준비한 결과가 취소되었습니다. 다시 준비하세요.',
          })
        : null,
      key === 'failed'
        ? Callout({
            tone: 'danger',
            message: '처리 실패 · ' + (status.job.error || status.job.status),
          })
        : null,
      Button({
        label:
          helper && state.primary.action === 'prepare'
            ? '비공개 미리보기 만들기'
            : helper && state.primary.action === 'review'
              ? '공개 전 미리보기'
              : state.primary.label,
        variant: 'primary',
        wide: true,
        icon:
          state.primary.action === 'review'
            ? 'preview'
            : state.primary.action
              ? 'publish'
              : undefined,
        disabled: !state.primary.action,
        onClick: state.primary.action
          ? () => run(actions[state.primary.action])
          : undefined,
      }),
      el(
        'footer',
        { class: 'publish-panel__foot' },
        !helper && directButton,
        status.previous
          ? Button({
              label: '직전 공개본 복원',
              variant: 'link',
              onClick: () => run(restore),
            })
          : null,
        el(
          'small',
          { class: 'publish-panel__version' },
          '공개 버전 ' + (status.published || '').slice(0, 8),
        ),
      ),
    )
  }

  return { element: popover.element, refresh, close: () => popover.close() }
}
