import { el } from './ui.js'
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
