import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
// Use a separate store, including publication pointers and handoff baselines.
const dir = fs.mkdtempSync(path.resolve('.world/integration-'))
process.env.RIRAGI_DATA = dir
try {
  const { copyPreparedWorld } = await import('./prepared-world.mjs')
  copyPreparedWorld(dir)
  const { WorldStore } = await import('../server/store.mjs')
  const { catalog, buildDir } = await import('../server/world-files.mjs')
  const { Jobs } = await import('../server/jobs.mjs')
  const store = new WorldStore(),
    jobs = new Jobs(store)
  const initial = store.state.draft
  const layout = structuredClone(initial.layout)
  const twin = {
    ...layout.items[0],
    id: randomUUID(),
    label: '청록 벤치',
    color: '#226655',
    finish: 'matte',
    position: [3, 0, 4],
  }
  layout.items.push(twin)
  layout.spots.push({
    ...layout.spots[0],
    id: randomUUID(),
    anchor: twin.id,
    action: { type: 'page', page: 'sports-day' },
  })
  const saved = store.edit(initial.id, 'initial', layout)
  assert.throws(() => store.edit(initial.id, 'initial', layout))
  const downloads = Promise.all([jobs.download(saved), jobs.download(saved)])
  layout.items[1].color = '#884422'
  const web = store.edit(saved.id, 'initial', layout)
  const [blend, second] = await downloads
  assert.equal(blend, second)
  const inspect = path.join(dir, 'returned')
  fs.mkdirSync(inspect)
  const changed = path.join(inspect, 'producer.blend')
  execFileSync(
    '.venv/bin/python',
    [
      '-c',
      `
import sys,bpy
sys.path.insert(0,'world')
from worker import load,save
from model import inventory,tagged
from pathlib import Path
s=load(Path(sys.argv[1]))
assert len(bpy.data.scenes)==2
items=tagged(s,'itemId')
a=items[sys.argv[2]]
assert a['color']=='#226655' and a['finish']=='matte' and len(a.children)==2
assert all(part.material_slots[0].material['riragiBase'] for part in a.children)
a.location.x += 2
save(Path(sys.argv[3]))
missing=bpy.data.images.new("Missing texture",width=16,height=16)
missing.source='FILE'
missing.filepath='//missing-riragi-image.png'
missing.use_fake_user=True
save(Path(sys.argv[3]).with_name("missing.blend"))
`,
      blend,
      twin.id,
      changed,
    ],
    { stdio: 'pipe' },
  )
  await assert.rejects(
    jobs.upload(fs.readFileSync(path.join(inspect, 'missing.blend'))),
    /missing-riragi-image/,
  )
  const candidate = await jobs.upload(fs.readFileSync(changed))
  assert.equal(candidate.conflicts.length, 0)
  const result = candidate.items.find((i) => i.id === twin.id)
  assert.equal(result.position[0], 5)
  assert.equal(result.color, '#884422')
  assert.equal(catalog(candidate.model).rooms.length, 4)
  const merged = store.edit(web.id, candidate.model, {
    ...layout,
    items: candidate.items,
  })
  const requested = jobs.publish(merged.id)
  assert.equal(jobs.publish(merged.id), requested)
  assert.equal(store.state.published.id, initial.id)
  const deadline = Date.now() + 180000
  while (
    !['공개 완료', '실패'].includes(store.state.job.status) &&
    Date.now() < deadline
  )
    await new Promise((r) => setTimeout(r, 250))
  assert.equal(store.state.job.status, '공개 완료', store.state.job.error)
  assert.equal(store.state.published.id, merged.id)
  assert.ok(
    fs.statSync(path.join(buildDir(store.state.published.asset), 'world.glb'))
      .size > 10000,
  )
  const bytes = fs.readFileSync(
    path.join(buildDir(store.state.published.asset), 'world.glb'),
  )
  const gltf = JSON.parse(
    bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString(),
  )
  assert.ok(
    gltf.materials.some(
      (m) =>
        m.extras?.riragiFinish === 'matte' &&
        Math.abs(m.pbrMetallicRoughness.roughnessFactor - 0.88) < 0.001,
    ),
  )
  const updated = {
    ...merged.layout,
    pages: merged.layout.pages.map((p) => ({ ...p, title: p.title + '!' })),
  }
  const content = store.edit(merged.id, candidate.model, updated)
  const asset = store.state.published.asset
  jobs.publish(content.id)
  await new Promise((r) => setTimeout(r, 100))
  assert.equal(store.state.published.asset, asset)
  assert.equal(store.state.published.id, content.id)
  store.restore()
  assert.equal(store.state.published.id, merged.id)
  assert.deepEqual(store.state.published.layout, merged.layout)
  const publishedDownload = await jobs.download(store.state.published)
  assert.ok(fs.statSync(publishedDownload).size > 10000)
  assert.throws(() => jobs.compare(candidate.model))
  const late = store.begin(content.id),
    newest = store.begin(content.id)
  store.release(late, content, asset)
  assert.equal(store.state.published.id, merged.id)
  store.progress(newest, '실패', '테스트')
  assert.equal(store.state.published.id, merged.id)
  await assert.rejects(jobs.upload(Buffer.from('invalid blend')))
  console.log(
    '전체 파일 왕복, 독립 변경 병합, 실제 베이크, 콘텐츠 발행 재사용, 직전 개정 복원 통과',
  )
} finally {
  fs.rmSync(dir, { recursive: true, force: true })
}
