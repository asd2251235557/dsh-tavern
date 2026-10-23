import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { crc32, deflateSync } from 'node:zlib'
import { writeZipEntries } from '../../tavern-plugin/lib/domain/zip-entries.js'
import { buildGameSave, readGameSave } from '../../tavern-plugin/lib/domain/game-save.js'
import { computeSceneTarget } from '../../tavern-plugin/lib/domain/scene-illustration.js'
import { CAST_DATA_OWNER } from '../../tavern-plugin/lib/domain/cast-annotation.js'

function png(r, g, b) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]), result = Buffer.alloc(body.length + 8)
    result.writeUInt32BE(data.length); body.copy(result, 4); result.writeUInt32BE(crc32(body), result.length - 4)
    return result
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header.set([8, 6], 8)
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0, r, g, b, 255]))), chunk('IEND', Buffer.alloc(0))])
}

// A real host/browser probe. Only the saved annotation is synthetic; import, native
// rounds, cast assets, RPC, rendering and reload all use the application's paths.
export async function stageStateChecks({ page, output }) {
  const call = (method, args = {}) => page.evaluate(async ([method, args]) => {
    const result = await (await fetch('/api/dsh-tavern/' + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) })).json()
    if (result.ok === false) throw Error(method + ': ' + JSON.stringify(result))
    return result
  }, [method, args])
  const run = Date.now()
  const name = 'Stage ' + run
  const card = { spec: 'chara_card_v3', spec_version: '3.0', data: { name, description: 'Original synthetic fixture.', first_mes: 'The curtain opens.', extensions: {}, assets: [
    { type: 'emotion', name: 'joy', uri: 'embeded://assets/emotion/joy.png', ext: 'png' },
    { type: 'background', name: 'main', uri: 'embeded://assets/background/room.png', ext: 'png' }
  ] } }
  const archive = writeZipEntries([{ path: 'card.json', content: JSON.stringify(card) }, { path: 'assets/emotion/joy.png', content: png(210, 90, 40) }, { path: 'assets/background/room.png', content: png(30, 70, 90) }])
  const imported = (await call('importCard', { payload: { kind: 'charx', name: 'stage-' + run + '.charx', fileB64: archive.toString('base64') } })).card
  await call('setCardStage', { path: imported.path, enabled: true })
  const history = [{ user_name: 'Reader', character_name: name }, { name, is_user: false, mes: 'The curtain opens.' }, { name: 'Reader', is_user: true, mes: 'Begin.' }, { name, is_user: false, mes: '"Ready."' }].map(JSON.stringify).join('\n')
  const game = await call('importChatHistoryText', { cardPath: imported.path, text: history, fileName: 'stage.jsonl' })
  assert.ok(game.sessionId, JSON.stringify(game))
  const exported = await call('exportGameSave', { sessionId: game.sessionId, images: false })
  const save = readGameSave(Buffer.from(exported.base64, 'base64'))
  const turn = Math.max(...save.chat.messages.filter(m => m.role === 'assistant').map(m => m.turn || 1))
  const annotation = { version: 1, lines: [{ n: 1, quote: 'Ready.', speaker: name, emotion: 'joy' }] }
  save.plugins = { data: { version: 1, owners: { [CAST_DATA_OWNER]: { game: null, turns: [{ turn, key: computeSceneTarget(save.chat, turn).key, data: annotation, bytes: JSON.stringify(annotation).length, updatedAt: 1 }] } } }, media: null, attachments: [] }
  const restored = await call('importGameSave', { fileB64: buildGameSave({ ...save, tavernVersion: save.manifest.tavernVersion, exportedAt: Date.now() }).toString('base64') })
  await call('setCardStage', { path: restored.cardPath, enabled: true })
  await call('castSetImage', { sessionId: restored.sessionId, name, slot: 'joy', data: png(210, 90, 40).toString('base64') })
  const title = 'Stage continuity restored ' + Date.now()
  await call('renameConversation', { sessionId: restored.sessionId, title })
  await page.reload()
  await page.getByText(name, { exact: true }).first().click()
  await page.getByText(title, { exact: true }).first().click()
  const stage = page.locator('.dsh-tavern-stage-section').filter({ visible: true })
  await stage.waitFor()
  await stage.locator('.dsh-tavern-stage-name').filter({ hasText: name }).waitFor()
  const snapshot = async label => {
    const rpc = await call('castStage', { sessionId: restored.sessionId, count: 1 })
    const figures = await stage.locator('.dsh-tavern-stage-figure').evaluateAll(nodes => nodes.map(node => ({ name: node.dataset.speaker, image: node.querySelector('img')?.getAttribute('src') || '' })))
    const background = await stage.locator('.dsh-tavern-stage-backdrop').getAttribute('style')
    await page.screenshot({ path: join(output, label + '.png') })
    return { figures, background, turn: rpc.turns.at(-1)?.turn, cast: rpc.cast, initialFigures: rpc.initialFigures }
  }
  const before = await snapshot('stage-before')
  assert.equal(before.figures.length, 1)
  assert.ok(before.figures[0].image, 'The fixture must show a real imported sprite')
  await call('appendStoryRounds', { sessionId: restored.sessionId, rounds: [{ user: 'Wait.', assistant: 'A quiet moment passes.' }] })
  await stage.locator('.dsh-tavern-stage-text').filter({ hasText: 'A quiet moment passes.' }).waitFor()
  const next = await snapshot('stage-next-turn')
  await page.reload()
  await stage.waitFor()
  await stage.locator('.dsh-tavern-stage-text').filter({ hasText: 'A quiet moment passes.' }).waitFor()
  const reloaded = await snapshot('stage-reloaded')
  const result = { before, next, reloaded, carriesTurn: next.figures[0]?.name === name, carriesReload: reloaded.figures[0]?.name === name,
    backgroundPreserved: before.background === next.background && before.background === reloaded.background }
  await writeFile(join(output, 'stage-state.json'), JSON.stringify(result, null, 2))
  assert.ok(result.carriesTurn, 'A narration-only next turn must retain the preceding figure')
  assert.ok(result.carriesReload, 'Reload must rebuild the same figure')
  assert.ok(result.backgroundPreserved)
  await call('appendStoryRounds', { sessionId: restored.sessionId, rounds: Array.from({ length: 6 }, (_, i) => ({ user: 'Wait.', assistant: 'Quiet interval ' + i + '.' })) })
  await stage.locator('.dsh-tavern-stage-text').filter({ hasText: 'Quiet interval 5.' }).waitFor()
  result.longSilence = await snapshot('stage-long-silence')
  assert.deepEqual(result.longSilence.figures, before.figures, 'The cast must not depend on the recent-turn window')
  assert.deepEqual(result.longSilence.initialFigures, [{ speaker: name, emotion: 'joy' }], 'count=1 still receives the full historical seed')
  await stage.getByRole('button', { name: '全屏舞台', exact: true }).click()
  const fullscreen = page.locator('.dsh-tavern-stage-overlay')
  await fullscreen.locator('.dsh-tavern-stage-figure img').waitFor()
  assert.equal(await fullscreen.locator('.dsh-tavern-stage-figure').getAttribute('data-speaker'), name)
  await page.screenshot({ path: join(output, 'stage-fullscreen.png') })
  await page.keyboard.press('Escape')
  result.fullscreen = true
  await writeFile(join(output, 'stage-state.json'), JSON.stringify(result, null, 2))
  return result
}

// Run only against a disposable browser/profile that you started for this test.
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const endpoint = process.env.TAVERN_STAGE_TEST_CDP
  const directory = process.argv[process.argv.indexOf('--artifacts') + 1]
  if (!process.argv.includes('--isolated') || !endpoint || !process.argv.includes('--artifacts') || !directory) {
    throw Error('Requires --isolated --artifacts DIR and TAVERN_STAGE_TEST_CDP for an owned disposable browser; never use a personal profile')
  }
  const { chromium } = await import('playwright')
  await mkdir(directory, { recursive: true })
  const browser = await chromium.connectOverCDP(endpoint)
  try {
    const pages = browser.contexts().flatMap(context => context.pages()).filter(page => /^(https?:|dsh-app:)/.test(page.url()))
    assert.equal(pages.length, 1, 'Use a disposable browser with exactly one Tavern page')
    pages[0].setDefaultTimeout(20000)
    const result = await stageStateChecks({ page: pages[0], output: directory })
    console.log(JSON.stringify({ carriesTurn: result.carriesTurn, carriesReload: result.carriesReload, backgroundPreserved: result.backgroundPreserved, fullscreen: result.fullscreen }))
  } finally { await browser.close() }
}
