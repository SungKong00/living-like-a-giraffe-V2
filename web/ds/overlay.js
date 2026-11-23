import { el, cx } from './dom.js'
import { options, is, invariant } from './contract.js'
import { IconButton } from './button.js'
import { Icon } from './icon.js'

// ---- Overlay mediator ----
// Popovers and menus never listen to the document themselves. They register
// with this mediator, which owns the single outside-click and Escape handlers
// and closes overlays from the top of the stack down. Views therefore cannot
// leak listeners or leave two popovers fighting over Escape.
const stack = []
let wired = false
function wire() {
  if (wired) return
  wired = true
  document.addEventListener(
    'pointerdown',
    (e) => {
      for (const overlay of [...stack])
        if (!overlay.contains(e.target)) overlay.close()
    },
    true,
  )
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || !stack.length) return
      e.preventDefault()
      e.stopImmediatePropagation()
      stack.at(-1).close({ restoreFocus: true })
    },
    true,
  )
}
export const overlays = Object.freeze({
  /** True when a popover or menu is open. */
  get active() {
    return stack.length > 0
  },
  closeAll() {
    for (const overlay of [...stack]) overlay.close()
  },
})

const PLACEMENTS = [
  'bottom-start',
  'bottom-end',
  'top-start',
  'top-end',
  'top',
  'bottom',
]

/**
 * Anchors a floating panel to a trigger button. Returns a frozen controller;
 * `content` may be a function so the panel is rebuilt each time it opens.
 */
export function Popover(props) {
  const o = options('Popover', props, {
    trigger: is.node().required,
    label: is.string().required,
    content: is.any().required,
    role: is.oneOf(['dialog', 'menu'], 'dialog'),
    placement: is.oneOf(PLACEMENTS, 'bottom-end'),
    width: is.oneOf(['auto', 'sm', 'md', 'lg'], 'auto'),
    onOpen: is.func(),
    onClose: is.func(),
    className: is.string(),
  })
  invariant(
    o.trigger.tagName === 'BUTTON',
    'Popover',
    'trigger는 Button 또는 IconButton이어야 합니다.',
  )
  const panel = el('div', {
    class: cx(
      'ui-popover',
      'ui-popover--' + o.placement,
      'ui-popover--' + o.width,
    ),
    role: o.role,
    'aria-label': o.label,
    hidden: true,
  })
  const wrap = el(
    'div',
    { class: cx('ui-popover-anchor', o.className) },
    o.trigger,
    panel,
  )
  o.trigger.setAttribute('aria-haspopup', o.role)
  o.trigger.setAttribute('aria-expanded', 'false')
  let isOpen = false
  const entry = {
    contains: (target) => wrap.contains(target),
    close: ({ restoreFocus } = {}) => controller.close({ restoreFocus }),
  }
  const fill = () => {
    if (typeof o.content === 'function')
      panel.replaceChildren(...[].concat(o.content(controller)).filter(Boolean))
    else if (!panel.firstChild) panel.append(o.content)
  }
  const controller = Object.freeze({
    element: wrap,
    panel,
    get isOpen() {
      return isOpen
    },
    open() {
      if (isOpen) return
      wire()
      isOpen = true
      fill()
      panel.hidden = false
      o.trigger.setAttribute('aria-expanded', 'true')
      stack.push(entry)
      o.onOpen?.()
      if (o.role === 'menu') panel.querySelector('[role="menuitem"]')?.focus()
    },
    close({ restoreFocus = false } = {}) {
      if (!isOpen) return
      isOpen = false
      panel.hidden = true
      o.trigger.setAttribute('aria-expanded', 'false')
      stack.splice(stack.indexOf(entry), 1)
      if (restoreFocus) o.trigger.focus()
      o.onClose?.()
    },
    toggle() {
      isOpen ? controller.close() : controller.open()
    },
    /** Rebuilds the panel content while it is open. */
    refresh() {
      if (isOpen) fill()
    },
  })
  o.trigger.addEventListener('click', () => controller.toggle())
  return controller
}

/** A popover listing actions. Arrow keys move between items. */
export function Menu(props) {
  const o = options('Menu', props, {
    trigger: is.node().required,
    label: is.string().required,
    heading: is.string(),
    items: is.any().required,
    empty: is.string('항목이 없습니다.'),
    placement: is.oneOf(PLACEMENTS, 'bottom-end'),
  })
  const build = (menu) => {
    const items = typeof o.items === 'function' ? o.items() : o.items
    const nodes = items.map((item) => {
      const i = options('Menu.item', item, {
        label: is.string().required,
        icon: is.string(),
        onSelect: is.func().required,
        danger: is.boolean(),
      })
      return el(
        'button',
        {
          type: 'button',
          role: 'menuitem',
          class: cx('ui-menu__item', i.danger && 'ui-menu__item--danger'),
          tabindex: '-1',
          onclick: () => {
            menu.close({ restoreFocus: true })
            i.onSelect()
          },
        },
        i.icon ? Icon(i.icon, 'sm') : null,
        el('span', {}, i.label),
      )
    })
    return [
      o.heading
        ? el(
            'div',
            { class: 'ui-menu__heading', role: 'presentation' },
            o.heading,
          )
        : null,
      ...nodes,
      nodes.length ? null : el('p', { class: 'ui-menu__empty' }, o.empty),
    ]
  }
  const menu = Popover({
    trigger: o.trigger,
    label: o.label,
    role: 'menu',
    placement: o.placement,
    width: 'sm',
    content: (m) => build(m),
  })
  menu.panel.addEventListener('keydown', (e) => {
    const items = [...menu.panel.querySelectorAll('[role="menuitem"]')]
    const at = items.indexOf(document.activeElement)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      items[(at + step + items.length) % items.length]?.focus()
    }
  })
  return menu
}

/**
 * Modal dialog built on <dialog>. The dialog removes itself when closed, so
 * build a new one each time it opens.
 */
export function Dialog(props) {
  const o = options('Dialog', props, {
    title: is.string().required,
    description: is.content(),
    size: is.oneOf(['sm', 'md', 'lg', 'xl'], 'md'),
    headerActions: is.children(),
    children: is.children(),
    footer: is.children(),
    onClose: is.func(),
    flush: is.boolean(),
  })
  const body = el(
    'div',
    { class: cx('ui-dialog__body', o.flush && 'ui-dialog__body--flush') },
    ...o.children,
  )
  const footer = el(
    'footer',
    { class: 'ui-dialog__footer', hidden: !o.footer.length },
    ...o.footer,
  )
  const dialog = el(
    'dialog',
    { class: cx('ui-dialog', 'ui-dialog--' + o.size), 'aria-label': o.title },
    el(
      'header',
      { class: 'ui-dialog__header' },
      el(
        'div',
        { class: 'ui-dialog__heading' },
        el('h2', { class: 'ui-dialog__title' }, o.title),
        o.description
          ? el('p', { class: 'ui-dialog__description' }, o.description)
          : null,
      ),
      el(
        'div',
        { class: 'ui-dialog__actions' },
        ...o.headerActions,
        IconButton({
          icon: 'close',
          label: '닫기',
          onClick: () => dialog.close(),
        }),
      ),
    ),
    body,
    footer,
  )
  dialog.addEventListener('close', () => {
    o.onClose?.()
    dialog.remove()
  })
  // A press that starts and ends on the backdrop closes the dialog.
  let downOnBackdrop = false
  dialog.addEventListener(
    'pointerdown',
    (e) => (downOnBackdrop = e.target === dialog),
  )
  dialog.addEventListener('click', (e) => {
    if (downOnBackdrop && e.target === dialog) dialog.close()
  })
  return Object.freeze({
    element: dialog,
    body,
    footer,
    get isOpen() {
      return dialog.open
    },
    open() {
      overlays.closeAll()
      document.body.append(dialog)
      dialog.showModal()
    },
    close() {
      dialog.close()
    },
    setFooter(...nodes) {
      footer.replaceChildren(...nodes.filter(Boolean))
      footer.hidden = !footer.childElementCount
    },
  })
}
