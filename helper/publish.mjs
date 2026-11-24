import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { blender } from '../server/blender.mjs'
import { renderEditor } from '../server/render-editor.mjs'
import { renderVisitor } from '../server/render-visitor.mjs'
import { studioOrigin, taskURL } from '../shared/helper-connection.mjs'

export async function publish(
  ticket,
  { local = false, claimWaiting = false, onStage = console.log } = {},
) {
  const localURL = local && new URL(ticket)
  const origin =
    localURL &&
    localURL.protocol === 'http:' &&
    localURL.hostname === '127.0.0.1'
      ? localURL.origin
      : studioOrigin
  const url = taskURL(ticket, origin)
  const headers = {
    'X-Publisher-Version': '2',
    ...(claimWaiting ? { 'X-Publisher-Claim': 'waiting' } : {}),
    Authorization: 'Bearer ' + url.hash.slice(1),
  }
  url.hash = ''
  async function request(action, method, body) {
    const response = await fetch(url.href + '/' + action, {
      method,
      body,
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(120000),
    })
    if (!response.ok)
      throw Error(
        (await response.json().catch(() => null))?.error ||
          '요청 실패 ' + response.status,
      )
    return response
  }
  const { attempt, snapshot, rooms, kind, publication } = await (
    await request('start', 'POST')
  ).json()
  headers['X-Publisher-Attempt'] = attempt
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'giraffe-publish-'))
  try {
    const source = path.join(work, 'source.blend')
    await fs.writeFile(
      source,
      new Uint8Array(await (await request('source', 'GET')).arrayBuffer()),
    )
    if (kind === 'inspect') {
      onStage('Blender 파일 확인 중')
      await blender('inspect', source, work)
      const bytes = await fs.readFile(path.join(work, 'catalog.json'))
      const catalog = JSON.parse(bytes)
      if (catalog.handoff !== publication)
        throw Error('현재 공개본에서 받은 .blend 파일을 수정해 올리세요.')
      const output = path.join(work, 'editor.glb')
      onStage('검토용 장면 만드는 중')
      await renderEditor(
        source,
        work,
        output,
        catalog.rooms.map((r) => r.id),
        (percent) => onStage('검토용 조명 굽기', percent),
      )
      const length = Buffer.alloc(4)
      length.writeUInt32BE(bytes.length)
      onStage('검토 결과 올리는 중')
      await request(
        'result',
        'PUT',
        Buffer.concat([length, bytes, await fs.readFile(output)]),
      )
      console.log(
        '검토 준비 완료. 스튜디오의 Blender 파일 창에서 수정본을 확인하세요.',
      )
    } else {
      const output = await renderVisitor(
        snapshot,
        source,
        rooms,
        work,
        (stage, percent) => {
          if (stage === '베이크')
            onStage(
              percent == null ? '조명 굽기 준비 중' : '조명 굽기',
              percent,
            )
          else onStage('모델 최적화 중')
        },
        undefined,
        true,
      )
      onStage('완성된 파일 올리는 중')
      await request(
        'blend',
        'PUT',
        await fs.readFile(path.join(work, 'world.blend')),
      )
      await request('result', 'PUT', await fs.readFile(output))
      console.log('완료했습니다. 스튜디오의 발행 창에서 결과를 확인하세요.')
    }
  } catch (error) {
    await request(
      'fail',
      'POST',
      JSON.stringify({ error: error.message }),
    ).catch(() => {})
    throw error
  } finally {
    await fs.rm(work, { recursive: true, force: true })
  }
}
