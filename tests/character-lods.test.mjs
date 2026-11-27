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
