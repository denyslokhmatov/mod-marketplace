import { expect, mock, test } from 'claude-code/testing'

const props = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100 }
const usage = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
const REPLY = '{"doing":"Looking up your CoBrain tasks","done":"Looked up your CoBrain tasks"}'

async function stepTitles($: any, surface: 'terminal' | 'desktop') {
  const ui = await $.ui.mount({ plugin: 'tool-lens-mod', surface, component: 'AbovePrompt', props })
  if ((await ui.find({ key: 'expand' })) !== undefined) await ui.press({ key: 'expand' })
  const found = await ui.findAll({ type: 'Button' })
  await ui.unmount()

  return found.map((one: { text?: string }) => one.text ?? '')
}

test('a skill step is relabelled in terms of the request, and the model sees only redacted text', async ($, on) => {
  const clock = mock.clock(on)
  const prompts: string[] = []
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('model.complete', (_$, e) => {
    prompts.push(e.prompt)

    return { value: { isAnswered: true, text: REPLY, usage } }
  })

  await $.turn.start({ text: 'what is my CoBrain tasks? token=abcd1234secret99', turnId: 't1' })
  await $.tool.call({ tool: 'Skill', skill: 'tasks-sync' } as never)
  await clock.advance(50)

  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('CoBrain tasks')
  expect(prompts[0]).not.toContain('abcd1234secret99')
  for (const surface of ['terminal', 'desktop'] as const) {
    const titles = await stepTitles($, surface)
    expect(titles.join('|')).toContain('Looked up your CoBrain tasks')
    expect(titles.join('|')).not.toContain('abcd1234secret99')
  }
})

test('a model that fails or answers badly leaves the built-in wording', async ($, on) => {
  const clock = mock.clock(on)
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('model.complete', () => ({ value: { isAnswered: true, text: 'sorry, no json', usage } }))

  await $.turn.start({ text: 'what is my CoBrain tasks?', turnId: 't2' })
  await $.tool.call({ tool: 'Skill', skill: 'tasks-sync' } as never)
  await clock.advance(50)

  const titles = await stepTitles($, 'terminal')
  expect(titles.join('|')).toContain('Used the tasks sync skill')
})
