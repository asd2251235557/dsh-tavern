import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { tavernCastCharacter } from '../tavern-plugin/lib/domain/cast-stage-state.js'

const source = readFileSync(new URL('../tavern-plugin/src/client/modules/stage-runtime.js', import.meta.url), 'utf8')
const { createStageRuntimeStore, createStageRuntimeSessions } = vm.runInNewContext(source + '; ({createStageRuntimeStore, createStageRuntimeSessions})', { AbortController })
const feature = readFileSync(new URL('../tavern-plugin/src/client/features/stage-runtime.js', import.meta.url), 'utf8')
const project = vm.runInNewContext(feature.slice(0, feature.indexOf('function watchStageRuntime')) + '; stageRuntimeScene', { tavernCastCharacter })
const tick = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const data = (name = 'Nora') => ({ enabled: true, card: { name, imageUrl: 'card' }, cast: [{ name, aliases: ['Reader'], sprites: { joy: 'joy', neutral: 'calm' } }], stage: { figures: [{ speaker: name, emotion: 'joy' }] }, turns: [] })
const copy = value => JSON.parse(JSON.stringify(value))

function fixture() {
  const reads = [], changes = []
  const store = createStageRuntimeStore({ read(signal) { const task = deferred(); reads.push({ ...task, signal }); return task.promise }, project, changed: () => changes.push(store.getSnapshot()) })
  return { store, reads, changes }
}

test('refresh and failure retain one atomic scene; identical snapshots reuse static presentation', async () => {
  const { store, reads } = fixture()
  let pending = store.refresh(); await tick(); reads[0].resolve(data()); await pending
  const accepted = store.getSnapshot()
  assert.equal(accepted.scene.figures[0].url, 'joy')
  pending = store.refresh(); await tick()
  assert.equal(store.getSnapshot().scene, accepted.scene)
  reads[1].reject(Error('offline')); await pending
  assert.equal(store.getSnapshot().scene, accepted.scene); assert.match(store.getSnapshot().error, /offline/)
  pending = store.refresh(); await tick(); reads[2].resolve(data()); await pending
  assert.equal(store.getSnapshot().data, accepted.data); assert.equal(store.getSnapshot().scene, accepted.scene)
  pending = store.refresh(); await tick(); reads[3].resolve({ ...data(), background: 'night', stage: { figures: [] } }); await pending
  assert.equal(store.getSnapshot().scene.background, 'night'); assert.equal(store.getSnapshot().scene.figures.length, 0)
  store.dispose()
})

test('single-flight notifications discard outdated reads and reconcile once more', async () => {
  const { store, reads, changes } = fixture()
  const pending = store.refresh(); await tick()
  store.refresh(); store.refresh(); assert.equal(reads.length, 1)
  reads[0].resolve(data('Old')); await tick()
  assert.equal(reads.length, 2); assert.equal(store.getSnapshot().data, null)
  reads[1].resolve(data('New')); await pending
  assert.equal(store.getSnapshot().data.card.name, 'New')
  assert.ok(!changes.some(value => value.data?.card.name === 'Old'))
  store.dispose()
})

test('context withdrawal aborts and clears; late responses after reset or disposal cannot publish', async () => {
  const { store, reads } = fixture()
  let pending = store.refresh(); await tick(); reads[0].resolve(data()); await pending
  pending = store.refresh(); await tick(); store.refresh(true)
  assert.equal(reads[1].signal.aborted, true); assert.equal(store.getSnapshot().scene, null)
  reads[1].resolve(data('Old branch')); await tick(); reads[2].resolve(data('Other card')); await pending
  assert.equal(store.getSnapshot().data.card.name, 'Other card')
  pending = store.refresh(); await tick(); store.dispose(); reads[3].resolve(data('Late')); await pending
  assert.equal(store.getSnapshot().data, null); assert.equal(reads[3].signal.aborted, true)
})

test('static projection uses canonical cast selection and is independent of pages', () => {
  const value = data(); value.stage.figures[0].speaker = 'Reader'
  assert.deepEqual(copy(project(value)), { background: 'card', backdrop: false, figures: [{ name: 'Reader', url: 'joy' }] })
  value.stage.figures[0].emotion = 'unavailable'
  assert.equal(project(value).figures[0].url, 'calm')
  assert.equal(project({ ...value, turns: [{ pages: [{ text: 'Different page' }] }] }).figures[0].url, 'calm')
})

test('session owner survives UI remount, isolates sessions, replaces bindings and releases subscriptions', async () => {
  let selected = 'a', listener, stopped = 0, notifications = 0
  const bindings = { a: {}, b: {} }, watches = new Map(), reads = []
  const sessions = { binding: id => bindings[id], list: { getSnapshot: () => ({ current: selected, byId: Object.fromEntries(Object.keys(bindings).map(id => [id, { id }])) }), subscribe: fn => { listener = fn; return () => { listener = null } } } }
  const owner = createStageRuntimeSessions({ read: async id => { reads.push(id); return data(id) }, project, watch: (id, binding, wake) => { watches.set(id, wake); return () => { stopped++; watches.delete(id) } } })
  const stop = owner.start(sessions); await tick()
  const first = owner.getSnapshot('a'), unsubscribe = owner.subscribe('a', () => notifications++)
  unsubscribe(); const unmount = owner.subscribe('a', () => notifications++)
  assert.equal(owner.getSnapshot('a'), first); assert.deepEqual(reads, ['a'])
  selected = 'b'; listener(); await tick()
  assert.equal(owner.getSnapshot('b').data.card.name, 'b'); assert.equal(owner.getSnapshot('a'), first)
  selected = 'a'; listener(); await tick(); assert.deepEqual(reads, ['a', 'b'])
  watches.get('a')(); await tick(); assert.ok(notifications > 0)
  bindings.a = {}; listener(); await tick(); assert.equal(stopped, 1)
  delete bindings.b; listener(); assert.equal(owner.getSnapshot('b').data, null); assert.equal(stopped, 2)
  unmount(); stop(); assert.equal(stopped, 3); assert.equal(listener, null); assert.equal(watches.size, 0)
  assert.equal(owner.getSnapshot('a').data, null)
})

test('source adapter resets on changed authority, keeps refreshes read-only and removes every watch', () => {
  let view = { chatId: 'a', card: { path: 'card' }, settlementTurn: 1 }, onView, onSession, running = false, cleared = 0
  const refreshes = [], events = new Map(), stops = []
  const subscribe = fn => { stops.push(fn); return () => { cleared++ } }
  const watch = vm.runInNewContext(feature.slice(feature.indexOf('function watchStageRuntime'), feature.indexOf('const tavernStageRuntime')) + '; watchStageRuntime', {
    liveTavernView: { select: () => ({ getSnapshot: () => ({ view }), subscribe: fn => { onView = fn; return subscribe(fn) } }) },
    tavernCoordination: { subscribe: (_, fn) => subscribe(fn) }, tavernSessionSignals: { subscribe: (_, channel, fn) => { assert.equal(channel, 'cast'); return subscribe(fn) } },
    document: { hidden: false }, window: { addEventListener: (name, fn) => events.set(name, fn), removeEventListener: name => events.delete(name), setInterval: () => 1, clearInterval: () => { cleared++ } }
  })
  const stop = watch('a', { session: { getSnapshot: () => ({ running }), subscribe: fn => { onSession = fn; return subscribe(fn) } } }, reset => refreshes.push(Boolean(reset)))
  onView(); view = { ...view, settlementTurn: 2 }; onView(); assert.deepEqual(refreshes, [false, false])
  view = { ...view, regeneratedDshTurns: { 2: 4 }, suppressedDshTurns: [4] }; onView(); assert.equal(refreshes.at(-1), false)
  view = { ...view, suppressedDshTurns: [2, 4] }; onView(); assert.equal(refreshes.at(-1), true)
  running = true; onSession(); assert.equal(refreshes.at(-1), false)
  stop(); assert.equal(cleared, 5); assert.equal(events.size, 0)
})
