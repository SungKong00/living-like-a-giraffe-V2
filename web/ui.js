// App-level helpers shared by the visitor site and the studio: the API
// client, the page mount point and the 3D viewport host. Visual components
// live in ./ds; import them from './ds/index.js'.
import { el, IconButton, Spinner, Toolbar } from './ds/index.js'

export async function api(path, method = 'GET', data, signal) {
  const raw = data instanceof File
  const response = await fetch('/api/' + path, {
    method,
    signal,
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

export const app = document.querySelector('#app')
export const small = () =>
  matchMedia(
    '(max-width: 760px), (pointer: coarse) and (max-device-width: 960px)',
  ).matches

// The 3D viewport: a canvas, an overlay for scene pins, and a loading state.
// scene.js fills `overlay` and hides `loading`; views add their own controls
// to `host`.
export function stage() {
  const canvas = el('canvas', { 'aria-label': '리라지 3D 월드', tabindex: 0 })
  const overlay = el('div', { class: 'stage__markers' })
  const loading = el(
    'div',
    { class: 'stage__loading', role: 'status' },
    Spinner(),
    '공간을 여는 중…',
  )
  const host = el('section', { class: 'stage' }, canvas, overlay, loading)
  return { host, canvas, overlay, loading }
}

// Zoom in/out for any 3D viewport. Each call builds a fresh toolbar.
export function zoomControls(
  change,
  { className, orientation = 'vertical' } = {},
) {
  return Toolbar({
    label: '확대·축소',
    className: [className, 'zoom-controls--' + orientation]
      .filter(Boolean)
      .join(' '),
    children: [
      IconButton({ icon: 'add', label: '확대', onClick: () => change(1.4) }),
      IconButton({
        icon: 'minus',
        label: '축소',
        onClick: () => change(1 / 1.4),
      }),
    ],
  })
}
