import { el, cx } from './dom.js'
import { Icon } from './icon.js'
import { options, is, invariant } from './contract.js'
import { Button } from './button.js'

// Tones are semantic, never decorative: pick by what the message means.
export const TONES = Object.freeze([
  'neutral',
  'accent',
  'success',
  'warning',
  'danger',
  'highlight',
])

/** Short status label, e.g. "검토 가능", "연결 2". */
export function Badge(props) {
  const o = options('Badge', props, {
    label: is.string().required,
    tone: is.oneOf(TONES, 'neutral'),
    dot: is.boolean(),
  })
  return el(
    'span',
    { class: cx('ui-badge', 'ui-badge--' + o.tone) },
    o.dot
      ? el('span', { class: 'ui-badge__dot', 'aria-hidden': 'true' })
      : null,
    o.label,
  )
}

/** A colored dot followed by text that says the same thing. */
export function StatusText(props) {
  const o = options('StatusText', props, {
    label: is.string().required,
    tone: is.oneOf(TONES, 'neutral'),
    pulse: is.boolean(),
  })
  return el(
    'span',
    {
      class: cx(
        'ui-status',
        'ui-status--' + o.tone,
        o.pulse && 'ui-status--pulse',
      ),
    },
    el('span', { class: 'ui-status__dot', 'aria-hidden': 'true' }),
    o.label,
  )
}

/** Inline message block inside a panel or dialog. */
export function Callout(props) {
  const o = options('Callout', props, {
    message: is.content().required,
    tone: is.oneOf(['neutral', 'warning', 'danger', 'success'], 'neutral'),
    title: is.string(),
    live: is.boolean(),
  })
  const icon = {
    neutral: 'info',
    warning: 'alert',
    danger: 'alert',
    success: 'check-circle',
  }[o.tone]
  return el(
    'div',
    {
      class: cx('ui-callout', 'ui-callout--' + o.tone),
      role: o.live ? (o.tone === 'danger' ? 'alert' : 'status') : null,
    },
    Icon(icon, 'sm'),
    el(
      'div',
      { class: 'ui-callout__body' },
      o.title ? el('strong', {}, o.title) : null,
      el('p', {}, o.message),
    ),
  )
}

/** A small filled circle previewing a CSS color value. */
export function ColorDot(color) {
  invariant(
    typeof color === 'string' && color,
    'ColorDot',
    '색 값 문자열이 필요합니다.',
  )
  return el('span', {
    class: 'ui-color-dot',
    style: '--swatch:' + color,
    'aria-hidden': 'true',
  })
}

/** Keyboard key. Pass the visible key text: "⌘D", "Esc". */
export function Kbd(key) {
  invariant(
    typeof key === 'string' && key,
    'Kbd',
    '키 이름 문자열이 필요합니다.',
  )
  return el('kbd', { class: 'ui-kbd' }, key)
}

export function Spinner(label = '불러오는 중') {
  return el(
    'span',
    { class: 'ui-spinner', role: 'img', 'aria-label': label },
    Icon('spinner', 'sm'),
  )
}

/** Placeholder for an empty list, a missing record or a first-run hint. */
export function EmptyState(props) {
  const o = options('EmptyState', props, {
    title: is.string().required,
    description: is.content(),
    icon: is.string(),
    actions: is.children(),
    children: is.children(),
    size: is.oneOf(['sm', 'lg'], 'sm'),
  })
  return el(
    'div',
    { class: cx('ui-empty', 'ui-empty--' + o.size) },
    o.icon ? el('span', { class: 'ui-empty__icon' }, Icon(o.icon, 'lg')) : null,
    el(
      o.size === 'lg' ? 'h1' : 'strong',
      { class: 'ui-empty__title' },
      o.title,
    ),
    o.description
      ? el('p', { class: 'ui-empty__description' }, o.description)
      : null,
    ...o.children,
    o.actions.length
      ? el('div', { class: 'ui-empty__actions' }, ...o.actions)
      : null,
  )
}

/**
 * Vertical step list for multi-stage flows (publish, Blender handoff).
 * state: 'done' | 'current' | 'upcoming'
 */
export function Steps(props) {
  const o = options('Steps', props, {
    label: is.string().required,
    steps: is.array().required,
  })
  return el(
    'ol',
    { class: 'ui-steps', 'aria-label': o.label },
    ...o.steps.map((step, n) => {
      const s = options('Steps.step', step, {
        title: is.string().required,
        description: is.content(),
        state: is.oneOf(['done', 'current', 'upcoming'], 'upcoming'),
        content: is.content(),
      })
      return el(
        'li',
        {
          class: 'ui-step ui-step--' + s.state,
          'aria-current': s.state === 'current' ? 'step' : null,
        },
        el(
          'span',
          { class: 'ui-step__marker', 'aria-hidden': 'true' },
          s.state === 'done' ? Icon('check', 'xs') : String(n + 1),
        ),
        el(
          'div',
          { class: 'ui-step__body' },
          el('strong', { class: 'ui-step__title' }, s.title),
          s.description
            ? el('p', { class: 'ui-step__description' }, s.description)
            : null,
          s.content,
        ),
      )
    }),
  )
}

// ---- Toasts ----
// Singleton: one polite live region for the whole page, created on first use.
// Views call toast(); they never build their own notification element.
let toaster = null
function Toaster() {
  const region = el('section', {
    class: 'ui-toaster',
    'aria-live': 'polite',
    'aria-label': '알림',
  })
  document.body.append(region)
  let timer = 0
  return {
    show(message, { action, tone = 'neutral', duration = 6000 } = {}) {
      const card = el(
        'div',
        {
          class: cx('ui-toast', 'ui-toast--' + tone),
          role: tone === 'danger' ? 'alert' : 'status',
        },
        tone === 'danger' ? Icon('alert', 'sm') : null,
        el('span', { class: 'ui-toast__message' }, message),
      )
      if (action)
        card.append(
          Button({
            label: action.label,
            variant: 'inverse',
            size: 'sm',
            onClick: () => {
              action.onClick()
              this.dismiss()
            },
          }),
        )
      region.replaceChildren(card)
      clearTimeout(timer)
      timer = setTimeout(() => this.dismiss(), duration)
    },
    dismiss() {
      clearTimeout(timer)
      const card = region.firstElementChild
      if (!card) return
      card.classList.add('ui-toast--leaving')
      setTimeout(() => card.isConnected && card.remove(), 160)
    },
  }
}

/**
 * Shows a short message near the bottom of the page.
 * @param {string} message
 * @param {{ action?: { label: string, onClick: () => void }, tone?: 'neutral'|'danger', duration?: number }} [opts]
 */
export function toast(message, opts = {}) {
  options('toast', opts, {
    action: is.any(),
    tone: is.oneOf(['neutral', 'danger']),
    duration: is.number(),
  })
  invariant(
    typeof message === 'string',
    'toast',
    '메시지는 문자열이어야 합니다.',
  )
  toaster ||= Toaster()
  toaster.show(message, opts)
}
