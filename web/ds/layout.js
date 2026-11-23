import { el, cx } from './dom.js'
import { Icon } from './icon.js'
import { options, is, invariant, viewClass } from './contract.js'
import { IconButton } from './button.js'

// Building blocks for property panels and toolbars. A panel reads top to
// bottom as PanelHeader → PanelSection* and every labelled control sits in a
// PropertyRow, so all inspectors share one rhythm.

/** Title area of a side panel: what is selected and what can be done to it. */
export function PanelHeader(props) {
  const o = options('PanelHeader', props, {
    eyebrow: is.string().required,
    icon: is.string(),
    title: is.content().required,
    actions: is.children(),
    description: is.content(),
  })
  return el(
    'header',
    { class: 'ui-panel-header' },
    el(
      'div',
      { class: 'ui-panel-header__top' },
      el(
        'span',
        { class: 'ui-panel-header__eyebrow' },
        o.icon ? Icon(o.icon, 'xs') : null,
        o.eyebrow,
      ),
      o.actions.length
        ? el('div', { class: 'ui-panel-header__actions' }, ...o.actions)
        : null,
    ),
    typeof o.title === 'string'
      ? el('h2', { class: 'ui-panel-header__title' }, o.title)
      : o.title,
    o.description
      ? el('p', { class: 'ui-panel-header__description' }, o.description)
      : null,
  )
}

/** A titled group of rows inside a panel. */
export function PanelSection(props) {
  const o = options('PanelSection', props, {
    title: is.string().required,
    meta: is.string(),
    children: is.children().required,
  })
  return el(
    'section',
    { class: 'ui-panel-section' },
    el(
      'h3',
      { class: 'ui-panel-section__title' },
      o.title,
      o.meta ? el('span', { class: 'ui-panel-section__meta' }, o.meta) : null,
    ),
    el('div', { class: 'ui-panel-section__body' }, ...o.children),
  )
}

/**
 * Label on the left, one or more controls on the right.
 *
 * Values can be inherited from a wider scope (a Blender original, the model's
 * own material, later the world defaults). When this row's value replaces the
 * inherited one, pass `override: { from, onReset }`: the row is marked and
 * offers a reset to the inherited value. Pass nothing (or a falsy value) while
 * the row still follows its source, so every editor shows overrides the same
 * way.
 */
export function PropertyRow(props) {
  const o = options('PropertyRow', props, {
    label: is.string(''),
    children: is.children().required,
    stack: is.boolean(),
    override: is.any(),
  })
  const override = o.override
    ? options('PropertyRow.override', o.override, {
        from: is.string().required,
        onReset: is.func().required,
        subject: is.string(),
      })
    : null
  invariant(
    !override || o.label || override.subject,
    'PropertyRow',
    '덮어쓴 행에는 label 또는 override.subject가 필요합니다.',
  )
  const subject = override?.subject || o.label
  return el(
    'div',
    {
      class: cx(
        'ui-property',
        o.stack && 'ui-property--stack',
        override && 'ui-property--overridden',
      ),
    },
    el(
      'span',
      {
        class: 'ui-property__label',
        title: override ? override.from + ' 값을 덮어썼습니다' : null,
      },
      o.label,
    ),
    el(
      'div',
      { class: 'ui-property__controls' },
      ...o.children,
      override
        ? el(
            'span',
            { class: 'ui-property__reset' },
            IconButton({
              icon: 'reset',
              label: subject + ' ' + override.from + ' 값으로 되돌리기',
              size: 'sm',
              onClick: override.onReset,
            }),
          )
        : null,
    ),
  )
}

/** Collapsible extra settings. `onToggle` receives the next open state. */
export function Disclosure(props) {
  const o = options('Disclosure', props, {
    summary: is.string().required,
    open: is.boolean(),
    onToggle: is.func(),
    children: is.children().required,
  })
  const details = el(
    'details',
    { class: 'ui-disclosure', open: o.open },
    el(
      'summary',
      {
        class: 'ui-disclosure__summary',
        // Record the choice on click: a pending re-render may replace this
        // element before its toggle event fires.
        onclick: () => o.onToggle?.(!details.open),
      },
      Icon('chevron-right', 'xs'),
      o.summary,
    ),
    el('div', { class: 'ui-disclosure__body' }, ...o.children),
  )
  return details
}

/**
 * A row of controls. `floating` sits over the 3D canvas, `inverse` is the
 * dark selection toolbar, `bar` is the application top bar.
 */
export function Toolbar(props) {
  const o = options('Toolbar', props, {
    label: is.string().required,
    children: is.children().required,
    appearance: is.oneOf(['floating', 'inverse', 'bar'], 'floating'),
    className: is.string(),
    hidden: is.boolean(),
  })
  return el(
    'div',
    {
      role: 'toolbar',
      'aria-label': o.label,
      class: cx(
        'ui-toolbar',
        'ui-toolbar--' + o.appearance,
        viewClass('Toolbar', o.className),
      ),
      hidden: o.hidden,
    },
    ...o.children,
  )
}

export const ToolbarDivider = () =>
  el('span', {
    class: 'ui-toolbar__divider',
    role: 'separator',
    'aria-orientation': 'vertical',
  })

/** Compact clickable token that jumps to a related object. */
export function Chip(props) {
  const o = options('Chip', props, {
    label: is.string().required,
    icon: is.string(),
    key: is.string(),
    onClick: is.func().required,
  })
  return el(
    'button',
    { type: 'button', class: 'ui-chip', 'data-key': o.key, onclick: o.onClick },
    o.icon ? Icon(o.icon, 'xs') : null,
    el('span', {}, o.label),
  )
}

export function ChipList(children) {
  return el('div', { class: 'ui-chip-list' }, ...children)
}

export function GlassHeading(props) {
  const o = options('GlassHeading', props, {
    text: is.string().required,
    className: is.string(),
  })
  return el(
    'h1',
    { class: cx('ui-glass-heading', viewClass('GlassHeading', o.className)) },
    o.text,
  )
}

export function ObjectPreview(props) {
  const o = options('ObjectPreview', props, { label: is.string().required })
  return el('canvas', {
    class: 'ui-object-preview',
    role: 'img',
    'aria-label': o.label,
    width: 480,
    height: 248,
    hidden: true,
  })
}
