import type { Cat, Phase, Size, Step, Todo, Turn } from '../types'

export const CATS: Record<Cat, { label: string; color: string }> = {
  read: { label: 'Reading files', color: '#7b9ad6' },
  search: { label: 'Searching the code', color: '#86c9d6' },
  app: { label: 'Using connected apps', color: '#a99cf5' },
  command: { label: 'Running commands', color: '#e8d07a' },
  agent: { label: 'Helper agents', color: '#9fd68f' },
  skill: { label: 'Following skills', color: '#e8a0bf' },
  edit: { label: 'Editing files', color: '#f0a070' },
  web: { label: 'Browsing the web', color: '#d98fd9' },
  other: { label: 'Other tools', color: '#8a8f98' },
}

export const ORDER: Cat[] = ['read', 'search', 'app', 'command', 'agent', 'skill', 'edit', 'web', 'other']

export const clip = (text: string, max: number): string => {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, max - 1)}…` : one
}

const cap = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1)
const base = (path: string): string => path.split('/').filter(Boolean).pop() ?? path

export const classify = (tool: string): Cat => {
  if (tool.startsWith('mcp__')) return 'app'
  if (tool === 'Read' || tool === 'NotebookRead') return 'read'
  if (tool === 'Grep' || tool === 'Glob' || tool === 'ToolSearch') return 'search'
  if (tool === 'Skill') return 'skill'
  if (tool === 'Bash' || tool === 'BashOutput' || tool === 'KillShell' || tool === 'Monitor') return 'command'
  if (tool === 'Agent' || tool === 'Task' || tool === 'SendMessage') return 'agent'
  if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit' || tool === 'NotebookEdit') return 'edit'
  if (tool === 'WebFetch' || tool === 'WebSearch') return 'web'
  return 'other'
}

const str = (input: Record<string, unknown>, key: string): string => {
  const value = input[key]
  return typeof value === 'string' ? value : ''
}

const firstArg = (input: Record<string, unknown>): string => {
  for (const value of Object.values(input)) {
    if (typeof value === 'number') return String(value)
    if (typeof value === 'string' && value.length > 0 && value.length <= 40) return value
  }
  return ''
}

const MASK = '•••'

/** Hides what looks like a credential before a command, URL or path is drawn on screen. */
export const redact = (text: string): string =>
  text
    .replace(/(authorization:\s*(?:bearer|basic|token)\s+)\S+/gi, `$1${MASK}`)
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, `$1${MASK}`)
    .replace(/(--?(?:token|password|passwd|secret|api[-_]?key|access[-_]?key|auth)(?:=|\s+))\S+/gi, `$1${MASK}`)
    .replace(/\b([A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY)[A-Za-z0-9_]*=)\S+/g, `$1${MASK}`)
    .replace(/(https?:\/\/[^/\s:@]+:)[^@\s/]+@/g, `$1${MASK}@`)
    .replace(/\b(?:sk|pk|rk)[-_](?:live_|test_)?[A-Za-z0-9_-]{16,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bxox[abprs]-[A-Za-z0-9-]{10,}|\bAKIA[0-9A-Z]{12,}|\bAIza[A-Za-z0-9_-]{30,}|\bnpm_[A-Za-z0-9]{30,}|\bwhsec_[A-Za-z0-9]{16,}/g, MASK)
    // "password": "x" and password: x, as JSON or YAML write them
    .replace(/((?:password|passwd|secret|token|api[-_]?key)["']?\s*[:=]\s*["']?)[^\s"',}]{4,}/gi, `$1${MASK}`)
    // A long unbroken run of letters and digits (a key, a hash). Slashes and dots are left out so paths survive.
    .replace(/(?<![A-Za-z0-9+/=_.-])(?=[A-Za-z0-9+_=-]*\d)(?=[A-Za-z0-9+_=-]*[A-Za-z])[A-Za-z0-9+_=-]{40,}(?![A-Za-z0-9+/=_.-])/g, MASK)

type Described = { title: string; doing: string; detail: string }

/** Plain-language title and the `tool · argument` line for one tool call, secrets hidden. */
export const describe = (tool: string, input: Record<string, unknown>): Described => {
  const raw = describeRaw(tool, input)

  return { title: redact(raw.title), doing: redact(raw.doing), detail: redact(raw.detail) }
}

const describeRaw = (tool: string, input: Record<string, unknown>): Described => {
  const path = str(input, 'file_path') || str(input, 'path')
  switch (tool) {
    case 'Read':
      return { title: `Read ${base(path)}`, doing: `Reading ${base(path)}`, detail: `read · ${path}` }
    case 'Edit':
    case 'MultiEdit':
      return { title: `Edited ${base(path)}`, doing: `Editing ${base(path)}`, detail: `edit · ${path}` }
    case 'Write':
      return { title: `Wrote ${base(path)}`, doing: `Writing ${base(path)}`, detail: `write · ${path}` }
    case 'NotebookEdit':
      return { title: `Edited notebook ${base(path)}`, doing: `Editing notebook ${base(path)}`, detail: `notebook · ${path}` }
    case 'Grep':
    case 'Glob': {
      const pattern = str(input, 'pattern')
      const where = str(input, 'path') || str(input, 'glob')
      return {
        title: `Searched the code for “${clip(pattern, 40)}”`,
        doing: `Searching the code for “${clip(pattern, 40)}”`,
        detail: `${tool.toLowerCase()} · "${clip(pattern, 40)}"${where ? ` in ${clip(where, 30)}` : ''}`,
      }
    }
    case 'Bash': {
      const command = str(input, 'command')
      const why = str(input, 'description')
      return { title: clip(why || command, 70), doing: `Running: ${clip(why || command, 60)}`, detail: `bash · ${clip(command, 70)}` }
    }
    case 'Skill':
      return { title: `Loaded the “${str(input, 'skill')}” skill`, doing: `Following the “${str(input, 'skill')}” skill`, detail: `skill · ${str(input, 'skill')}` }
    case 'Agent':
    case 'Task': {
      const kind = str(input, 'subagent_type') || 'general'
      return { title: `Asked a helper agent: ${clip(str(input, 'description'), 60)}`, doing: `Waiting on a helper agent: ${clip(str(input, 'description'), 50)}`, detail: `agent · ${kind}` }
    }
    case 'WebSearch':
      return { title: `Searched the web for “${clip(str(input, 'query'), 50)}”`, doing: `Searching the web for “${clip(str(input, 'query'), 50)}”`, detail: `web · ${clip(str(input, 'query'), 60)}` }
    case 'WebFetch':
      return { title: `Fetched ${clip(str(input, 'url'), 60)}`, doing: `Fetching ${clip(str(input, 'url'), 60)}`, detail: `fetch · ${clip(str(input, 'url'), 70)}` }
    case 'ToolSearch':
      return { title: 'Looked up available tools', doing: 'Looking up available tools', detail: `tools · ${clip(str(input, 'query'), 60)}` }
  }
  if (tool.startsWith('mcp__')) {
    const parts = tool.split('__')
    const server = parts[1] ?? ''
    const name = parts.slice(2).join('__') || tool
    // Named servers carry the app in the server name; id-named ones carry it as the tool's first word.
    const isNamed = server !== '' && !/^[0-9a-f]{8}-/.test(server) && !server.startsWith('plugin_')
    const words = name.split('_')
    const app = isNamed ? server : (words[0] ?? name)
    const rest = isNamed ? words : words.slice(1)
    const action = rest.join(' ') || name
    const arg = firstArg(input)
    return {
      title: `${cap(app)}: ${action}`,
      doing: `Using ${cap(app)}: ${action}`,
      detail: `${app} · ${rest.join('_') || name}${arg ? ` ${arg}` : ''}`,
    }
  }
  return { title: `Used ${tool}`, doing: `Using ${tool}`, detail: tool.toLowerCase() }
}

export const sizeOf = (chars: number): Size => (chars < 3000 ? 'small' : chars < 12000 ? 'medium' : 'large')

export const fmtMs = (ms: number): string => {
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`
  const total = Math.round(ms / 1000)
  return `${Math.floor(total / 60)} min ${total % 60} s`
}

export const counts = (steps: readonly Step[]): [Cat, number][] => {
  const found: [Cat, number][] = []
  for (const cat of ORDER) {
    const n = steps.filter(step => step.cat === cat).length
    if (n > 0) found.push([cat, n])
  }
  return found
}

export type Snapshot = {
  steps: Step[]
  turn: Turn | null
  todos: Todo[]
  now: number
  phase: Phase
  asking: readonly string[]
}

/** What the model is doing between tool calls, said plainly; null when a tool is the answer. */
export const phaseText = (phase: Phase, last: Step | undefined, current: Todo | undefined): string => {
  if (phase === 'thinking') return 'Thinking it through'
  if (phase === 'writing') return 'Writing the answer'
  if (phase === 'choosing') return 'Choosing the next tool'
  if (last === undefined) return current?.activeForm ?? 'Reading your request'
  if (last.status === 'error') return `Rethinking after a failed step: ${clip(last.title, 40)}`

  return `Reviewing the result of “${clip(last.title, 40)}”`
}

/** Progress as a whole percent. Moves within a step too: n calls under it earn n / (n + 2) of its share. */
export const percentOf = (todos: readonly Todo[], steps: readonly Step[], isWorking: boolean): number | undefined => {
  if (todos.length === 0) return isWorking ? undefined : 100
  if (!isWorking) return 100
  const done = todos.filter(todo => todo.status === 'completed').length
  const current = todos.find(todo => todo.status === 'in_progress')
  const calls = current === undefined ? 0 : steps.filter(step => step.todo === current.content).length
  const partial = Math.min(0.95, calls / (calls + 2))

  return Math.min(99, Math.round(((done + partial) / todos.length) * 100))
}

/** Everything the band and the expanded view say, worked out once from the stored state. */
export const summarize = (s: Snapshot) => {
  const isWorking = s.turn !== null && s.turn.endedAt === null
  const running = isWorking ? [...s.steps].reverse().find(step => step.status === 'running') : undefined
  const others = isWorking ? s.steps.filter(step => step.status === 'running').length - 1 : 0
  const more = others > 0 ? ` (+${others} more)` : ''
  const done = s.todos.filter(todo => todo.status === 'completed').length
  const current = s.todos.find(todo => todo.status === 'in_progress')
  const next = s.todos.find(todo => todo.status === 'pending')
  const percent = percentOf(s.todos, s.steps, isWorking)
  const end = s.turn?.endedAt ?? s.now
  const elapsed = s.turn !== null && end > 0 ? Math.max(0, end - s.turn.startedAt) : 0
  const stepText =
    s.todos.length > 0
      ? `Step ${Math.min(done + 1, s.todos.length)} of ${s.todos.length}`
      : isWorking
        ? s.steps.length === 0 ? 'Starting' : `Step ${s.steps.length}`
        : s.steps.length === 0 ? 'No tool calls' : `${s.steps.length} step${s.steps.length === 1 ? '' : 's'}`
  const isAsking = running !== undefined && s.asking.includes(running.id)
  const base = running
    ? isAsking ? `Needs your approval: ${running.title}` : running.doing
    : isWorking ? phaseText(s.phase, s.steps[s.steps.length - 1], current) : 'Done'

  return { isWorking, running, isAsking, current, next, percent, elapsed, stepText, base, more, activity: `${base}${more}`, done }
}

export type Run = { cat: Cat; share: number }

/**
 * The bar as colored runs sharing 100 units. Consecutive steps of one category merge, a run's share follows how
 * long it took (square-rooted), the filled part is exactly `fill` of the bar, and at most 24 runs are kept.
 */
export const barRuns = (steps: readonly Step[], fill: number): { runs: Run[]; rest: number } => {
  const all: { cat: Cat; ms: number }[] = []
  for (const step of steps) {
    const ms = step.ms ?? 1500
    const lastRun = all[all.length - 1]
    if (lastRun !== undefined && lastRun.cat === step.cat) lastRun.ms += ms
    else all.push({ cat: step.cat, ms })
  }
  const total = steps.length === 0 ? 0 : Math.min(100, Math.max(1, Math.round(100 * fill)))
  const runs = all.slice(-Math.max(1, Math.min(total, 24)))
  const weights = runs.map(run => Math.sqrt(Math.max(300, run.ms)))
  const sum = weights.reduce((x, w) => x + w, 0) || 1
  const shares = weights.map(w => Math.max(1, Math.floor((w / sum) * total)))
  const order = weights.map((_, i) => i).sort((x, y) => weights[y]! - weights[x]!)
  let diff = total - shares.reduce((x, c) => x + c, 0)
  for (let i = 0; diff !== 0 && i < 1000 && order.length > 0; i += 1) {
    const at = order[i % order.length]!
    if (diff > 0) { shares[at]! += 1; diff -= 1 }
    else if (shares[at]! > 1) { shares[at]! -= 1; diff += 1 }
  }

  return { runs: runs.map((run, i) => ({ cat: run.cat, share: shares[i]! })), rest: 100 - shares.reduce((x, c) => x + c, 0) }
}

/** The same thing as a fraction for the bar: with a plan by progress, without one by what has run. */
export const fillOf = (percent: number | undefined, isWorking: boolean): number =>
  percent !== undefined ? percent / 100 : isWorking ? 0.7 : 1

/** Total time spent under one planned step: finished calls by their duration, running ones up to now. Null when none ran. */
export const timeUnder = (steps: readonly Step[], content: string, now: number): number | null => {
  const own = steps.filter(step => step.todo === content)
  if (own.length === 0) return null

  return own.reduce((sum, step) => sum + (step.ms ?? Math.max(0, now - step.startedAt)), 0)
}
