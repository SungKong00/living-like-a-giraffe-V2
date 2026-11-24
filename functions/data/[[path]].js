// Earlier Pages releases read this manifest and its versioned GLB from /data/.
import { onRequest as api } from '../api/[[path]].js'
export function onRequestGet(context) {
  const name = [].concat(context.params.path || []).join('/')
  if (name === 'world.json')
    return api({ ...context, params: { path: ['world'] } })
  const match = /^world-([0-9a-f]{64}|initial)\.glb$/.exec(name)
  if (match) return api({ ...context, params: { path: ['world', match[1]] } })
  return new Response(null, { status: 404 })
}
