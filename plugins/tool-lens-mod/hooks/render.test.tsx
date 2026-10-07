import { expect, mock, test } from 'claude-code/testing'

// The band must draw in both modes, on both surfaces, with and without a plan: a tree the engine refuses is
// simply not drawn, which is how an expanded view once went missing.
test('the band draws expanded and minimised, with and without a plan', async ($, on) => {
  mock.clock(on)
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  await $.tool.call({ tool: 'Read', file_path: '/a/b.ts' })
  await $.tool.call({ tool: 'Bash', command: 'ls', description: 'List files' })

  for (const plan of [false, true]) {
    if (plan) {
      await $.tool.call({
        tool: 'mcp__tool-lens-mod__plan',
        steps: [
          { content: 'Read it', activeForm: 'Reading it', status: 'completed' },
          { content: 'Run it', activeForm: 'Running it', status: 'in_progress' },
          { content: 'Wrap up', activeForm: 'Wrapping up', status: 'pending' },
        ],
      } as never)
    }
    for (const surface of ['terminal', 'desktop'] as const) {
      await $.command.run({ command: 'lens', args: 'max' } as never)
      const ui = await $.ui.mount({
        plugin: 'tool-lens-mod',
        surface,
        component: 'AbovePrompt',
        props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100 },
      } as never)
      expect(await ui.find({ key: 'minimise' })).toBeDefined()
      await ui.press({ key: 'minimise' })
      expect(await ui.find({ key: 'expand' })).toBeDefined()
      await ui.press({ key: 'expand' })
      expect(await ui.find({ key: 'minimise' })).toBeDefined()
      await ui.unmount()
    }
  }
})
