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
  layout.lights = [
    {
      id: 'bench-lamp',
      label: '벤치 조명',
      room: twin.room,
      position: [0, 2.5, 0],
      color: '#ffdabc',
      energy: 550,
    },
    {
      id: 'accent',
      label: '작품 조명',
      room: twin.room,
      position: [2, 4, 1],
      color: '#ffffff',
      energy: 300,
      enabled: true,
      shape: {
        type: 'spot',
        rotation: [-0.5, 0, 0, 0.8660254],
        angle: 35,
        blend: 0.4,
      },
    },
    {
      id: 'panel',
      label: '창 조명',
      room: twin.room,
      position: [3, 5, 0],
      color: '#ddedff',
      energy: 750,
      enabled: false,
      shape: {
        type: 'area',
        rotation: [-0.5, 0, 0, 0.8660254],
        width: 3,
        height: 1.5,
      },
    },
  ]
  const softbox = catalog('initial').sourceLights.find(
    (l) => l.label === 'Large_softbox',
  )
  assert.equal(softbox.room, null)
  assert.equal(softbox.shape.form, 'disk')
  layout.sourceLights = [
    {
      id: softbox.id,
      energy: 18500,
      position: [22, 24, 11],
      color: '#ffd400',
      rotation: [0, 0, 0, 1],
    },
  ]
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
  layout.sourceLights[0].energy = 17200
  const removedLamp = catalog('initial').sourceLights.find(
    (l) => l.label === 'Club red wall wash.003',
  )
  layout.sourceLights.push({ id: removedLamp.id, energy: 50 })
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
native=s.objects['Large_softbox']
assert native.parent is None and native.data.shape=='DISK' and native.data.energy==18500
assert max(abs(a-b) for a,b in zip(native.matrix_world.translation,(22,-11,24)))<0.0001
bpy.data.objects.remove(s.objects['Club red wall wash.003'],do_unlink=True)
native.name = 'Studio softbox'
native.data.color=(0,1,0)
lamp=tagged(s,'webLightId')['bench-lamp']
assert lamp.data.energy==550
lamp.data.energy=600
spot=tagged(s,'webLightId')['accent']
area=tagged(s,'webLightId')['panel']
from math import degrees
assert spot.data.type=='SPOT' and abs(degrees(spot.data.spot_size)-35)<0.001 and abs(spot.data.spot_blend-0.4)<0.001
assert area.data.type=='AREA' and area.data.shape=='RECTANGLE' and area.hide_render and area.data.size_y==1.5
spot.data.spot_size*=2
area.data.size_y=2.5
area.hide_render=False
area.hide_viewport=False
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
  const comparison = await jobs.upload(fs.readFileSync(changed))
  const removedKey = 'source:' + removedLamp.id
  assert.equal(
    comparison.conflicts.find((c) => c.key === removedKey).removedSource,
    removedLamp.label,
  )
  const candidate = jobs.compare(comparison.model, { [removedKey]: 'file' })
  const studioPath = await jobs.studioAsset(candidate.model)
  const studioBytes = fs.readFileSync(studioPath)
  const studio = JSON.parse(
    studioBytes.subarray(20, 20 + studioBytes.readUInt32LE(12)),
  )
  const lighting = JSON.parse(
    studio.nodes.find((n) => n.extras?.studioLighting).extras.studioLighting,
  )
  assert.equal(Object.keys(lighting.field).length, 4)
  for (const field of Object.values(lighting.field)) {
    assert.equal(field.samples.length, field.size ** 2 * 6 * 3)
    assert.ok(field.samples.some((value) => value > 0))
  }
  assert.ok(
    lighting.areas.every(
      (light) => light.width > 0 && light.rotation.length === 4,
    ),
  )
  assert.equal(studio.materials.filter((m) => m.extras?.riragiBaked).length, 4)
  assert.ok(studio.nodes.some((n) => n.extras?.itemId === twin.id))
  assert.equal(candidate.conflicts.length, 0)
  assert.deepEqual(candidate.sourceLights, [{ id: softbox.id, energy: 17200 }])
  assert.equal(
    candidate.sourceCatalog.find((l) => l.id === softbox.id).color,
    '#00ff00',
  )
  assert.equal(
    candidate.sourceCatalog.find((l) => l.id === softbox.id).label,
    'Studio softbox',
  )
  assert.notDeepEqual(lighting.ambientField, lighting.field)
  assert.equal(
    studio.materials.filter(
      (m) =>
        m.extras?.studioReceiver &&
        m.emissiveTexture &&
        m.pbrMetallicRoughness.baseColorTexture,
    ).length,
    4,
  )
  const point = candidate.lights.find((l) => l.id === 'bench-lamp')
  assert.deepEqual(point, {
    ...layout.lights[0],
    energy: 600,
    enabled: true,
    shape: { type: 'point' },
  })
  const spot = candidate.lights.find((l) => l.id === 'accent'),
    area = candidate.lights.find((l) => l.id === 'panel')
  assert.equal(spot.shape.angle, 70)
  assert.equal(spot.shape.blend, 0.4)
  assert.ok(Math.abs(spot.shape.rotation[0] + 0.5) < 0.00002)
  assert.equal(area.shape.height, 2.5)
  assert.equal(area.enabled, true)
  const result = candidate.items.find((i) => i.id === twin.id)
  assert.equal(result.position[0], 5)
  assert.equal(result.color, '#884422')
  assert.equal(catalog(candidate.model).rooms.length, 4)
  const merged = store.edit(web.id, candidate.model, {
    ...layout,
    items: candidate.items,
    lights: candidate.lights,
    sourceLights: candidate.sourceLights,
  })
  const beforeLighting = store.state
  const preview = await jobs.previewLighting(merged.id)
  assert.deepEqual(store.state, beforeLighting)
  assert.notEqual(preview.asset, beforeLighting.published.asset)
  const file = path.join(buildDir(preview.asset), 'world.glb')
  const builtAt = fs.statSync(file).mtimeMs
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
    items: merged.layout.items
      .map((i) => ({ ...i, label: i.label + '!' }))
      .reverse(),
    pages: merged.layout.pages.map((p) => ({ ...p, title: p.title + '!' })),
  }
  const content = store.edit(merged.id, candidate.model, updated)
  const asset = store.state.published.asset
  assert.equal((await jobs.previewLighting(content.id)).asset, preview.asset)
  assert.equal(fs.statSync(file).mtimeMs, builtAt)
  await assert.rejects(jobs.previewLighting(merged.id), /최신 초안/)
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
  const late = store.beginReview(content.id)
  assert.throws(() => store.approveReview(late.id))
  const next = store.edit(content.id, candidate.model, content.layout)
  late.complete()
  assert.throws(() => store.approveReview(late.id))
  const ready = store.beginReview(next.id)
  ready.complete()
  assert.equal(new WorldStore().reviewedSnapshot(ready.id).asset, asset)
  assert.throws(() => store.approveReview(late.id))
  const newer = store.edit(next.id, candidate.model, next.layout)
  assert.throws(() => store.approveReview(ready.id))
  const failed = store.beginReview(newer.id)
  failed.fail(Error('테스트'))
  failed.complete()
  assert.throws(() => store.approveReview(failed.id))
  assert.equal(store.state.published.id, merged.id)
  const retry = store.beginReview(newer.id)
  retry.complete()
  store.restore()
  assert.throws(() => store.approveReview(retry.id))
  await assert.rejects(jobs.upload(Buffer.from('invalid blend')))
  console.log(
    '전체 파일 왕복, 독립 변경 병합, 실제 베이크, 콘텐츠 발행 재사용, 직전 개정 복원 통과',
  )
} finally {
  fs.rmSync(dir, { recursive: true, force: true })
}
