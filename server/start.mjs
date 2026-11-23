import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { timingSafeEqual, createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { WorldStore, conflict } from './store.mjs'
import { buildDir, root, modelDir, catalog } from './world-files.mjs'
import { cachedLighting } from './baked-lighting.mjs'
import { Jobs } from './jobs.mjs'
import { StudioSessions, sessionLifetime } from './studio-sessions.mjs'
// A second server must never race the first writer's atomic state-file swaps.
if (!fs.existsSync(modelDir('initial')))
  throw Error('npm run prepare:world를 먼저 실행하세요.')
const { default: lockfile } = await import('proper-lockfile')
await lockfile.lock(root, { stale: 120000, update: 10000 })
const { ensureSourceCatalog } = await import('./model-catalog.mjs')
for (const model of fs.readdirSync(path.join(root, 'models')))
  if (fs.existsSync(path.join(modelDir(model), 'source.blend')))
    await ensureSourceCatalog(model)
const store = new WorldStore(),
  jobs = new Jobs(store)
if (
  !fs.existsSync(path.join(buildDir(store.state.published.asset), 'world.glb'))
)
  throw Error(
    '공개 모델을 찾을 수 없습니다. 월드 저장소와 prepare:world 결과를 확인하세요.',
  )
const app = express(),
  server = createServer(app)
const tokenPath = path.join(root, 'admin-key')
if (!process.env.RIRAGI_ADMIN_KEY && !fs.existsSync(tokenPath))
  fs.writeFileSync(tokenPath, randomBytes(24).toString('base64url'), {
    mode: 0o600,
    flag: 'wx',
  })
const key =
  process.env.RIRAGI_ADMIN_KEY || fs.readFileSync(tokenPath, 'utf8').trim()
const sessions = new StudioSessions(root, key)
const hash = (s) => createHash('sha256').update(s).digest()
app.disable('x-powered-by')
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store')
  if (
    req.method !== 'GET' &&
    req.headers.origin &&
    new URL(req.headers.origin).host !== req.headers.host
  )
    return res.sendStatus(403)
  next()
})
app.use(express.json({ limit: '2mb' }))
app.post('/api/login', (req, res) => {
  if (
    typeof req.body?.key !== 'string' ||
    !timingSafeEqual(hash(key), hash(req.body.key))
  )
    return res.sendStatus(403)
  res
    .cookie('riragi', sessions.issue(), {
      httpOnly: true,
      sameSite: 'strict',
      secure: req.secure,
      maxAge: sessionLifetime,
      path: '/api',
    })
    .json({ ok: true })
})
app.use('/api/admin', (req, res, next) => {
  const sid = /\briragi=([a-f0-9]{64})\b/.exec(req.headers.cookie || '')?.[1]
  if (!sessions.accepts(sid)) return res.sendStatus(401)
  next()
})
function editorView(snap) {
  const model = catalog(snap.model)
  return {
    id: snap.id,
    layout: snap.layout,
    rooms: model.rooms,
    render: 'editor',
    options: model.options,
    // Each kind the model can clone, named after its first catalog instance.
    kinds: [...new Map(model.items.map((i) => [i.kind, i.label]))].map(
      ([kind, label]) => ({ kind, label }),
    ),
    lights: model.lights,
    sourceLights: model.sourceLights,
    asset: '/api/admin/model/' + snap.model,
  }
}
function visitorView(snap, asset) {
  return {
    id: snap.id,
    layout: snap.layout,
    rooms: catalog(snap.model).rooms,
    render: 'visitor',
    asset,
  }
}
app.get('/api/world', (req, res) => {
  const snap = store.state.published
  res.json(visitorView(snap, '/api/world/' + snap.asset))
})
app.get('/api/world/:id', (req, res) => {
  // Only assets which have completed publication receive a public route.
  if (!/^(initial|[a-f0-9]{64})$/.test(req.params.id))
    return res.sendStatus(404)
  const { published, previous } = store.state
  if (![published.asset, previous?.asset].includes(req.params.id))
    return res.sendStatus(404)
  const file = path.join(buildDir(req.params.id), 'world.glb')
  if (!fs.existsSync(file)) return res.sendStatus(404)
  res
    .set('Cache-Control', 'public, max-age=31536000, immutable')
    .sendFile(file, { dotfiles: 'allow' })
})
app.get('/api/admin/draft', (req, res) =>
  res.json(editorView(store.state.draft)),
)
app.get('/api/admin/model/:id', async (req, res) => {
  if (!/^(initial|[a-f0-9-]{36})$/.test(req.params.id))
    return res.sendStatus(404)
  if (!fs.existsSync(path.join(modelDir(req.params.id), 'source.blend')))
    return res.sendStatus(404)
  res.sendFile(await jobs.studioAsset(req.params.id), {
    dotfiles: 'allow',
  })
})
app.put('/api/admin/draft', (req, res) =>
  res.json(
    editorView(
      store.edit(req.body.revision, store.state.draft.model, req.body.layout),
    ),
  ),
)
app.get('/api/admin/status', (req, res) => {
  const s = store.state
  res.json({ published: s.published.id, previous: !!s.previous, job: s.job })
})
app.post('/api/admin/publish', (req, res) =>
  res.status(202).json({ job: jobs.publish(req.body.revision) }),
)
// This endpoint can build a private asset, but cannot create or approve a publication.
app.post('/api/admin/lighting', async (req, res) => {
  const controller = new AbortController()
  res.once('close', () => controller.abort())
  const snapshot = await jobs.previewLighting(
    req.body.revision,
    controller.signal,
  )
  res.json(visitorView(snapshot, '/api/admin/lighting/' + snapshot.asset))
})
app.get('/api/admin/lighting/:asset', (req, res) => {
  if (!/^[a-f0-9]{64}$/.test(req.params.asset)) return res.sendStatus(404)
  if (cachedLighting(store.state.draft) !== req.params.asset)
    return res.sendStatus(404)
  const file = path.join(buildDir(req.params.asset), 'world.glb')
  if (!fs.existsSync(file)) return res.sendStatus(404)
  res.sendFile(file, { dotfiles: 'allow' })
})
app.post('/api/admin/reviews', (req, res) =>
  res.status(202).json({ job: jobs.prepareReview(req.body.revision) }),
)
app.get('/api/admin/reviews/:id', (req, res) => {
  const snapshot = store.reviewedSnapshot(req.params.id)
  res.json(
    visitorView(snapshot, '/api/admin/reviews/' + req.params.id + '/asset'),
  )
})
app.get('/api/admin/reviews/:id/asset', (req, res) => {
  const snapshot = store.reviewedSnapshot(req.params.id)
  res.sendFile(path.join(buildDir(snapshot.asset), 'world.glb'), {
    dotfiles: 'allow',
  })
})
app.post('/api/admin/reviews/:id/publish', (req, res) => {
  store.approveReview(req.params.id)
  res.json({ ok: true })
})
app.post('/api/admin/restore', (req, res) => {
  store.restore()
  res.json({ ok: true })
})
app.get('/api/admin/download/:which', async (req, res) => {
  if (!['draft', 'published'].includes(req.params.which))
    return res.sendStatus(404)
  const snap = store.state[req.params.which]
  res.download(
    await jobs.download(snap),
    'riragi-' + snap.id.slice(0, 8) + '.blend',
    { dotfiles: 'allow' },
  )
})
app.post(
  '/api/admin/upload',
  express.raw({ type: 'application/octet-stream', limit: '250mb' }),
  async (req, res) => {
    if (!Buffer.isBuffer(req.body)) return res.sendStatus(415)
    res.json(await jobs.upload(req.body))
  },
)
app.post('/api/admin/import', (req, res) => {
  const { model, revision, publication, choices, spots } = req.body
  const result = jobs.compare(model, choices)
  if (
    result.revision !== revision ||
    result.publication !== publication ||
    result.conflicts.length
  )
    throw conflict('최신 개정에서 충돌을 다시 확인하세요.')
  const layout = {
    ...store.state.draft.layout,
    items: result.items,
    lights: result.lights,
    sourceLights: result.sourceLights,
  }
  if (spots) layout.spots = spots
  res.json(editorView(store.edit(revision, model, layout)))
})
app.get('/api/admin/compare/:id', (req, res) =>
  res.json(jobs.compare(req.params.id)),
)
function showCandidate(req, res) {
  const result = jobs.compare(req.params.id, req.body?.choices)
  res.json(
    editorView({
      id: result.revision,
      model: result.model,
      layout: {
        ...store.state.draft.layout,
        items: result.items,
        lights: result.lights,
        sourceLights: result.sourceLights,
      },
    }),
  )
}
app.route('/api/admin/candidate/:id').get(showCandidate).post(showCandidate)

app.use('/api', (req, res) => res.sendStatus(404))
app.use((err, req, res, next) =>
  res.status(err.status || 400).json({ error: err.message }),
)
if (process.argv.includes('--production')) {
  app.use(express.static('dist'))
  app.get('/{*path}', (req, res) =>
    res.sendFile(path.resolve('dist/index.html')),
  )
} else {
  const { createServer: createVite } = await import('vite')
  const vite = await createVite({
    server: { middlewareMode: true, hmr: { server } },
    appType: 'spa',
  })
  app.use(vite.middlewares)
}
server.listen(Number(process.env.PORT || 4173), '127.0.0.1', () =>
  console.log('리라지 월드 http://127.0.0.1:' + server.address().port),
)
