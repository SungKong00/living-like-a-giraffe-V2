export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value)
    else if (key === 'class') node.className = value
    else if (key === 'text') node.textContent = value
    else node.setAttribute(key, value)
  }
  node.append(...children.filter((c) => c != null))
  return node
}
export const button = (label, fn, cls) =>
  el('button', { type: 'button', class: cls, onclick: fn }, label)
export async function api(path, method = 'GET', data) {
  const raw = data instanceof File
  const response = await fetch('/api/' + path, {
    method,
    headers: data
      ? {
          'Content-Type': raw ? 'application/octet-stream' : 'application/json',
        }
      : {},
    body: raw ? data : data ? JSON.stringify(data) : undefined,
  })
  if (!response.ok) {
    const reason = await response.json().catch(() => null)
    throw Object.assign(
      Error(
        reason?.error || '요청을 완료할 수 없습니다 (' + response.status + ')',
      ),
      { status: response.status },
    )
  }
  return response.json()
}
let timer
export function notify(message) {
  const n = document.querySelector('#notice')
  n.textContent = message
  n.hidden = false
  clearTimeout(timer)
  timer = setTimeout(() => (n.hidden = true), 5500)
}
export const app = document.querySelector('#app')
export const small = () =>
  matchMedia(
    '(max-width: 760px), (pointer: coarse) and (max-device-width: 960px)',
  ).matches
export function stage() {
  const canvas = el('canvas', { 'aria-label': '리라지 3D 월드', tabindex: 0 })
  const overlay = el('div', { class: 'markers' })
  const loading = el('div', { class: 'loading' }, '공간을 여는 중…')
  const host = el('section', { class: 'stage' }, canvas, overlay, loading)
  return { host, canvas, overlay, loading }
}

export function zoomButtons(change) {
  return [
    ['＋', '확대', 1.4],
    ['−', '축소', 1 / 1.4],
  ].map(([label, name, factor]) =>
    el(
      'button',
      {
        type: 'button',
        'aria-label': name,
        title: name,
        onclick: () => change(factor),
      },
      label,
    ),
  )
}
