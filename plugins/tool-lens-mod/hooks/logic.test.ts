import { expect, test } from 'claude-code/testing'

import type { Step, Todo, Turn } from '../types'
import { barRuns, describe, fillOf, labelPrompt, needsLabel, parseLabel, percentOf, phaseText, redact, summarize, timeUnder } from './lens'

const step = (over: Partial<Step> = {}): Step => ({
  id: 'a',
  cat: 'read',
  title: 'Read routes.ts',
  doing: 'Reading routes.ts',
  todo: '',
  detail: 'read · routes.ts',
  startedAt: 0,
  ms: 1000,
  size: 'small',
  status: 'done',
  ...over,
})
const todo = (content: string, status: Todo['status']): Todo => ({ content, activeForm: `${content}…`, status })
const live: Turn = { title: 'Fix it', startedAt: 0, endedAt: null }
const over: Turn = { title: 'Fix it', startedAt: 0, endedAt: 5000 }

test('redact hides credentials but leaves ordinary text alone', () => {
  expect(redact('curl -H "Authorization: Bearer abc123def456ghi789" https://x.io')).toContain('•••')
  expect(redact('curl -H "Authorization: Bearer abc123def456ghi789" https://x.io')).not.toContain('abc123')
  expect(redact('API_TOKEN=supersecretvalue npm run deploy')).toBe('API_TOKEN=••• npm run deploy')
  expect(redact('git clone https://bob:hunter2@github.com/a/b.git')).toBe('git clone https://bob:•••@github.com/a/b.git')
  expect(redact('mytool --password hunter2 --verbose')).toBe('mytool --password ••• --verbose')
  expect(redact('export KEY=sk-ant-abcdefghijklmnopqrstuvwx')).toContain('•••')
  expect(redact('ls -la src/hooks and npm test')).toBe('ls -la src/hooks and npm test')
  const path = '/Users/me/.claude/dev-mods/70074c77-0ec9-4261-8e20-f382e12b78d8/tool-lens-mod/hooks/register.tsx'
  expect(redact(path)).toBe(path)
  expect(redact('src/components/analytics/dashboard/widgets/chart.ts')).toBe('src/components/analytics/dashboard/widgets/chart.ts')
  expect(redact('{"password": "hunter2xyz"}')).toBe('{"password": "•••"}')
  expect(redact('password: hunter2xyz')).toBe('password: •••')
  expect(redact('stripe sk_live_abcdefghijklmnop1234')).toContain('•••')
  expect(redact('token npm_abcdefghijklmnopqrstuvwxyz0123456789')).toContain('•••')
})

test('between tools the status says what the model is doing', () => {
  const last = step({ title: 'Read routes.ts' })
  expect(phaseText('thinking', last, undefined)).toBe('Thinking it through')
  expect(phaseText('writing', last, undefined)).toBe('Writing the answer')
  expect(phaseText('choosing', last, undefined)).toBe('Choosing the next tool')
  expect(phaseText('waiting', last, undefined)).toBe('Reviewing the result of “Read routes.ts”')
  expect(phaseText(null, step({ status: 'error' }), undefined)).toContain('failed step')
  expect(phaseText('waiting', undefined, undefined)).toBe('Reading your request')
  expect(phaseText('waiting', undefined, todo('Check auth', 'in_progress'))).toBe('Check auth…')
})

test('percent moves within a step and never reaches 100 until the turn ends', () => {
  const plan = [todo('a', 'completed'), todo('b', 'in_progress'), todo('c', 'pending'), todo('d', 'pending')]
  expect(percentOf([], [], true)).toBeUndefined()
  expect(percentOf([], [], false)).toBe(100)
  expect(percentOf(plan, [], true)).toBe(25)
  const one = percentOf(plan, [step({ todo: 'b' })], true)!
  const two = percentOf(plan, [step({ todo: 'b' }), step({ id: 'b', todo: 'b' })], true)!
  expect(one).toBeGreaterThan(25)
  expect(two).toBeGreaterThan(one)
  expect(two).toBeLessThan(50)
  expect(percentOf(plan.map(t => ({ ...t, status: 'completed' as const })), [], true)).toBe(99)
  expect(percentOf(plan, [], false)).toBe(100)
})

test('summarize reports running work, approval, parallel calls and the finish', () => {
  const base = { todos: [], now: 2000, phase: null, asking: [] as string[] }
  const running = step({ id: 'r', status: 'running', ms: null, doing: 'Running: npm test', title: 'npm test' })

  const live1 = summarize({ ...base, steps: [step(), running], turn: live })
  expect(live1.activity).toBe('Running: npm test')
  expect(live1.stepText).toBe('Step 2')

  const asked = summarize({ ...base, steps: [running], turn: live, asking: ['r'] })
  expect(asked.isAsking).toBe(true)
  expect(asked.base).toBe('Needs your approval: npm test')

  const twin = summarize({ ...base, steps: [running, step({ id: 's', status: 'running', ms: null })], turn: live })
  expect(twin.more).toBe(' (+1 more)')

  const done = summarize({ ...base, steps: [step(), step({ id: 'x' })], turn: over })
  expect(done.activity).toBe('Done')
  expect(done.stepText).toBe('2 steps')
  expect(done.percent).toBe(100)
  expect(done.elapsed).toBe(5000)

  const stale = summarize({ ...base, steps: [running], turn: over })
  expect(stale.running).toBeUndefined()
})

test('the bar fills exactly as far as the percent says and merges same-category runs', () => {
  const steps = [step({ id: '1' }), step({ id: '2' }), step({ id: '3', cat: 'command' }), step({ id: '4', cat: 'web' })]
  const half = barRuns(steps, 0.5)
  expect(half.runs.map(r => r.cat)).toEqual(['read', 'command', 'web'])
  expect(half.runs.reduce((n, r) => n + r.share, 0)).toBe(50)
  expect(half.rest).toBe(50)
  const full = barRuns(steps, 1)
  expect(full.rest).toBe(0)
  expect(barRuns([], 1).runs).toEqual([])
  expect(barRuns([], 1).rest).toBe(100)
  const many = Array.from({ length: 60 }, (_, i) => step({ id: String(i), cat: i % 2 === 0 ? 'read' : 'web' }))
  expect(barRuns(many, 0.1).runs.length).toBeLessThanOrEqual(10)
  expect(fillOf(undefined, true)).toBe(0.7)
  expect(fillOf(undefined, false)).toBe(1)
  expect(fillOf(40, true)).toBe(0.4)
})

test('time per planned step adds its calls and counts running ones up to now', () => {
  const steps = [
    step({ id: '1', todo: 'a', ms: 1000 }),
    step({ id: '2', todo: 'a', ms: 2500 }),
    step({ id: '3', todo: 'b', ms: null, status: 'running', startedAt: 4000 }),
  ]
  expect(timeUnder(steps, 'a', 9000)).toBe(3500)
  expect(timeUnder(steps, 'b', 9000)).toBe(5000)
  expect(timeUnder(steps, 'c', 9000)).toBeNull()
})

test('a finished turn with no tool calls still summarizes instead of vanishing', () => {
  const none = summarize({ steps: [], turn: over, todos: [], now: 5000, phase: null, asking: [] })
  expect(none.stepText).toBe('No tool calls')
  expect(none.activity).toBe('Done')
})

test('apps and skills read plainly even without a model label', () => {
  const planner = describe('mcp__plugin_ops-microsoft-planner-macos-arm64_microsoft-planner__list-premium-project-tasks', {})
  expect(planner.title).toBe('Microsoft planner: list premium project tasks')
  expect(describe('mcp__370a5e26-f945-4827-b1f5-048a4fe007d5__jira_get_issue', { issue_key: 'PROJ-482' }).title).toBe('Jira: get issue')
  expect(describe('Skill', { skill: 'tasks-sync' }).title).toBe('Used the tasks sync skill')
  expect(describe('Skill', { skill: 'plugin:tasks-sync', args: 'cobrain' }).doing).toBe('Following the tasks sync skill: cobrain')
})

test('only steps whose own wording says little are sent for a label', () => {
  expect(needsLabel('Skill', { skill: 'x' })).toBe(true)
  expect(needsLabel('ToolSearch', { query: 'x' })).toBe(true)
  expect(needsLabel('mcp__a__b', {})).toBe(true)
  expect(needsLabel('Bash', { command: 'grep -n x y' })).toBe(true)
  expect(needsLabel('Bash', { command: 'ls', description: 'List files' })).toBe(false)
  expect(needsLabel('Read', { file_path: '/a/b' })).toBe(false)
  expect(needsLabel('Grep', { pattern: 'x' })).toBe(false)
})

test('the label prompt carries the request and hides secrets in it', () => {
  const prompt = labelPrompt('what is my CoBrain tasks? token=abcd1234secret99', 'Find tasks', 'Skill', 'skill · tasks-sync')
  expect(prompt).toContain('CoBrain tasks')
  expect(prompt).toContain('Find tasks')
  expect(prompt).toContain('tasks-sync')
  expect(prompt).not.toContain('abcd1234secret99')
  expect(prompt).toContain('{"doing"')
})

test('a reply is read as a label only when it is the JSON asked for', () => {
  expect(parseLabel('{"doing":"Looking up your CoBrain tasks","done":"Looked up your CoBrain tasks."}')).toEqual({
    doing: 'Looking up your CoBrain tasks',
    done: 'Looked up your CoBrain tasks',
  })
  expect(parseLabel('Sure! {"doing":"Checking tasks","done":"Checked tasks"} hope that helps')).toEqual({ doing: 'Checking tasks', done: 'Checked tasks' })
  expect(parseLabel('no json here')).toBeNull()
  expect(parseLabel('{"doing":"","done":"x"}')).toBeNull()
  expect(parseLabel('{"doing": 5}')).toBeNull()
  expect(parseLabel('{"doing":"Using key sk-abcdefghijklmnopqrstuv","done":"Used it"}')?.doing).toContain('•••')
})
