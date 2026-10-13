import { expect, test } from 'claude-code/testing'
import { chart, fmt, forecast, hitRate, isWarm, leftLabel, msLeft, parseTtl, usd, warmth } from './register'

test('thresholds', () => {
  expect(forecast(24).word).toBe('Clear')
  expect(forecast(25).word).toBe('Cloudy')
  expect(forecast(50).word).toBe('Showers')
  expect(forecast(75).word).toBe('Storm')
  expect(forecast(90).word).toBe('Compact soon')
})
test('format', () => {
  expect(fmt(134400)).toBe('134.4k')
  expect(fmt(98300)).toBe('98.3k')
  expect(fmt(200000)).toBe('200k')
})
test('chart', () => {
  expect(chart([0, 100000, 200000], 200000)).toBe('▁▅█')
})
test('cache hit rate', () => {
  expect(hitRate({ input_tokens: 1_000, cache_read_input_tokens: 97_000, cache_creation_input_tokens: 2_000 })).toBe(97)
  expect(hitRate({ input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })).toBe(null)
})
test('usd', () => {
  expect(usd(3.184)).toBe('$3.18')
  expect(usd(0.004)).toBe('<$0.01')
})
test('ms left', () => {
  expect(msLeft(0, 3_600_000, 0)).toBe(3_600_000 - 60_000)
})
test('left label', () => {
  expect(leftLabel(59 * 60_000)).toBe('59 min left')
  expect(leftLabel(58 * 60_000 + 1)).toBe('59 min left')
  expect(leftLabel(0)).toBe('expired')
})
test('warm', () => {
  expect(isWarm(97, 1)).toBe(true)
  expect(isWarm(97, 0)).toBe(false)
  expect(isWarm(49, 10_000)).toBe(false)
})
test('warmth', () => {
  expect(warmth(97, 1_000)).toEqual({ icon: '🔥', word: 'Warm', color: 'yellow' })
  expect(warmth(97, 0).word).toBe('Cold')
  expect(warmth(2, 1_000).word).toBe('Cold')
  expect(warmth(2, 1_000).color).toBe('blue')
})
const line = (o: object) => JSON.stringify(o)
const asst = (h: number, m: number, side = false) =>
  line({ type: 'assistant', isSidechain: side, message: { usage: { cache_creation: { ephemeral_1h_input_tokens: h, ephemeral_5m_input_tokens: m } } } })
test('parseTtl', () => {
  expect(parseTtl(['{"cut":"frag', asst(46, 0)].join('\n'))).toBe(3_600_000)
  expect(parseTtl(['x', asst(0, 10), asst(0, 0)].join('\n'))).toBe(300_000)
  expect(parseTtl(['x', asst(5, 0, true)].join('\n'))).toBe(null)
  expect(parseTtl('garbage\nmore garbage\n{')).toBe(null)
})
