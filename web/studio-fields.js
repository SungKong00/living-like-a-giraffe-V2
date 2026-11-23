import { el } from './ui.js'

// Small form builders for the inspector. Every control carries a stable
// data-key so a re-render can give focus back to the same field.

export function section(title, ...children) {
  return el(
    'section',
    { class: 'ins-section' },
    title ? el('h3', {}, title) : null,
    ...children,
  )
}

export function row(label, ...controls) {
  return el(
    'div',
    { class: 'ins-row' },
    el('span', { class: 'ins-label' }, label),
    el('div', { class: 'ins-controls' }, ...controls),
  )
}

export function text(
  key,
  value,
  commit,
  { label, multiline, type = 'text', check } = {},
) {
  const node = el(multiline ? 'textarea' : 'input', {
    'data-key': key,
    'aria-label': label,
    type: multiline ? null : type,
    spellcheck: multiline ? 'true' : 'false',
  })
  node.value = value
  const hint = el('small', { class: 'ins-error', hidden: '' })
  node.addEventListener('input', () => {
    const problem = check?.(node.value)
    hint.textContent = problem || ''
    hint.hidden = !problem
    node.toggleAttribute('aria-invalid', !!problem)
  })
  node.addEventListener('change', () => {
    const problem = check?.(node.value)
    if (problem) {
      hint.textContent = problem
      hint.hidden = false
      return
    }
    commit(type === 'text' && !multiline ? node.value.trim() : node.value)
  })
  if (!multiline)
    node.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') node.blur()
      if (e.key === 'Escape') {
        node.value = value
        node.dispatchEvent(new Event('input'))
        node.blur()
      }
    })
  return el('div', { class: 'ins-text' }, node, hint)
}

export function number(
  key,
  value,
  commit,
  { label, step = 0.25, min, max, unit } = {},
) {
  const node = el('input', {
    type: 'number',
    'data-key': key,
    'aria-label': label,
    step,
    min,
    max,
    inputmode: 'decimal',
  })
  node.value = String(value)
  node.addEventListener('change', () => {
    let v = Number(node.value)
    if (node.value === '' || !Number.isFinite(v)) {
      node.value = String(value)
      return
    }
    if (min != null) v = Math.max(min, v)
    if (max != null) v = Math.min(max, v)
    commit(v)
  })
  node.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') node.blur()
  })
  return el(
    'label',
    { class: 'num' },
    unit ? el('span', { 'aria-hidden': 'true' }, unit) : null,
    node,
  )
}

// A slider previews while dragging and records one edit when released.
export function slider(
  key,
  value,
  { min, max, step, label, format = String },
  preview,
  commit,
) {
  const range = el('input', {
    type: 'range',
    'data-key': key,
    'aria-label': label,
    min,
    max,
    step,
  })
  range.value = String(value)
  const out = el('output', {}, format(value))
  range.addEventListener('input', () => {
    out.textContent = format(Number(range.value))
    preview(Number(range.value))
  })
  range.addEventListener('change', () => commit(Number(range.value)))
  return el('div', { class: 'slider' }, range, out)
}

export function segmented(key, options, value, commit, label) {
  return el(
    'div',
    { class: 'segmented', role: 'radiogroup', 'aria-label': label },
    ...options.map(([id, name]) =>
      el(
        'button',
        {
          type: 'button',
          role: 'radio',
          'data-key': key + ':' + id,
          'aria-checked': String(id === value),
          class: id === value ? 'on' : null,
          onclick: () => id !== value && commit(id),
        },
        name,
      ),
    ),
  )
}

export function choice(key, options, value, commit, label) {
  const node = el(
    'select',
    { 'data-key': key, 'aria-label': label },
    ...options.map(([id, name, disabled]) =>
      el('option', { value: id, disabled: disabled ? '' : null }, name),
    ),
  )
  node.value = value
  node.addEventListener('change', () => commit(node.value))
  return node
}

export function action(label, fn, { cls, key, title, shortcut } = {}) {
  return el(
    'button',
    {
      type: 'button',
      class: cls,
      'data-key': key,
      title: title || (shortcut ? label + ' (' + shortcut + ')' : null),
      onclick: fn,
    },
    label,
    shortcut ? el('kbd', {}, shortcut) : null,
  )
}

// Re-render without losing the field the operator is typing in or tabbing to.
export function keepFocus(container, build) {
  const active = document.activeElement
  const key = container.contains(active) ? active.dataset.key : null
  let range = null
  try {
    if (key && active.selectionStart != null)
      range = [active.selectionStart, active.selectionEnd]
  } catch {
    /* Number and color inputs have no text selection. */
  }
  container.replaceChildren(...build().filter(Boolean))
  if (!key) return
  const next = container.querySelector('[data-key="' + CSS.escape(key) + '"]')
  if (!next) return
  next.focus({ preventScroll: true })
  try {
    if (range) next.setSelectionRange(...range)
    // Number fields expose no caret; select them like a native Tab does.
    else if (next.tagName === 'INPUT') next.select()
  } catch {
    /* Ignore inputs without selection support. */
  }
}
