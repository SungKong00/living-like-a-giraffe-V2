import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation'
import { el } from './ds/index.js'

// The `?perf` readout of the visitor scene, for the character performance
// budget (openspec/changes/scale-character-performance): the 95th percentile
// of the time between drawn frames, and what the last frame drew. It only
// measures; it never makes the scene draw. The same numbers are on the
// element's data attributes for tests.

const WINDOW = 300

/**
 * `sources.characters()` returns `{ total, posed }` or nothing when the
 * world has no characters.
 */
export function perfReadout(host, world, sources = {}) {
  const { scene } = world
  const engine = scene.getEngine()
  const draws = new SceneInstrumentation(scene).drawCallsCounter
  const node = el('output', { class: 'perf-readout', 'aria-hidden': 'true' })
  host.append(node)

  // A sample is the time from one drawn frame to the next. The scene sleeps
  // between interactions, so a frame that follows an undrawn one is no sample.
  const samples = new Float32Array(WINDOW)
  let count = 0,
    drew = false,
    drewBefore = false,
    last = 0
  const begin = engine.onBeginFrameObservable.add(() => {
    const now = performance.now()
    if (drew && drewBefore) samples[count++ % WINDOW] = now - last
    drewBefore = drew
    drew = false
    last = now
  })
  const frame = { draws: 0, triangles: 0 }
  const after = scene.onAfterRenderObservable.add(() => {
    drew = true
    frame.draws = draws.current
    frame.triangles = Math.round(scene.getActiveIndices() / 3)
  })
  function p95() {
    const size = Math.min(count, WINDOW)
    if (!size) return null
    const sorted = Array.from(samples.subarray(0, size)).sort((a, b) => a - b)
    return sorted[Math.min(size - 1, Math.floor(size * 0.95))]
  }
  function show() {
    const time = p95()
    const cast = sources.characters?.()
    const rows = [
      '프레임 95% ' + (time === null ? '–' : time.toFixed(1) + 'ms'),
      '드로우 ' + frame.draws,
      '삼각형 ' + frame.triangles.toLocaleString('ko-KR'),
    ]
    if (cast) rows.push('캐릭터 ' + cast.posed + '/' + cast.total)
    node.textContent = rows.join('\n')
    Object.assign(node.dataset, {
      p95: time === null ? '' : time.toFixed(2),
      // Frames measured since the page opened; the percentile covers the
      // last WINDOW of them.
      samples: count,
      draws: frame.draws,
      triangles: frame.triangles,
      posed: cast?.posed ?? '',
      characters: cast?.total ?? '',
    })
  }
  show()
  const timer = setInterval(show, 500)
  scene.onDisposeObservable.addOnce(() => {
    clearInterval(timer)
    engine.onBeginFrameObservable.remove(begin)
    scene.onAfterRenderObservable.remove(after)
    node.remove()
  })
  return {
    /** Forgets the frames measured so far, before a new camera path. */
    reset() {
      count = 0
    },
  }
}
