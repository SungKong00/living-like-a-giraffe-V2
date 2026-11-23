import { api, el } from './ui.js'
import { previewReview } from './preview.js'

const building = (job) => ['대기', '베이크', '최적화'].includes(job?.status)
const steps = [
  ['대기', '순서 대기'],
  ['베이크', '조명 굽기'],
  ['최적화', '휴대폰용 최적화'],
]

// The publish control lives in the top bar. Its popover walks through
// prepare → review → publish and always says what the visitor sees now.
export function publishControl({ flush, revision, onError }) {
  let status = null,
    open = false,
    watched = null,
    cancelled = false
  const label = el('span', {}, '발행')
  const badge = el('span', { class: 'badge', hidden: '' })
  const button = el(
    'button',
    {
      type: 'button',
      class: 'primary publish-trigger',
      'aria-haspopup': 'dialog',
      'aria-expanded': 'false',
      onclick: () => toggle(),
    },
    label,
    badge,
  )
  const pop = el('div', {
    class: 'popover publish-pop',
    role: 'dialog',
    'aria-label': '발행',
    hidden: '',
  })
  const wrap = el('div', { class: 'publish-wrap' }, button, pop)
  function toggle(next = !open) {
    open = next
    pop.hidden = !open
    button.setAttribute('aria-expanded', String(open))
    if (open) render()
  }
  document.addEventListener('pointerdown', (e) => {
    if (open && !wrap.contains(e.target)) toggle(false)
  })

  async function run(fn) {
    try {
      await fn()
    } catch (e) {
      onError(e.message)
    }
    await refresh()
  }
  async function prepare() {
    await flush()
    cancelled = false
    await api('admin/reviews', 'POST', { revision: revision() })
  }
  async function openReview() {
    await previewReview(status.job.id, refresh)
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

  function state() {
    const job = status?.job
    const current = job?.revision === revision()
    const live = status?.published === revision()
    const reviewing = current && job.kind === 'review'
    return {
      job,
      live,
      reviewing,
      preparing: reviewing && building(job),
      ready: reviewing && job.status === '검토 가능',
      publishing: job?.kind === 'publish' && building(job),
      failed: current && job.status === '실패',
    }
  }

  function render() {
    const s = state()
    badge.hidden = !(s.preparing || s.publishing || s.ready || cancelled)
    badge.textContent = s.ready
      ? '검토 가능'
      : s.preparing || s.publishing
        ? s.job.status + '…'
        : cancelled
          ? '다시 준비'
          : ''
    badge.className = 'badge' + (s.ready ? ' ready' : '')
    if (!open) return
    const primary = s.ready
      ? ['구운 결과 열기', openReview]
      : s.preparing
        ? ['결과 준비 중…', null]
        : s.publishing
          ? ['발행 처리 중…', null]
          : s.live
            ? ['공개본이 최신입니다', null]
            : [s.failed ? '다시 준비' : '구운 결과 준비', prepare]
    const go = el(
      'button',
      {
        type: 'button',
        class: 'primary wide',
        onclick: primary[1] ? () => run(primary[1]) : null,
      },
      primary[0],
    )
    go.disabled = !primary[1]
    const progress = s.reviewing || s.publishing ? s.job.status : null
    const stage = (name) => {
      if (s.ready || s.job?.status === '공개 완료') return 'done'
      const order = steps.map(([id]) => id)
      const at = order.indexOf(progress)
      const me = order.indexOf(name)
      if (at < 0) return ''
      return me < at ? 'done' : me === at ? 'now' : ''
    }
    const directButton = el(
      'button',
      { type: 'button', class: 'link', onclick: () => run(direct) },
      '검토 없이 바로 발행',
    )
    directButton.disabled = s.live || s.ready || s.preparing || s.publishing
    const parts = [
      el(
        'div',
        { class: 'pop-head' },
        el('strong', {}, '발행'),
        el(
          'span',
          { class: 'state ' + (s.live ? 'ok' : 'warn') },
          s.live
            ? '방문자가 이 초안을 보고 있습니다'
            : '공개되지 않은 변경이 있습니다',
        ),
      ),
      el(
        'ol',
        { class: 'steps' },
        el(
          'li',
          {
            class:
              s.ready || s.job?.status === '공개 완료'
                ? 'done'
                : s.preparing
                  ? 'now'
                  : '',
          },
          el('b', {}, '1. 구운 결과 준비'),
          el(
            'small',
            {},
            '서버가 최종 조명과 휴대폰용 모델을 만듭니다. 창을 닫아도 계속됩니다.',
          ),
          progress
            ? el(
                'div',
                { class: 'meter' },
                ...steps.map(([id, name]) =>
                  el('span', { class: stage(id) }, name),
                ),
              )
            : null,
        ),
        el(
          'li',
          { class: s.ready ? 'now' : '' },
          el('b', {}, '2. 비공개로 확인'),
          el(
            'small',
            {},
            '방문자 화면과 같은 렌더러로 방과 안내를 눌러 봅니다.',
          ),
        ),
        el(
          'li',
          { class: s.live ? 'done' : '' },
          el('b', {}, '3. 공개'),
          el(
            'small',
            {},
            '확인 화면의 ‘이 결과 공개’로 같은 파일을 공개합니다.',
          ),
        ),
      ),
      cancelled && !s.reviewing
        ? el(
            'p',
            { class: 'callout' },
            '결과를 준비한 뒤 초안이 바뀌어 준비한 결과가 취소되었습니다. 다시 준비하세요.',
          )
        : null,
      s.failed
        ? el(
            'p',
            { class: 'callout error' },
            '처리 실패 · ' + (s.job.error || s.job.status),
          )
        : null,
      go,
      el(
        'div',
        { class: 'pop-foot' },
        directButton,
        status?.previous
          ? el(
              'button',
              { type: 'button', class: 'link', onclick: () => run(restore) },
              '직전 공개본 복원',
            )
          : null,
        el('small', {}, '공개 버전 ' + (status?.published || '').slice(0, 8)),
      ),
    ]
    pop.replaceChildren(...parts.filter(Boolean))
  }

  return { element: wrap, refresh, render, close: () => toggle(false) }
}
