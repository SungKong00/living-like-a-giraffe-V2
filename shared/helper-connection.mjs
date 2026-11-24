export const studioOrigin = 'https://living-like-a-giraffe.pages.dev'
export const bridgePort = 49731
export const bridgeOrigin = 'http://127.0.0.1:' + bridgePort

export function taskURL(ticket, origin = studioOrigin) {
  if (typeof ticket !== 'string' || !URL.canParse(ticket))
    throw Error('스튜디오에서 작업을 다시 시작하세요.')
  const url = new URL(ticket)
  if (
    url.origin !== origin ||
    url.username ||
    url.password ||
    url.search ||
    !/^\/api\/helper\/[a-f0-9-]{36}$/.test(url.pathname) ||
    !/^#[a-f0-9]{64}$/.test(url.hash)
  )
    throw Error('이 스튜디오에서 요청한 작업만 처리할 수 있습니다.')
  return url
}
