// The low-level element factory the components are built on. Views may use it
// for semantic structure (sections, headings, lists); anything interactive or
// visually styled comes from a component instead.
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value)
    else if (key === 'class') node.className = value
    else if (key === 'text') node.textContent = value
    else node.setAttribute(key, value === true ? '' : value)
  }
  node.append(...children.flat().filter((c) => c != null && c !== false))
  return node
}

// Joins class names, skipping empty ones: cx('a', on && 'b').
export const cx = (...names) => names.filter(Boolean).join(' ')

// Re-render a container without losing the field the user is typing in or
// tabbing to. Controls opt in by carrying a stable `data-key`.
export function renderKeepingFocus(container, build) {
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
