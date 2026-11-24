import { Button, ButtonGroup, Disclosure, el, StatusText } from './ds/index.js'
import { bridgeOrigin } from '../shared/helper-connection.mjs'

const pairing = 'giraffe.studio.helper'
const fragment = /^#helper=([0-9a-f]{64})$/.exec(location.hash)
if (fragment && location.pathname.replace(/\/$/, '') === '/studio') {
  localStorage.setItem(pairing, fragment[1])
  history.replaceState(history.state, '', location.pathname + location.search)
}

const bytes = (hex) => Uint8Array.from(hex.match(/../g), (v) => parseInt(v, 16))
const hex = (value) =>
  [...new Uint8Array(value)]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')
const owner = (kind) => 'giraffe.studio.task.' + kind

export function rememberTask(kind, id) {
  if (id) localStorage.setItem(owner(kind), id)
}

export function pendingTask(kind) {
  return localStorage.getItem(pairing) && localStorage.getItem(owner(kind))
}

export function forgetTask(kind, id) {
  if (localStorage.getItem(owner(kind)) === id)
    localStorage.removeItem(owner(kind))
}

async function post(route, value) {
  const response = await fetch(bridgeOrigin + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store',
    body: JSON.stringify(value),
    signal: AbortSignal.timeout(4500),
  })
  if (!response.ok) throw Error('도우미 연결을 확인하세요.')
  return response.json()
}

// Both panels and background refresh use the same authenticated desktop bridge.
// Browser storage records only jobs the editor initiated here, never a task token.
export function helperControls(kind, onError) {
  let connected = false,
    detail,
    checking = null,
    showOptions = false
  async function check(ticket, waiting = false, retry = false) {
    if (checking) await checking
    const operation = async () => {
      const secret = localStorage.getItem(pairing)
      connected = false
      detail = null
      if (!secret) return
      const id = ticket && new URL(ticket).pathname.split('/').pop()
      const challenge = crypto.randomUUID()
      const key = bytes(secret)
      const status = await post('/status', { challenge, job: id })
      const hmac = await crypto.subtle.importKey(
        'raw',
        key,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      )
      if (
        hex(
          await crypto.subtle.sign(
            'HMAC',
            hmac,
            new TextEncoder().encode(challenge),
          ),
        ) !== status.proof
      )
        throw Error('설치된 도우미를 다시 열어 연결하세요.')
      connected = true
      detail = status
      if (
        !id ||
        id !== localStorage.getItem(owner(kind)) ||
        (!retry && (status.stage || !waiting))
      )
        return
      const aes = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, [
        'encrypt',
      ])
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const cipher = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        aes,
        new TextEncoder().encode(ticket),
      )
      const sealed = btoa(String.fromCharCode(...iv, ...new Uint8Array(cipher)))
      detail = { ...status, ...(await post('/run', { sealed, retry })) }
      forgetTask(kind, id)
    }
    checking = operation()
      .catch(() => {
        connected = false
      })
      .finally(() => {
        checking = null
      })
    await checking
  }
  function panel(ticket, refresh) {
    const installed = !!localStorage.getItem(pairing)
    const id = ticket && new URL(ticket).pathname.split('/').pop()
    const needsUpdate = connected && !detail?.bakeProgress
    const setup = !connected || needsUpdate
    const windows = /Windows/i.test(navigator.userAgent)
    const downloads = [
      {
        label: 'Mac용 다운로드 · Apple Silicon',
        href: '/downloads/giraffe-publisher-mac.zip',
      },
      {
        label: 'Windows용 다운로드 · x64',
        href: '/downloads/giraffe-publisher-windows.exe',
      },
    ]
    const reopen = () =>
      Button({ label: '설치한 도우미 열기', href: 'giraffe-studio://open' })
    return el(
      'div',
      { class: 'publish-panel' },
      StatusText({
        label: connected
          ? Number.isInteger(detail?.bakePercent)
            ? detail.stage + ' · ' + detail.bakePercent + '%'
            : detail?.stage || '이 컴퓨터의 도우미 연결됨'
          : installed
            ? '도우미 연결 대기 중'
            : '도우미 연결',
        tone: connected ? 'success' : 'neutral',
      }),
      detail?.error && el('small', { role: 'alert' }, detail.error),
      connected &&
        ticket &&
        (detail?.error || !detail?.stage) &&
        Button({
          label: detail?.error
            ? '이 작업 다시 시도'
            : '이 컴퓨터에서 이어서 처리',
          onClick: async () => {
            rememberTask(kind, id)
            await check(ticket, false, true)
            await refresh().catch((e) => onError(e.message))
          },
        }),
      !connected &&
        el(
          'small',
          {},
          installed
            ? '도우미를 열고, 브라우저가 이 컴퓨터에 연결할 권한을 요청하면 허용하세요.'
            : windows
              ? '이미 설치했다면 도우미를 여세요. 처음이라면 Windows용 실행 파일을 받아 여세요.'
              : '이미 설치했다면 도우미를 여세요. 처음이라면 Mac용 ZIP을 풀고 Giraffe Studio를 여세요.',
        ),
      needsUpdate &&
        el(
          'small',
          {},
          '굽기 진행률을 보려면 최신 도우미를 설치하세요. 이전 도우미가 실행 중이면 설치 후 컴퓨터에 다시 로그인하세요.',
        ),
      setup &&
        ButtonGroup({
          label: '도우미 설치와 실행',
          children: [
            Button({ ...downloads[Number(windows)], variant: 'primary' }),
            reopen(),
          ],
        }),
      !connected &&
        installed &&
        Button({
          label: '연결 확인',
          onClick: async () => {
            await check(ticket)
            await refresh().catch((e) => onError(e.message))
          },
        }),
      setup &&
        Disclosure({
          summary: '다른 운영체제용 다운로드',
          open: showOptions,
          onToggle: (open) => {
            showOptions = open
          },
          children: [Button(downloads[Number(!windows)])],
        }),
    )
  }
  return {
    check,
    panel,
    get bakePercent() {
      return connected ? detail?.bakePercent : undefined
    },
  }
}
