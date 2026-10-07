import { expect, mock, test } from 'claude-code/testing'

const props = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100 }
const done = (extra: Record<string, unknown> = {}) =>
  ({ turnId: 't1', answer: 'ok', durationMs: 10, isAborted: false, reason: 'end_turn', ...extra }) as never

// The band must still be there after the task completes, with or without tools, and a helper agent finishing
// in the middle of a task must not end the main task early.
test('the band survives a task completing', async ($, on) => {
  mock.clock(on)
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: 'ok' }))

  for (const surface of ['terminal', 'desktop'] as const) {
    await $.turn.start({ text: 'do the thing', turnId: 't1' })
    await $.tool.call({ tool: 'Read', file_path: '/a/b.ts' })
    await $.turn.complete(done({ agentId: 'helper-1' }))

    const mid = await $.ui.mount({ plugin: 'tool-lens-mod', surface, component: 'AbovePrompt', props } as never)
    expect(await mid.find({ key: 'status' })).toBeDefined()
    expect((await mid.find({ key: 'status' }))?.text).not.toMatch(/^Done/)
    await mid.unmount()

    await $.turn.complete(done())
    const end = await $.ui.mount({ plugin: 'tool-lens-mod', surface, component: 'AbovePrompt', props } as never)
    expect(await end.find({ key: 'expand' })).toBeDefined()
    expect((await end.find({ key: 'status' }))?.text).toMatch(/^Done/)
    await end.unmount()

    // a task with no tools still leaves the previous one's summary on screen
    await $.turn.start({ text: 'just chat', turnId: 't2' })
    await $.turn.complete(done({ turnId: 't2' }))
    const chat = await $.ui.mount({ plugin: 'tool-lens-mod', surface, component: 'AbovePrompt', props } as never)
    expect(await chat.find({ key: 'expand' })).toBeDefined()
    await chat.unmount()
  }
})

test('/lens answers settings and unknown words with help instead of toggling', async $ => {
  const before = await $.command.run({ command: 'lens', args: 'settings' } as never)
  expect(before.text).toContain('smartLabels')
  expect(before.text).toContain('labels on|off')
  const odd = await $.command.run({ command: 'lens', args: 'whatever' } as never)
  expect(odd.text).toContain('/lens labels on|off')
  const max = await $.command.run({ command: 'lens', args: 'max' } as never)
  expect(max.text).toBe('Tool lens expanded.')
  const again = await $.command.run({ command: 'lens', args: 'settings' } as never)
  expect(again.text).toContain('expanded')
})

test('every prompt carries the plan reminder as hidden context, and /lens off withdraws it', async ($, on) => {
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }) as never)
  const sent = await ($ as any).prompt.submit({ text: 'find where X is configured and summarize it' })
  expect(JSON.stringify(sent.context)).toContain('mcp__tool-lens-mod__plan')
  expect(sent.text).toBe('find where X is configured and summarize it')

  await $.command.run({ command: 'lens', args: 'off' } as never)
  const quiet = await ($ as any).prompt.submit({ text: 'again' })
  expect(JSON.stringify(quiet.context ?? [])).not.toContain('mcp__tool-lens-mod__plan')
  await $.command.run({ command: 'lens', args: 'on' } as never)
})

test('/lens off hides the band and stops tracking, /lens on brings it back', async ($, on) => {
  mock.clock(on)
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: 'ok' }))

  const off = await $.command.run({ command: 'lens', args: 'off' } as never)
  expect(off.text).toContain('off')
  await $.turn.start({ text: 'while off', turnId: 'o1' })
  await $.tool.call({ tool: 'Read', file_path: '/a/b.ts' })
  await $.turn.complete(done({ turnId: 'o1' }))
  const plan = await $.tool.call({ tool: 'mcp__tool-lens-mod__plan', steps: [] } as never)
  expect(JSON.stringify(plan)).toContain('lens is off')
  const toggled = await $.command.run({ command: 'lens', args: 'max' } as never)
  expect(toggled.text).toContain('off')
  expect((await $.command.run({ command: 'lens', args: 'settings' } as never)).text).toContain('off')

  await $.command.run({ command: 'lens', args: 'on' } as never)
  // nothing was tracked while off, so the plugin draws nothing and passes the band on (the test has nothing beneath)
  const isHidden = await $.ui
    .mount({ plugin: 'tool-lens-mod', surface: 'terminal', component: 'AbovePrompt', props } as never)
    .then(
      () => false,
      () => true,
    )
  expect(isHidden).toBe(true)

  await $.turn.start({ text: 'now on', turnId: 'o2' })
  await $.tool.call({ tool: 'Read', file_path: '/a/b.ts' })
  await $.turn.complete(done({ turnId: 'o2' }))
  const shown = await $.ui.mount({ plugin: 'tool-lens-mod', surface: 'terminal', component: 'AbovePrompt', props } as never)
  expect(await shown.find({ key: 'expand' })).toBeDefined()
  expect((await shown.find({ key: 'step' }))?.text).toBe('1 step')
  await shown.unmount()
})

test('the plan tool is listed in front of the model, not behind tool search', async ($, on) => {
  on('tool.describe', (_$, e) => ({ description: e.description, isDeferred: true as const }))
  const out = await ($ as any).tool.describe({
    tool: 'mcp__tool-lens-mod__plan',
    description: 'plan',
    isDeferred: true,
    provider: { plugin: 'tool-lens-mod', tier: 'user' },
  })
  expect(out.isDeferred).toBe(false)
  const other = await ($ as any).tool.describe({
    tool: 'mcp__someone-else__thing',
    description: 'other',
    isDeferred: true,
    provider: { plugin: 'x', tier: 'user' },
  })
  expect(other.isDeferred).toBe(true)
})

const plan = (steps: { content: string; activeForm: string; status: string }[]) =>
  ({ tool: 'mcp__tool-lens-mod__plan', steps }) as never

test('a task that was stopped says so, and its open plan does not leak into the next task', async ($, on) => {
  mock.clock(on)
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: 'ok' }))
  const band = async () =>
    $.ui.mount({ plugin: 'tool-lens-mod', surface: 'terminal', component: 'AbovePrompt', props } as never)

  await $.turn.start({ text: 'first', turnId: 's1' })
  await $.tool.call(plan([
    { content: 'A', activeForm: 'Doing A', status: 'completed' },
    { content: 'B', activeForm: 'Doing B', status: 'in_progress' },
    { content: 'C', activeForm: 'Doing C', status: 'pending' },
  ]))
  await $.tool.call({ tool: 'Read', file_path: '/a/b.ts' })
  await $.turn.complete(done({ turnId: 's1', isAborted: true, reason: 'aborted' }))

  const stopped = await band()
  expect((await stopped.find({ key: 'status' }))?.text).toMatch(/^Stopped/)
  expect(await stopped.find({ key: 'status' })).toBeDefined()
  await stopped.unmount()

  // the next task starts while the first one's plan is still open (B in progress, C pending)
  await $.turn.start({ text: 'second', turnId: 's2' })
  await $.tool.call({ tool: 'Read', file_path: '/c/d.ts' })
  await $.turn.complete(done({ turnId: 's2' }))
  const next = await band()
  expect((await next.find({ key: 'step' }))?.text).toBe('1 step')
  expect((await next.find({ key: 'status' }))?.text).toMatch(/^Done/)
  await next.unmount()
})

test('a task that never reported its end is closed when the next one starts', async ($, on) => {
  mock.clock(on)
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: 'ok' }))

  await $.turn.start({ text: 'dies mid-way', turnId: 'x1' })
  await $.tool.call({ tool: 'Read', file_path: '/a/b.ts' })
  // no turn.complete: the task failed without reporting. The next one starts and uses no tools.
  await $.turn.start({ text: 'just chat', turnId: 'x2' })
  await $.turn.complete(done({ turnId: 'x2' }))
  const ui = await $.ui.mount({ plugin: 'tool-lens-mod', surface: 'terminal', component: 'AbovePrompt', props } as never)
  const status = (await ui.find({ key: 'status' }))?.text ?? ''
  expect(status).toMatch(/^Stopped/)
  expect(status).not.toMatch(/…$/)
  await ui.unmount()
})

const setup = ($: any, on: any) => {
  mock.clock(on)
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  on('turn.start', (_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: 'ok' }))
}
const read = (n: number) => ({ tool: 'Read', file_path: `/a/${n}.ts` }) as never

test('the third tool call of a task with no plan is refused once, then the task goes on', async ($, on) => {
  setup($, on)
  await $.turn.start({ text: 'multi-step', turnId: 'g1' })
  expect((await $.tool.call(read(1))).deny).toBeUndefined()
  expect((await $.tool.call(read(2))).deny).toBeUndefined()
  const refused = await $.tool.call(read(3))
  expect(refused.deny).toContain('mcp__tool-lens-mod__plan')
  expect(refused.deny).toContain('repeat this call')
  // refused only once: the repeat goes through even if the model still has no plan
  expect((await $.tool.call(read(3))).deny).toBeUndefined()
  expect((await $.tool.call(read(4))).deny).toBeUndefined()
  await $.turn.complete(done({ turnId: 'g1' }))

  // a refused call is not a step: 4 calls ran, so 4 steps
  const ui = await $.ui.mount({ plugin: 'tool-lens-mod', surface: 'terminal', component: 'AbovePrompt', props } as never)
  expect((await ui.find({ key: 'step' }))?.text).toBe('4 steps')
  await ui.unmount()
})

test('a plan posted in time means no refusal, and the count restarts with each task', async ($, on) => {
  setup($, on)
  await $.turn.start({ text: 'planned', turnId: 'g2' })
  await $.tool.call(read(1))
  await $.tool.call(plan([{ content: 'A', activeForm: 'Doing A', status: 'in_progress' }]))
  for (const n of [2, 3, 4, 5]) expect((await $.tool.call(read(n))).deny).toBeUndefined()
  await $.turn.complete(done({ turnId: 'g2' }))

  await $.turn.start({ text: 'unplanned again', turnId: 'g3' })
  await $.tool.call(read(1))
  await $.tool.call(read(2))
  expect((await $.tool.call(read(3))).deny).toBeDefined()
})

test('tool lookups do not count towards the gate, and TodoWrite counts as a plan', async ($, on) => {
  setup($, on)
  await $.turn.start({ text: 'lookups', turnId: 'g4' })
  for (let i = 0; i < 4; i += 1) {
    expect((await $.tool.call({ tool: 'ToolSearch', query: 'x', max_results: 1 } as never)).deny).toBeUndefined()
  }
  await $.tool.call(read(1))
  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'A', activeForm: 'Doing A', status: 'in_progress' }] } as never)
  for (const n of [2, 3, 4]) expect((await $.tool.call(read(n))).deny).toBeUndefined()
})

test('/lens off and the requirePlan option both switch the gate off', async ($, on) => {
  setup($, on)
  await $.command.run({ command: 'lens', args: 'off' } as never)
  await $.turn.start({ text: 'off', turnId: 'g5' })
  for (const n of [1, 2, 3, 4]) expect((await $.tool.call(read(n))).deny).toBeUndefined()
})

test('requirePlan: false never refuses', { options: { requirePlan: false } }, async ($, on) => {
  setup($, on)
  await $.turn.start({ text: 'free', turnId: 'g6' })
  for (const n of [1, 2, 3, 4]) expect((await $.tool.call(read(n))).deny).toBeUndefined()
})
