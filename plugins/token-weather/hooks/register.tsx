import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Cache, Reading } from '../types'

const HOUR = 3_600_000
const FIVE_MIN = 300_000
const MARGIN = 60_000

const history = atom({ plugin: 'token-weather', key: 'history' } as const, [] as Reading[])
const cache = atom({ plugin: 'token-weather', key: 'cache' } as const, null as Cache | null)
const tick = atom({ plugin: 'token-weather', key: 'tick' } as const, 0)
const ttl = atom({ plugin: 'token-weather', key: 'ttl' } as const, HOUR)

const BARS = '▁▂▃▄▅▆▇█'
const KEEP = 12

export const forecast = (percent: number) =>
  percent >= 90 ? { icon: '↯', word: 'Compact soon', color: 'red' }
  : percent >= 75 ? { icon: '☇', word: 'Storm', color: 'magenta' }
  : percent >= 50 ? { icon: '☂', word: 'Showers', color: 'blue' }
  : percent >= 25 ? { icon: '☁', word: 'Cloudy', color: 'cyan' }
  : { icon: '☀', word: 'Clear', color: 'yellow' }

export const fmt = (n: number) => {
  if (n < 1000) return String(Math.round(n))
  const k = n / 1000
  return `${k.toFixed(1).replace(/\.0$/, '')}k`
}

export const chart = (values: number[], window: number) =>
  values
    .map(v => BARS[Math.min(BARS.length - 1, Math.max(0, Math.floor((v / window) * BARS.length)))])
    .join('')

/** Share of a turn's input the prompt cache served, 0–100; null when nothing was counted. */
export const hitRate = (u: { input_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }) => {
  const total = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
  return total > 0 ? Math.round((u.cache_read_input_tokens / total) * 100) : null
}

export const usd = (n: number) => (n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`)

export const msLeft = (at: number, ttlMs: number, now: number) => at + ttlMs - MARGIN - now

export const isWarm = (reused: number, leftMs: number) => reused >= 50 && leftMs > 0

export const warmth = (reused: number, leftMs: number) =>
  isWarm(reused, leftMs) ? { icon: '🔥', word: 'Warm', color: 'yellow' } : { icon: '🧊', word: 'Cold', color: 'blue' }

export const leftLabel = (leftMs: number) => (leftMs <= 0 ? 'expired' : `${Math.ceil(leftMs / 60_000)} min left`)

/** Cache TTL of the newest main-thread assistant line in a transcript tail; null when none says. */
export const parseTtl = (tail: string): number | null => {
  const lines = tail.split('\n').slice(1)
  for (let i = lines.length - 1; i >= 0; i--) {
    let o: any
    try {
      o = JSON.parse(lines[i] ?? '')
    } catch {
      continue
    }
    if (!o || o.type !== 'assistant' || o.isSidechain === true) continue
    const cc = o.message?.usage?.cache_creation
    if (!cc) continue
    if (cc.ephemeral_1h_input_tokens > 0) return HOUR
    if (cc.ephemeral_5m_input_tokens > 0) return FIVE_MIN
  }
  return null
}

let transcript: string | undefined
async function findTranscript($: EngineInterface) {
  if (transcript) return transcript
  const id = await $.session.id()
  const r = await $.process.run(['sh', '-c', 'find "$HOME/.claude/projects" -maxdepth 2 -name "$1" | head -1', 'sh', `${id}.jsonl`])
  const path = r.stdout.trim()
  if (path) transcript = path
  return transcript
}

async function refreshTtl($: EngineInterface) {
  try {
    const path = await findTranscript($)
    if (!path) return
    const r = await $.process.run(['tail', '-c', '200000', path])
    const found = parseTtl(r.stdout)
    if (found !== null) await update($, ttl, () => found)
  } catch { /* desktop-hosted sessions have no $.process; keep the current ttl */ }
}

let ticker: Timer | undefined
let lastKey = ''
function startTicker($: EngineInterface) {
  ticker?.cancel()
  ticker = $.clock.every(5_000, () => {
    void (async () => {
      const c = await read($, cache)
      const t = await read($, ttl)
      const now = await $.clock.now()
      const key = c ? `${leftLabel(msLeft(c.at, t, now))}|${isWarm(c.reused, msLeft(c.at, t, now))}` : ''
      if (key !== lastKey) {
        lastKey = key
        await update($, tick, n => n + 1)
      }
    })()
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    startTicker($)
    return r
  })

  on('turn.step', async function* ($, e, next) {
    const sentAt = e.agentId ? 0 : await $.clock.now()
    for await (const c of next(e)) {
      yield c
      if (!e.agentId && c.kind === 'stop' && c.usage) {
        const reused = hitRate(c.usage)
        if (reused !== null) {
          await update($, cache, () => ({ reused, at: sentAt }))
        }
      }
    }
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      const { context } = await $.session.usage()
      if (context.tokens !== undefined) {
        const reading: Reading = { tokens: context.tokens, window: context.window }
        await update($, history, list => [...list, reading].slice(-KEEP))
      }
      await refreshTtl($)
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const readings = await read($, history)
    const now = readings[readings.length - 1]
    if (!now) return next(e)
    await read($, tick)
    const c = await read($, cache)
    const t = await read($, ttl)
    const clock = await $.clock.now()
    const { cost } = await $.session.usage()

    const { Box, Text } = $.ui.resolve(e)
    const percent = Math.round((now.tokens / now.window) * 100)
    const f = forecast(percent)
    const left = c ? msLeft(c.at, t, clock) : 0
    const w = c ? warmth(c.reused, left) : null
    const prev = readings.at(-2)
    const delta = prev ? now.tokens - prev.tokens : now.tokens
    const arrow = delta >= 0 ? '▲' : '▼'
    const sign = delta >= 0 ? '+' : '-'

    return (
      <Box justifyContent="space-between" flexWrap="wrap">
        <Box flexShrink={0}>
          <Text wrap="truncate-end">
            <Text color={f.color} bold>{f.icon} {f.word}</Text>
            {`  ${percent}%  ${fmt(now.tokens)} / ${fmt(now.window)}  `}
            <Text color={f.color}>{chart(readings.map(r => r.tokens), now.window)}</Text>
            <Text dimColor>{`  ${arrow} ${sign}${fmt(Math.abs(delta))} last turn`}</Text>
          </Text>
        </Box>
        <Box flexShrink={0}>
          <Text wrap="truncate-end">
            {c && <Text color={w!.color} bold>{w!.icon} {w!.word}</Text>}
            {c && `  reused ${c.reused}% of context`}
            {c && <Text dimColor>{` (${leftLabel(left)})`}</Text>}
            {cost && <Text dimColor>{`${c ? ' · ' : ''}spent ${usd(cost.usd)}`}</Text>}
          </Text>
        </Box>
      </Box>
    )
  })
}
