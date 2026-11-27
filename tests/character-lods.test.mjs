import test from 'node:test'
import assert from 'node:assert/strict'
import { Document } from '@gltf-transform/core'
import { modelFacts } from '../shared/character-library.mjs'
import { characterSheet } from '../shared/character-sheet.mjs'

function model(nodes) {
  const doc = new Document()
  const scene = doc.createScene()
  const skin = doc.createSkin().addJoint(doc.createNode('Hips'))
  const other = doc.createSkin().addJoint(doc.createNode('Elsewhere'))
  for (const [name, options = {}] of nodes) {
    const node = doc.createNode(name).setExtras(options.extras ?? {})
    if (options.skin !== null)
      node.setSkin(options.skin === 'other' ? other : skin)
    scene.addChild(node)
  }
  return doc
}

test('모델의 축소 단계를 이름과 사용자 속성에서 읽는다', () => {
  const facts = modelFacts(
    model([
      ['Body'],
      ['Wear.Cape'],
      ['LOD1.Body'],
      ['LOD2.Body'],
      ['LOD1.Wear.Cape'],
      ['Body.far', { extras: { lod: 2, lodOf: 'Wear.Cape' } }],
    ]),
  )
  assert.deepEqual(facts.lods, [
    { level: 1, of: 'Body', node: 'LOD1.Body' },
    { level: 2, of: 'Body', node: 'LOD2.Body' },
    { level: 1, of: 'Wear.Cape', node: 'LOD1.Wear.Cape' },
    { level: 2, of: 'Wear.Cape', node: 'Body.far' },
  ])
  assert.deepEqual(facts.lodOrphans, [])
  // A reduced level of a wearable is not a wearable of its own.
  assert.deepEqual(
    facts.wearables.map((w) => w.nodes),
    [['Wear.Cape']],
  )
})

test('원본이 없거나 골격이 다른 축소 단계는 쓰지 않고 따로 알린다', () => {
  const facts = modelFacts(
    model([
      ['Body'],
      ['LOD1.Tail'],
      ['LOD1.Body', { skin: 'other' }],
      ['LOD3.Body'],
      ['LOD2.LOD1.Body'],
    ]),
  )
  assert.deepEqual(facts.lods, [])
  assert.deepEqual(facts.lodOrphans, [
    'LOD1.Tail',
    'LOD1.Body',
    'LOD2.LOD1.Body',
  ])
})

test('축소 단계가 없는 모델은 그대로 읽히고 공개 목록은 단계를 함께 싣는다', () => {
  assert.deepEqual(modelFacts(model([['Body']])).lods, [])
  const lods = [{ level: 1, of: 'Body', node: 'LOD1.Body' }]
  const layout = {
    characters: [
      { id: 'a', model: 'm' },
      { id: 'b', model: 'old' },
    ],
  }
  const sheet = characterSheet(layout, {
    fallback: 'm',
    motions: [],
    models: [
      { id: 'm', file: 'f1', wearables: [], lods },
      // An entry recorded before reduced levels existed.
      { id: 'old', file: 'f0', wearables: [] },
    ],
  })
  assert.deepEqual(sheet.models.m.lods, lods)
  assert.deepEqual(sheet.models.old.lods, [])
})

test('화면 크기 하나로 단계를 정하고 경계의 10% 안에서는 지금 단계를 유지한다', async () => {
  const { levelFor, screenPolicy } = await import('../web/characters/policy.js')
  // Phone overview, phone room and a close look, from the design's table.
  assert.equal(levelFor(6.4), 2)
  assert.equal(levelFor(26, 2), 1)
  assert.equal(levelFor(40, 1), 0)
  // Zooming out from the original: level 1 only below 27, level 2 below 7.2.
  assert.equal(levelFor(29, 0), 0)
  assert.equal(levelFor(26.9, 0), 1)
  assert.equal(levelFor(7.5, 1), 1)
  assert.equal(levelFor(7.1, 1), 2)
  // Zooming back in: finer only above 8.8 and above 33.
  assert.equal(levelFor(8.5, 2), 2)
  assert.equal(levelFor(8.9, 2), 1)
  assert.equal(levelFor(32, 1), 1)
  assert.equal(levelFor(33.1, 1), 0)
  // A jump across both boundaries lands on the right level at once.
  assert.equal(levelFor(100, 2), 0)
  assert.equal(levelFor(1, 0), 2)

  const world = { onScreen: () => true, pixelsPerMetre: () => 5 }
  assert.equal(screenPolicy(world, { lods: true }).level(0), 2)
  // The studio always draws the original.
  assert.equal(screenPolicy(world).level(0), 0)
})

test('부위마다 그 단계의 메시를, 없으면 더 자세한 단계나 원본을 그린다', async () => {
  const { levelNode } = await import('../web/characters/view.js')
  const both = new Map([
    [1, 'lod1'],
    [2, 'lod2'],
  ])
  assert.equal(levelNode('body', both, 0), 'body')
  assert.equal(levelNode('body', both, 1), 'lod1')
  assert.equal(levelNode('body', both, 2), 'lod2')
  assert.equal(levelNode('cape', new Map([[1, 'cape1']]), 2), 'cape1')
  assert.equal(levelNode('eye', new Map([[2, 'eye2']]), 1), 'eye')
  assert.equal(levelNode('flower', new Map(), 2), 'flower')
})
