import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { crc32, deflateSync } from 'node:zlib'
import { writeZipEntries } from '../../tavern-plugin/lib/domain/zip-entries.js'
import { readGameSave } from '../../tavern-plugin/lib/domain/game-save.js'

const endpoint = process.env.TAVERN_STAGE_TEST_CDP, modulePath = process.env.TAVERN_E2E_LLM_MODULE
const output = process.argv[process.argv.indexOf('--artifacts') + 1]
if (!process.argv.includes('--isolated') || !process.argv.includes('--artifacts') || !modulePath || !endpoint || new URL(endpoint).port === '9333') throw Error('Requires an owned hidden muted fresh-profile slot, runtime LLM module and artifacts directory')
await mkdir(output, { recursive: true })
const browser = await chromium.connectOverCDP(endpoint)
const page = browser.contexts().flatMap(context => context.pages()).find(page => /^(https?:|dsh-app:)/.test(page.url()))
page.setDefaultTimeout(20000)
async function until(check) { const end = Date.now() + 40000; while (Date.now() < end) { const value = await check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 150)) } throw Error('Native director condition timed out') }
const call = (method, args = {}) => page.evaluate(async ([method, args]) => {
  const value = await (await fetch('/api/dsh-tavern/' + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) })).json()
  if (value.ok === false) throw Error(method + ': ' + JSON.stringify(value))
  return value
}, [method, args])
try {
  const proceed = page.getByRole('button', { name: 'Continue', exact: true })
  if (await proceed.isVisible()) await proceed.click()
  // Only model output is substituted; native tools, sessions, host completion and storage are real.
  const source = `import { LlmAdapter } from ${JSON.stringify(pathToFileURL(modulePath).href)}
export const name = 'stage-native-fixture', inject = ['llm', 'tavern']
export function apply(ctx) {
  const requests = []
  ctx.tavern.handle('stage-native-fixture/requests', () => requests)
  class Model extends LlmAdapter {
    async listModels(provider) { return [await this.resolveModel(provider, 'fixed')] }
    async resolveModel(provider, id) { return { provider, id, name: 'Native director fixture', context: { contextWindow: 64000 } } }
    async *stream(input) {
      const names = input.tools.map(tool => tool.name)
      let block = { type: 'text', text: names.includes('candidate_submit_choices') ? 'Done.' : 'Native Nora arrives.' }
      if (names.includes('stage_update')) {
        if (names.length !== 1) throw Error('Director exposed other tools')
        requests.push({ sessionId: input.sessionId, tools: names, results: input.messages.filter(message => message.role === 'tool') })
        block = { type: 'tool-call', id: 'direction-' + requests.length, name: 'stage_update', arguments: JSON.stringify({ figures: [{ speaker: requests.length === 1 ? 'Missing' : 'Native Nora', emotion: 'joy' }] }) }
      }
      yield { type: 'block-start', index: 0, blockType: block.type }
      yield { type: 'block-end', index: 0, block }
      yield { type: 'finish', reason: { kind: block.type === 'tool-call' ? 'tool-calls' : 'stop' } }
    }
  }
  ctx.llm.registerAdapter(['stage-native-fixture'], new Model())
}`
  const zip = writeZipEntries([{ path: 'package.json', content: JSON.stringify({ name: 'stage-native-fixture', type: 'module', main: 'index.mjs' }) }, { path: 'index.mjs', content: source }])
  const upload = await page.evaluate(async base64 => (await fetch('/api/dsh-tavern/card-upload', { method: 'POST', body: Uint8Array.from(atob(base64), c => c.charCodeAt(0)), headers: { 'content-type': 'application/octet-stream' } })).json(), zip.toString('base64'))
  await call('installUserPluginUpload', { uploadId: upload.uploadId, name: 'stage-native-fixture.zip' })
  const requests = async () => (await call('callPluginHandler', { name: 'stage-native-fixture/requests', args: {} })).result
  await until(() => requests().catch(() => null))
  const model = { provider: 'stage-native-fixture', model: 'fixed' }
  await call('updateTavernSettings', { patch: { defaultForegroundModel: model, defaultBackgroundModel: model } })
  const cardZip = writeZipEntries([{ path: 'card.json', content: JSON.stringify({ spec: 'chara_card_v3', spec_version: '3.0', data: { name: 'Native Nora', description: 'Original synthetic fixture.', first_mes: 'The curtain opens.', extensions: {} } }) }])
  const card = (await call('importCard', { payload: { kind: 'charx', name: 'native-nora.charx', fileB64: cardZip.toString('base64') } })).card
  const text = [{ user_name: 'Reader', character_name: 'Native Nora' }, { name: 'Native Nora', is_user: false, mes: 'The curtain opens.' }, { name: 'Reader', is_user: true, mes: 'Begin.' }, { name: 'Native Nora', is_user: false, mes: 'Ready.' }].map(JSON.stringify).join('\n')
  const { sessionId } = await call('importChatHistoryText', { cardPath: card.path, text, fileName: 'native-director.jsonl' })
  const chunk = (type, bytes) => { const body = Buffer.concat([Buffer.from(type), bytes]), out = Buffer.alloc(body.length + 8); out.writeUInt32BE(bytes.length); body.copy(out, 4); out.writeUInt32BE(crc32(body), out.length - 4); return out }
  const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header.set([8, 6], 8)
  const image = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0, 40, 80, 200, 255]))), chunk('IEND', Buffer.alloc(0))])
  await call('castSetImage', { sessionId, name: 'Native Nora', slot: 'joy', data: image.toString('base64') })
  await call('setCardStage', { path: card.path, enabled: true })
  await call('setConversationBackgroundModel', { sessionId, backgroundModel: model, backgroundTasks: { variables: false, posture: false, characterDesign: false, ledger: false, styleReference: false }, webSearchEnabled: false })
  await call('renameConversation', { sessionId, title: 'Native director verification' })
  await page.reload()
  const group = page.locator('.dsh-tavern-history-group-toggle').filter({ hasText: 'Native Nora' })
  await group.waitFor(); if (await group.getAttribute('aria-expanded') === 'false') await group.click()
  await page.getByText('Native director verification', { exact: true }).first().click()
  const selector = page.getByRole('button', { name: /Select model/ })
  if (!(await selector.innerText()).includes('Native director fixture')) {
    await selector.click()
    const item = page.getByRole('menuitemradio', { name: 'Native director fixture', exact: true })
    await until(async () => await item.isVisible() || (await selector.innerText()).includes('Native director fixture'))
    if (await item.isVisible()) await item.click()
  }
  await until(async () => (await selector.innerText()).includes('Native director fixture'))
  const view = () => call('castStage', { sessionId, count: 1 })
  assert.deepEqual((await view()).stage.figures, [])
  const box = page.getByRole('textbox', { name: /发消息|Message/ })
  await box.fill('DIRECTOR_NATIVE'); await box.press('Enter')
  const final = await until(async () => { const value = await view(); return value.stage.figures.length === 1 && value })
  const audit = await requests()
  assert.equal(audit.length, 2); assert.equal(audit[0].sessionId, audit[1].sessionId); assert.notEqual(audit[0].sessionId, sessionId)
  assert.match(JSON.stringify(audit[1].results), /retryable/)
  const save = readGameSave(Buffer.from((await call('exportGameSave', { sessionId, images: false })).base64, 'base64'))
  const records = save.plugins.data.owners['dsh-tavern.stage'].turns
  assert.equal(records.length, 1); assert.equal(records[0].data.delta.figures[0].speaker, 'Native Nora')
  const stage = page.locator('.dsh-tavern-stage-section').filter({ visible: true })
  await stage.locator('.dsh-tavern-stage-figure').waitFor()
  await page.screenshot({ path: join(output, 'native-director.png') })
  await page.reload(); await stage.waitFor()
  assert.deepEqual((await view()).stage, final.stage)
  assert.equal((await requests()).length, 2, 'refresh does not generate')
  await writeFile(join(output, 'native-director.json'), JSON.stringify({ sessionId, audit, records, final }, null, 2))
} catch (error) {
  await writeFile(join(output, 'failure.txt'), error.stack + '\n' + await page.locator('body').innerText())
  await page.screenshot({ path: join(output, 'failure.png') })
  throw error
} finally { await browser.close() }
