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
