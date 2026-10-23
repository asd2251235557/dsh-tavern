import assert from 'node:assert/strict'
import test from 'node:test'
import { stageDirectorFixture } from './helpers/stage-director-fixture.mjs'
import { emptyStageState } from '../tavern-plugin/lib/domain/cast-stage-state.js'
import { STAGE_UPDATE_TOOL } from '../tavern-plugin/lib/domain/stage-director.js'

const chat = () => ({ id: 'story', sessionId: 'game', mode: 'story', timeline: { branchId: 'branch', revision: 3 },
  messages: [{ role: 'assistant', turn: 1, text: 'Opening.' }, { role: 'user', text: 'Continue.' }, { role: 'assistant', turn: 2, text: 'A silent figure waits.' }] })
const assets = () => ({ player: 'Reader', cast: [{ name: 'Nora', aliases: ['N'] }, { name: 'Lee' }, { name: 'Sam' }, { name: 'Jo' }, { name: 'Reader' }], background: [{ name: 'Room' }], music: [{ name: 'Theme' }] })
const delta = () => ({ figures: [{ speaker: 'Nora', emotion: '开心' }], background: 'Room', music: 'Theme' })
const setup = () => stageDirectorFixture(chat(), assets())
const append = h => h.persistence.update('story', current => { current.messages.push({ role: 'assistant', turn: 3, text: 'Silence.' }); current.timeline.revision++; return current })

test('the internal director accepts one atomic increment and keeps the story unchanged', async t => {
  const h = await setup(), request = await h.prepare(), before = await h.read(), writes = h.stats().writes
  const {system: instructions, turnContext: choices} = request
  t.diagnostic(JSON.stringify({ instructionBytes: Buffer.byteLength(instructions), stateAndChoicesBytes: Buffer.byteLength(choices), toolSchemaBytes: Buffer.byteLength(JSON.stringify(STAGE_UPDATE_TOOL)) }))
  assert.match(request.system, /stage_update/)
  assert.match(request.turnContext, /Theme/)
  assert.deepEqual(await request.call(delta()), { ok: true })
  assert.deepEqual(await h.read(), before)
  assert.equal(h.stats().writes, writes, 'the story journal is locked but not rewritten')
  assert.equal(h.stats().published, 1)
  assert.deepEqual(await h.director.state('game', 2), { figures: [{ speaker: 'Nora', emotion: 'joy' }], background: 'Room', music: 'Theme' })
  assert.equal((await request.call({ music: null })).ok, false, 'successful requests are single-use')
  assert.equal(await h.prepare(), null, 'a new director session cannot replace an accepted delta with omission')
})

test('a bad member rejects the entire batch and the same tool request can correct it', async () => {
  const h = await setup(), request = await h.prepare()
  assert.equal((await request.call({ ...delta(), music: 'Missing' })).ok, false)
  assert.equal(await h.data.snapshot('story'), null)
  assert.equal(h.stats().published, 0)
  assert.deepEqual(await request.call(delta()), { ok: true })
})

test('narration-only turns and fresh instances retain state; explicit clears remove it', async () => {
  const h = await setup()
  await (await h.prepare()).call(delta())
  await append(h)
  assert.deepEqual(await (await h.prepare()).call({}), { ok: true })
  const snapshot = await h.data.snapshot('story')
  assert.deepEqual(await h.make().state('game', 20), await h.director.state('game', 2))
  assert.deepEqual(await h.data.snapshot('story'), snapshot, 'projection is read-only')
  await h.persistence.update('story', current => { current.messages.push({ role: 'assistant', turn: 4, text: 'The room empties.' }); return current })
  assert.deepEqual(await (await h.prepare()).call({ figures: null, background: null, music: null }), { ok: true })
  assert.deepEqual(await h.director.state('game', 4), emptyStageState())
})

for (const change of ['text', 'branch', 'revision', 'next-turn', 'cancel', 'stopped']) test('stale or cancelled tool cannot publish: ' + change, async () => {
  const h = await setup(), request = await h.prepare()
  if (change === 'stopped') request.close()
  else if (change !== 'cancel') await h.persistence.update('story', current => {
    if (change === 'text') current.messages.at(-1).text = 'Replaced.'
    if (change === 'branch') current.timeline.branchId = 'other'
    if (change === 'revision') current.timeline.revision++
    if (change === 'next-turn') current.messages.push({ role: 'assistant', turn: 3, text: 'Later.' })
    return current
  })
  assert.equal((await request.call(delta(), change === 'cancel' ? AbortSignal.abort() : undefined)).ok, false)
  assert.equal(await h.data.snapshot('story'), null)
  assert.equal(h.stats().published, 0)
})

test('rollback, replaced history and another game do not read obsolete director records', async () => {
  const h = await setup()
  await (await h.prepare()).call(delta())
  assert.deepEqual(await h.director.state('other-game', 20), emptyStageState())
  await h.persistence.update('story', current => { current.messages.at(-1).text = 'Replacement.'; return current })
  assert.deepEqual(await h.director.state('game', 20), emptyStageState())
  await h.persistence.update('story', current => { current.messages.pop(); return current })
  assert.deepEqual(await h.director.state('game', 20), emptyStageState())
})

test('disabled stage has no task; canonical cast and explicit capacity are enforced', async () => {
  const h = await setup()
  h.enabled(false)
  assert.equal(await h.prepare(), null)
  h.enabled(true)
  const request = await h.prepare()
  for (const figures of [[{ speaker: 'N' }], [{ speaker: 'Reader' }], [{ speaker: 'Nora', emotion: 'unknown' }], ['Nora', 'Lee', 'Sam', 'Jo'].map(speaker => ({ speaker }))]) {
    assert.equal((await request.call({ figures })).ok, false)
    assert.equal(await h.data.snapshot('story'), null)
  }
  assert.deepEqual(await request.call(delta()), { ok: true })
})

test('concurrent duplicate submissions cannot replace an already accepted transaction', async () => {
  const h = await setup(), request = await h.prepare(), duplicate = await h.prepare()
  const results = await Promise.all([request.call(delta()), duplicate.call({ figures: null })])
  assert.deepEqual(results.map(result => result.ok), [true, false])
  assert.equal(h.stats().published, 1)
})
