import assert from 'node:assert/strict'
import test from 'node:test'
import { foldCastStage } from '../tavern-plugin/lib/domain/cast-stage-state.js'
import { createCastPresentation } from '../tavern-plugin/lib/domain/cast-presentation.js'
import { createPluginData } from '../tavern-plugin/lib/domain/plugin-data.js'
import { CAST_DATA_OWNER } from '../tavern-plugin/lib/domain/cast-annotation.js'
import { createPluginTurnReader } from '../tavern-plugin/lib/domain/plugin-turns.js'

const line = (speaker, emotion = 'neutral') => ({ speaker, emotion })

test('silence preserves figures and emotions without mutating the previous frame', () => {
  const first = foldCastStage([], [line('Nora', 'joy')])
  const quiet = foldCastStage(first, [{ kind: 'narration', text: 'Time passes.' }])
  assert.deepEqual(quiet, first)
  assert.notEqual(quiet, first)
  const next = foldCastStage(quiet, [line('Nora', 'sadness')])
  assert.deepEqual(next, [line('Nora', 'sadness')])
  assert.deepEqual(first, [line('Nora', 'joy')])
})

test('only three figures remain; player is excluded and aliases share a figure', () => {
  const options = { player: 'Reader', cast: [{ name: 'Nora', aliases: ['N'] }] }
  const figures = foldCastStage([], [line('Nora'), line('Lee'), line('N', 'joy'), line('Reader'), line('Sam'), line('Jo')], options)
  assert.deepEqual(figures, [line('Lee'), line('Sam'), line('Jo')])
  assert.deepEqual(foldCastStage([], [line('N'), line('Nora', 'joy')], options), [line('Nora', 'joy')])
})

async function harness() {
  const files = new Map(), keys = new Map([[2, 'a'], [3, 'b'], [4, 'c']]), reads = []
  const data = createPluginData({ store: {
    async readJson(path) { return structuredClone(files.get(path)) },
    async updateJson(path, change) { const result = change(structuredClone(files.get(path))); files.set(path, result); return result }
  } })
  let enabled = true
  const make = () => createCastPresentation({
    enabled: async () => enabled,
    data,
    turns: {
      resolveGame: async sessionId => sessionId === 'game' ? { sessionId, chatId: 'chat' } : null,
      currentKeys: async (_sessionId, turns) => { reads.push(turns); return new Map(turns.map(turn => [turn, keys.get(turn) || null])) }
    }
  })
  const save = (turn, key, lines) => data.saveTurn({ chatId: 'chat', owner: CAST_DATA_OWNER, turn, key, data: { version: 1, lines } })
  await save(2, 'a', [line('Nora', 'joy')])
  await save(3, 'b', [line('Lee', 'anger')])
  await save(3, 'old-b', [line('Stale')])
  await save(4, 'c', [line('Future')])
  return { make, data, keys, reads, setEnabled: value => { enabled = value } }
}

test('read seam rebuilds from current text versions across silent turns and fresh instances', async () => {
  const h = await harness()
  const before = await h.data.snapshot('chat')
  assert.deepEqual(await h.make().beforeTurn('game', 4), [line('Nora', 'joy'), line('Lee', 'anger')])
  assert.equal(h.reads.length, 1, 'one indexed read for the historical projection')
  assert.deepEqual(h.reads[0].sort(), [2, 3], 'each turn is requested once, not per revision')
  h.keys.delete(4)
  assert.deepEqual(await h.make().beforeTurn('game', 20), [line('Nora', 'joy'), line('Lee', 'anger')])
  assert.deepEqual(await h.data.snapshot('chat'), before, 'projection never writes another state')
})

test('historical text keys share one scene read and match the existing single-turn reader', async () => {
  let reads = 0
  const chat = { id: 'chat', mode: 'story', messages: [
    { role: 'assistant', turn: 2, text: 'First.' }, { role: 'assistant', turn: 3, text: 'Second.' }
  ] }
  const turns = createPluginTurnReader({ sceneState: async () => { reads++; return chat } })
  const keys = await turns.currentKeys('game', [2, 3, 4])
  assert.equal(reads, 1)
  assert.equal(keys.get(2), await turns.currentKey('game', 2))
  assert.equal(keys.get(3), await turns.currentKey('game', 3))
  assert.ok(keys.get(2))
  assert.notEqual(keys.get(2), keys.get(3))
  assert.equal(keys.get(4), null)
  const count = reads
  assert.deepEqual(await turns.currentKeys('game', []), new Map())
  assert.equal(reads, count)
})

test('rollback, regeneration, a different session and disabled annotation never retain stale figures', async () => {
  const h = await harness(), cast = h.make()
  assert.deepEqual(await cast.beforeTurn('game', 3), [line('Nora', 'joy')])
  h.keys.set(2, 'replacement')
  assert.deepEqual(await cast.beforeTurn('game', 3), [])
  assert.deepEqual(await cast.beforeTurn('other', 20), [])
  assert.deepEqual(await cast.beforeTurn('game', 1), [])
  h.setEnabled(false)
  assert.deepEqual(await cast.beforeTurn('game', 20), [])
})
