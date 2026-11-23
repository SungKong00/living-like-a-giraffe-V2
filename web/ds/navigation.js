import { el, cx } from './dom.js'
import { Icon } from './icon.js'
import { options, is, invariant } from './contract.js'

/**
 * Switches between sibling views inside one panel.
 * `appearance: 'pill'` for compact panels, 'underline' for page sections.
 */
export function Tabs(props) {
  const o = options('Tabs', props, {
    label: is.string().required,
    items: is.array().required,
    value: is.string().required,
    onChange: is.func().required,
    appearance: is.oneOf(['pill', 'underline'], 'pill'),
  })
  invariant(
    o.items.some((t) => t.id === o.value),
    'Tabs',
    'value가 items의 id 중 하나여야 합니다.',
  )
  const list = el(
    'div',
    {
      class: cx('ui-tabs', 'ui-tabs--' + o.appearance),
      role: 'tablist',
      'aria-label': o.label,
    },
    ...o.items.map((item) => {
      const t = options('Tabs.item', item, {
        id: is.string().required,
        label: is.string().required,
        count: is.number(),
      })
      const on = t.id === o.value
      return el(
        'button',
        {
          type: 'button',
          role: 'tab',
          class: 'ui-tabs__tab',
          'data-key': 'tab:' + t.id,
          'aria-selected': String(on),
          tabindex: on ? '0' : '-1',
          onclick: () => !on && o.onChange(t.id),
        },
        t.label,
        t.count == null
          ? null
          : el('span', { class: 'ui-tabs__count' }, String(t.count)),
      )
    }),
  )
  list.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    const at = o.items.findIndex((t) => t.id === o.value)
    const step = e.key === 'ArrowRight' ? 1 : -1
    o.onChange(o.items[(at + step + o.items.length) % o.items.length].id)
  })
  return list
}

/**
 * One row of a hierarchical list (scene outline). A row with `expanded`
 * set shows a disclosure chevron that calls `onToggle`.
 */
export function TreeItem(props) {
  const o = options('TreeItem', props, {
    label: is.string().required,
    key: is.string().required,
    icon: is.string(),
    depth: is.number(0),
    meta: is.string(),
    selected: is.boolean(),
    expanded: is.boolean(undefined),
    onSelect: is.func().required,
    onToggle: is.func(),
  })
  invariant(
    (o.expanded === undefined) === (o.onToggle === undefined),
    'TreeItem',
    'expanded와 onToggle은 함께 지정합니다.',
  )
  const row = el(
    'div',
    {
      class: cx('ui-tree-item', o.selected && 'ui-tree-item--selected'),
      style: '--depth:' + o.depth,
    },
    o.expanded === undefined
      ? el('span', { class: 'ui-tree-item__spacer', 'aria-hidden': 'true' })
      : el(
          'button',
          {
            type: 'button',
            class: 'ui-tree-item__toggle',
            'aria-label': (o.expanded ? '접기 ' : '펼치기 ') + o.label,
            'aria-expanded': String(o.expanded),
            onclick: o.onToggle,
          },
          Icon(o.expanded ? 'chevron-down' : 'chevron-right', 'xs'),
        ),
    el(
      'button',
      {
        type: 'button',
        class: 'ui-tree-item__main',
        'data-key': o.key,
        'aria-current': o.selected ? 'true' : null,
        onclick: o.onSelect,
      },
      o.icon ? Icon(o.icon, 'sm') : null,
      el('span', { class: 'ui-tree-item__label' }, o.label),
      o.meta ? el('span', { class: 'ui-tree-item__meta' }, o.meta) : null,
    ),
  )
  return row
}

/**
 * Marker floating over the 3D scene.
 * tone 'place' leads to a room, 'event' opens an event record.
 */
export function Pin(props) {
  const o = options('Pin', props, {
    label: is.string().required,
    tone: is.oneOf(['place', 'event']).required,
    selected: is.boolean(),
    onClick: is.func().required,
    onPointerDown: is.func(),
  })
  return el(
    'button',
    {
      type: 'button',
      class: cx(
        'ui-pin',
        'ui-pin--' + o.tone,
        o.selected && 'ui-pin--selected',
      ),
      onclick: o.onClick,
      onpointerdown: o.onPointerDown,
    },
    el('span', { class: 'ui-pin__dot', 'aria-hidden': 'true' }),
    el('span', { class: 'ui-pin__label' }, o.label),
  )
}

/** The product wordmark. */
export function Brand(props) {
  const o = options('Brand', props, {
    href: is.string('/'),
    product: is.string(),
  })
  return el(
    'a',
    { class: 'ui-brand', href: o.href, 'aria-label': '리라지 홈' },
    el('span', { class: 'ui-brand__mark', 'aria-hidden': 'true' }, '리'),
    el('span', { class: 'ui-brand__name' }, '리라지'),
    o.product ? el('span', { class: 'ui-brand__product' }, o.product) : null,
  )
}

/** Primary site navigation. Marks the current section with aria-current. */
export function NavLinks(props) {
  const o = options('NavLinks', props, {
    label: is.string().required,
    items: is.array().required,
  })
  return el(
    'nav',
    { class: 'ui-nav', 'aria-label': o.label },
    ...o.items.map((item) => {
      const i = options('NavLinks.item', item, {
        label: is.string().required,
        href: is.string().required,
        current: is.boolean(),
      })
      return el(
        'a',
        {
          class: 'ui-nav__link',
          href: i.href,
          'aria-current': i.current ? 'page' : null,
        },
        i.label,
      )
    }),
  )
}

/**
 * Where the current selection sits in its scope chain (월드 › 방 › 가구).
 * Every item but the last opens that wider scope; the last is the current one.
 */
export function Breadcrumbs(props) {
  const o = options('Breadcrumbs', props, {
    label: is.string().required,
    items: is.array().required,
  })
  invariant(o.items.length > 0, 'Breadcrumbs', 'items가 하나 이상 필요합니다.')
  return el(
    'nav',
    { class: 'ui-breadcrumbs', 'aria-label': o.label },
    el(
      'ol',
      { class: 'ui-breadcrumbs__list' },
      ...o.items.map((item, index) => {
        const i = options('Breadcrumbs.item', item, {
          label: is.string().required,
          icon: is.string(),
          key: is.string(),
          onSelect: is.func(),
        })
        const last = index === o.items.length - 1
        invariant(
          last || i.onSelect,
          'Breadcrumbs',
          '마지막이 아닌 항목에는 onSelect가 필요합니다.',
        )
        const content = [
          i.icon ? Icon(i.icon, 'xs') : null,
          el('span', { class: 'ui-breadcrumbs__label' }, i.label),
        ]
        return el(
          'li',
          { class: 'ui-breadcrumbs__item' },
          last
            ? el(
                'span',
                {
                  class: 'ui-breadcrumbs__current',
                  'aria-current': 'location',
                },
                ...content,
              )
            : el(
                'button',
                {
                  type: 'button',
                  class: 'ui-breadcrumbs__link',
                  'data-key': i.key,
                  onclick: i.onSelect,
                },
                ...content,
              ),
        )
      }),
    ),
  )
}
