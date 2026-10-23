import { dialogueQuotes } from './cast-annotation.js'

// Host-owned pages: annotations decorate a row, but cannot change its address.
export function stagePages(text, lines = []) {
  let cursor = 0
  if (/^\s*(```|~~~)/m.test(text)) lines = []
  return text.split('\n').map(row => row.trim()).filter(Boolean).map((text, index) => {
    let speaker
    const quotes = []
    for (const quote of dialogueQuotes(text)) {
      const next = lines.findIndex((line, i) => i >= cursor && line.quote === quote)
      if (next < 0) continue
      speaker ||= lines[next]
      cursor = next + 1
      quotes.push(quote)
    }
    return { at: index + 1, text, kind: speaker ? 'line' : 'narration',
      ...(speaker ? { speaker: speaker.speaker, emotion: speaker.emotion, quotes } : {}) }
  })
}

export const STAGE_PERFORMANCES_SCHEMA = { type: 'array', maxItems: 12, description: '一次性演出，不跨轮继承。at 是本轮正文页号，从 1 开始。', items: { oneOf: [
  { type: 'object', additionalProperties: false, required: ['at', 'op', 'actor', 'motion'], properties: {
    at: { type: 'integer', minimum: 1 }, op: { const: 'actor.act.play' }, actor: { type: 'string' }, motion: { enum: ['nod', 'jump'] } } },
  { type: 'object', additionalProperties: false, required: ['at', 'op', 'effect'], properties: {
    at: { type: 'integer', minimum: 1 }, op: { const: 'screen.play' }, effect: { const: 'shake-1' } } }
] } }

export function acceptStagePerformances(value = [], pages, stage) {
  if (!Array.isArray(value) || value.length > 12) throw Error('performances 需要至多十二项一次性演出，省略或 [] 表示没有')
  const occupied = new Set()
  for (const event of value) {
    const actor = event?.op === 'actor.act.play'
    const keys = actor ? ['at', 'op', 'actor', 'motion'] : ['at', 'op', 'effect']
    if (!event || typeof event !== 'object' || Object.keys(event).some(key => !keys.includes(key)) || !Number.isSafeInteger(event.at) || event.at < 1 || event.at > pages.length) throw Error('演出 at 请使用本轮正文页号，且只提交该命令列出的字段')
    if (actor ? !['nod', 'jump'].includes(event.motion) || !stage.figures.some(figure => figure.speaker === event.actor) : event.op !== 'screen.play' || event.effect !== 'shake-1') throw Error('演出请使用在场人物完整名称 + nod/jump，或 screen.play + shake-1')
    const target = JSON.stringify([event.at, actor ? event.actor : null])
    if (occupied.has(target)) throw Error('同页同一目标只安排一个短演出；不同页可重复')
    occupied.add(target)
  }
  return structuredClone(value)
}
