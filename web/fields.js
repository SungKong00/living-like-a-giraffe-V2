import { el, notify } from './ui.js'
export function field(name, node) {
  if (node.classList.contains('group')) {
    node.setAttribute('role', 'group')
    for (const input of node.children)
      input.ariaLabel = name + ' ' + input.ariaLabel
    return el('div', { class: 'vector-field' }, el('span', {}, name), node)
  }
  node.ariaLabel = name
  return el('label', {}, name, node)
}
export const safe = (fn) => async () => {
  try {
    await fn()
  } catch (e) {
    notify(e.message)
  }
}
export function input(value, change, type = 'text') {
  const n = el('input', { type, value })
  n.onchange = () => change(type === 'number' ? Number(n.value) : n.value)
  return n
}
export function select(list, value, change) {
  const n = el(
    'select',
    {},
    ...list.map(([id, title]) => el('option', { value: id }, title)),
  )
  n.value = value
  n.onchange = () => change(n.value)
  return n
}
export function vec(value, fn) {
  return el(
    'div',
    { class: 'group' },
    ...value.map((v, i) => {
      const n = input(
        Math.round(v * 100) / 100,
        (val) => {
          const next = value.slice()
          next[i] = val
          fn(next)
        },
        'number',
      )
      n.step = '.1'
      n.ariaLabel = ['X', 'Y', 'Z'][i]
      return n
    }),
  )
}
