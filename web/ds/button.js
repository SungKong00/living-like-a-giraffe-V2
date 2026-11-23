import { el, cx } from './dom.js'
import { Icon } from './icon.js'
import { options, is, invariant, viewClass } from './contract.js'

// Button variants by role:
//   primary   — the one main action of a view or panel (발행, 스튜디오 열기)
//   secondary — supporting actions next to a primary (미리보기, 내려받기)
//   ghost     — quiet actions inside toolbars, lists and panels
//   danger    — destructive actions (삭제)
//   inverse   — actions on a dark surface (floating selection toolbar, toast)
//   link      — inline text action inside copy or footers
export const BUTTON_VARIANTS = Object.freeze([
  'primary',
  'secondary',
  'ghost',
  'danger',
  'inverse',
  'link',
])
export const BUTTON_SIZES = Object.freeze(['sm', 'md', 'lg'])

const shared = {
  variant: is.oneOf(BUTTON_VARIANTS, 'secondary'),
  size: is.oneOf(BUTTON_SIZES, 'md'),
  onClick: is.func(),
  disabled: is.boolean(),
  // aria-pressed for toggles. Leave undefined for ordinary buttons.
  pressed: is.boolean(undefined),
  shortcut: is.string(),
  key: is.string(),
  className: is.string(),
  // Extra aria-* attributes without the prefix: { expanded: 'false' }.
  aria: is.any(() => ({})),
  type: is.oneOf(['button', 'submit'], 'button'),
}

function applyAria(node, aria) {
  for (const [k, v] of Object.entries(aria)) node.setAttribute('aria-' + k, v)
}

/**
 * A labelled button or link.
 * @param {object} props
 * @param {string} props.label visible text, also the accessible name
 * @param {string} [props.icon] leading icon name from the registry
 * @param {string} [props.iconEnd] trailing icon name
 * @param {string} [props.href] renders a link styled as a button
 */
export function Button(props) {
  const o = options('Button', props, {
    ...shared,
    label: is.string().required,
    icon: is.string(),
    iconEnd: is.string(),
    href: is.string(),
    external: is.boolean(),
    wide: is.boolean(),
    badge: is.node(),
  })
  invariant(
    !(o.href && o.onClick),
    'Button',
    'href와 onClick은 함께 쓸 수 없습니다.',
  )
  invariant(!(o.href && o.disabled), 'Button', '링크는 비활성화할 수 없습니다.')
  const tag = o.href ? 'a' : 'button'
  const node = el(
    tag,
    {
      class: cx(
        'ui-button',
        'ui-button--' + o.variant,
        'ui-button--' + o.size,
        o.wide && 'ui-button--wide',
        viewClass('Button', o.className),
      ),
      type: o.href ? null : o.type,
      href: o.href,
      target: o.external ? '_blank' : null,
      rel: o.external ? 'noopener noreferrer' : null,
      'data-key': o.key,
      'aria-pressed': o.pressed == null ? null : String(o.pressed),
      title: o.shortcut ? o.label + ' (' + o.shortcut + ')' : null,
      onclick: o.onClick,
    },
    o.icon ? Icon(o.icon, o.size === 'lg' ? 'md' : 'sm') : null,
    el('span', { class: 'ui-button__label' }, o.label),
    o.badge,
    o.shortcut
      ? el('kbd', { class: 'ui-kbd', 'aria-hidden': 'true' }, o.shortcut)
      : null,
    o.iconEnd ? Icon(o.iconEnd, 'sm') : null,
  )
  if (o.disabled) node.disabled = true
  applyAria(node, o.aria)
  return node
}

/**
 * A square button showing only an icon. The label is required: it becomes
 * the accessible name and the hover tooltip.
 */
export function IconButton(props) {
  const o = options('IconButton', props, {
    ...shared,
    variant: is.oneOf(
      ['ghost', 'secondary', 'primary', 'inverse', 'danger'],
      'ghost',
    ),
    icon: is.string().required,
    label: is.string().required,
    tooltip: is.boolean(true),
  })
  invariant(
    o.label.trim(),
    'IconButton',
    '아이콘만 있는 버튼에는 label이 필요합니다.',
  )
  const node = el(
    'button',
    {
      type: o.type,
      class: cx(
        'ui-icon-button',
        'ui-button--' + o.variant,
        'ui-icon-button--' + o.size,
        viewClass('IconButton', o.className),
      ),
      'aria-label': o.label,
      title: o.tooltip
        ? o.label + (o.shortcut ? ' (' + o.shortcut + ')' : '')
        : null,
      'data-key': o.key,
      'aria-pressed': o.pressed == null ? null : String(o.pressed),
      onclick: o.onClick,
    },
    Icon(o.icon, o.size === 'lg' ? 'lg' : o.size === 'sm' ? 'sm' : 'md'),
  )
  if (o.disabled) node.disabled = true
  applyAria(node, o.aria)
  return node
}

/** Groups related buttons. `attached` joins them into one segmented shape. */
export function ButtonGroup(props) {
  const o = options('ButtonGroup', props, {
    label: is.string().required,
    children: is.children().required,
    attached: is.boolean(),
    className: is.string(),
  })
  return el(
    'div',
    {
      role: 'group',
      'aria-label': o.label,
      class: cx(
        'ui-button-group',
        o.attached && 'ui-button-group--attached',
        viewClass('ButtonGroup', o.className),
      ),
    },
    ...o.children,
  )
}
