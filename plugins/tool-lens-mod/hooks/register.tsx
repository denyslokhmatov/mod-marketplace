import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Phase, Step, Todo, Turn } from '../types'
import { CATS, barRuns, classify, clip, counts, describe, fillOf, fmtMs, sizeOf, summarize, timeUnder } from './lens'

const PLAN_TOOL = 'mcp__tool-lens-mod__plan'
const ACCENT = '#d9825b'
const GOOD = '#8fd18f'
const BAD = '#e06c6c'
const TRACK = '#2e3440'

const stepsA = atom({ plugin: 'tool-lens-mod', key: 'steps' } as const, [])
const turnA = atom({ plugin: 'tool-lens-mod', key: 'turn' } as const, null)
const todosA = atom({ plugin: 'tool-lens-mod', key: 'todos' } as const, [])
const modeA = atom({ plugin: 'tool-lens-mod', key: 'mode' } as const, 'min')
const nowA = atom({ plugin: 'tool-lens-mod', key: 'now' } as const, 0)
// The last turn that used tools, kept so a turn with no tool calls does not leave the band empty.
const prevA = atom({ plugin: 'tool-lens-mod', key: 'prev' } as const, null)
const phaseA = atom({ plugin: 'tool-lens-mod', key: 'phase' } as const, null)
// Calls the engine put to the permission dialog (the person decides), by tool_use_id.
const askingA = atom({ plugin: 'tool-lens-mod', key: 'asking' } as const, [])

// A bar of colored runs, laid out in percent of its own width so it fits whatever a "cell" measures on the
// surface (glyph widths differ between the terminal and the desktop). The shares come from `barRuns`.
const bar = (ui: any, steps: Step[], width: number | string, fill: number, isGapped = false, isThin = false) => {
  const { Box, Text } = ui
  const { runs, rest } = barRuns(steps, fill)

  const body = (
    <Box width="100%">
      {runs.map(run => (
        <Box width={`${run.share}%`}>
          <Box flexGrow={1} backgroundColor={CATS[run.cat].color}>
            <Text> </Text>
          </Box>
          {isGapped && run.share >= 4 && <Box width={`${Math.max(1, Math.round(40 / run.share))}%`} flexShrink={0} />}
        </Box>
      ))}
      {rest > 0 && (
        <Box width={`${rest}%`} backgroundColor={TRACK}>
          <Text> </Text>
        </Box>
      )}
    </Box>
  )

  // Thin (the band on the desktop): half a row tall, centred in its row.
  if (isThin) {
    return (
      <Box width={width} height={1} alignItems="center">
        <Box width="100%" height="50%">
          {body}
        </Box>
      </Box>
    )
  }

  return <Box width={width}>{body}</Box>
}

const pairs = <T,>(list: T[]): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += 2) out.push(list.slice(i, i + 2))
  return out
}

const badge = (ui: any, percent: number | undefined) => {
  const { Text } = ui
  return percent === undefined ? null : (
    <Text backgroundColor={GOOD} color="#10210f" bold>{` ${percent}% `}</Text>
  )
}

const glyph = (step: Step) =>
  step.status === 'done' ? { ch: '✓', color: GOOD } : step.status === 'error' ? { ch: '✗', color: BAD } : { ch: '●', color: ACCENT }

const row = (ui: any, step: Step, now: number, width: number, onPress: () => void, room: number) => {
  const { Box, Text, Button } = ui
  const g = glyph(step)
  const ms = step.ms ?? Math.max(0, now - step.startedAt)

  return (
    <Box flexDirection="column">
      <Text dimColor wrap="truncate-end">{'─'.repeat(width)}</Text>
      <Box justifyContent="space-between" gap={2}>
        <Box gap={1} flexShrink={1}>
          <Text color={g.color}>{g.ch}</Text>
          <Text color={CATS[step.cat].color}>■</Text>
          <Button key={`s-${step.id}`} plain label={clip(step.status === 'running' ? `${step.doing}…` : step.title, room)} onPress={onPress} />
        </Box>
        <Text dimColor>{fmtMs(ms)}</Text>
      </Box>
      <Box justifyContent="space-between" gap={2}>
        <Box marginLeft={4} flexShrink={1}>
          <Text dimColor wrap="truncate-end">{step.detail}</Text>
        </Box>
        <Text dimColor>{step.size ?? ''}</Text>
      </Box>
    </Box>
  )
}

async function setMode($: any, mode: 'min' | 'max') {
  await update($, modeA, () => mode)
}

// One line per step, for when the full rows would not fit in the band.
const compactRow = (ui: any, step: Step, now: number, onPress: () => void, room: number) => {
  const { Box, Text, Button } = ui
  const g = glyph(step)
  const ms = step.ms ?? Math.max(0, now - step.startedAt)

  return (
    <Box justifyContent="space-between" gap={2} flexGrow={1}>
      <Box gap={1} flexShrink={1}>
        <Text color={g.color}>{g.ch}</Text>
        <Text color={CATS[step.cat].color}>■</Text>
        <Button key={`s-${step.id}`} plain label={clip(step.status === 'running' ? `${step.doing}…` : step.title, room)} onPress={onPress} />
      </Box>
      <Text dimColor>{fmtMs(ms)}</Text>
    </Box>
  )
}

let lastPhase: Phase = null

// The phase changes a few times a turn; writing it only when it differs keeps the band from redrawing per chunk.
async function setPhase($: any, phase: Phase) {
  if (phase === lastPhase) return
  lastPhase = phase
  await update($, phaseA, () => phase)
}

async function clearAsking($: any) {
  if ((await read($, askingA)).length > 0) await update($, askingA, () => [])
}

export const register: Register = on => {
  let isWorking = false

  on('session.start', async ($, e, next) => {
    await update($, modeA, () => 'min')
    await $.tool.register({
      name: 'plan',
      description:
        'Shows the person your plan as a live checklist. Call it first for any task that needs three or more tool calls, then again as each step finishes. One step in_progress at a time.',
      inputSchema: {
        type: 'object',
        properties: {
          steps: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                content: { type: 'string', description: 'The step, short and imperative: "Check the auth config"' },
                activeForm: { type: 'string', description: 'The same step while it runs: "Checking the auth config"' },
                status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
              },
              required: ['content', 'activeForm', 'status'],
            },
          },
        },
        required: ['steps'],
      },
    })
    await $.command.register({
      name: 'lens',
      description: 'Tool lens view: /lens min (one line) or /lens max (expanded, grows upward)',
    })
    // One ticker for the whole session keeps elapsed times live while a turn runs.
    $.clock.every(1000, () => {
      if (isWorking) void $.clock.now().then(n => update($, nowA, () => n))
    })

    return next(e)
  })

  on('command.run', { command: 'lens' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const current = await read($, modeA)
    const mode = arg === 'min' || arg === 'max' ? arg : current === 'min' ? 'max' : 'min'
    await setMode($, mode)

    return { text: mode === 'max' ? 'Tool lens expanded.' : 'Tool lens minimised.' }
  })

  on('prompt.compose', async ($, e, next) => {
    const out = await next(e)
    const text =
      'Tool lens: for a task that needs three or more tool calls, first call ' +
      `${PLAN_TOOL} with every step you plan (status pending, the first one in_progress). ` +
      'Call it again whenever a step finishes or the plan changes, keeping exactly one step in_progress. ' +
      'If a TodoWrite tool is available, use it instead. Skip this for quick one-step questions.'

    return { sections: [...out.sections, { id: 'tool-lens-plan', text, scope: 'session' }] }
  })

  // The turn's own request stream says what the model is doing: thinking, writing, or picking a tool.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)

    await setPhase($, 'waiting')
    await clearAsking($)
    const stream = next(e)
    while (true) {
      const item = await stream.next()
      if (item.done) {
        await setPhase($, null)
        return item.value
      }
      const kind = item.value.kind
      if (kind === 'thinking') await setPhase($, 'thinking')
      else if (kind === 'text') await setPhase($, 'writing')
      else if (kind === 'tool') await setPhase($, 'choosing')
      yield item.value
    }
  })

  // A call the engine puts to the permission dialog: the person, not the agent, is the one being waited on.
  on('tool.check', async ($, e, next) => {
    const answer = await next(e)
    const id = e.tool_use_id
    if (id !== undefined && answer.decision === 'ask') await update($, askingA, list => [...list, id])

    return answer
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    const now = await $.clock.now()
    isWorking = true
    const line = clip(e.text.split('\n')[0] ?? '', 70)
    const before = await read($, stepsA)
    if (before.length > 0) {
      const beforeTurn = await read($, turnA)
      await update($, prevA, () => ({ steps: before, turn: beforeTurn }))
    }
    await clearAsking($)
    await setPhase($, 'waiting')
    await update($, stepsA, () => [])
    await update($, todosA, list => (list.every(t => t.status === 'completed') ? [] : list))
    await update($, nowA, () => now)
    await update($, turnA, old => ({ title: line || old?.title || 'Working', startedAt: now, endedAt: null }))

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    // A helper agent's own turns end here too; only the main task's end counts.
    if (e.agentId !== undefined) return next(e)

    const now = await $.clock.now()
    isWorking = false
    await clearAsking($)
    await setPhase($, null)
    // A turn that ran no tools shows the last turn that did, instead of an empty band.
    const prev = await read($, prevA)
    if ((await read($, stepsA)).length === 0 && prev !== null) {
      await update($, stepsA, () => prev.steps)
      await update($, turnA, () => prev.turn)
      return next(e)
    }
    await update($, turnA, old => (old === null ? old : { ...old, endedAt: now }))
    await update($, nowA, () => now)
    await update($, stepsA, list =>
      list.map(one => (one.status === 'running' ? { ...one, ms: now - one.startedAt, size: 'small', status: 'error' } : one)),
    )

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)

    const tool = String(e.tool)
    const input = e as unknown as Record<string, unknown>

    if (tool === 'TodoWrite' || tool === PLAN_TOOL) {
      const list = (tool === 'TodoWrite' ? input.todos : input.steps) as Todo[] | undefined
      if (Array.isArray(list)) await update($, todosA, () => list)
      return tool === PLAN_TOOL ? { result: 'Plan saved. Carry on with the first step.' } : next(e)
    }

    const planned = await read($, todosA)
    const todo = planned.find(item => item.status === 'in_progress')?.content ?? ''

    const started = await $.clock.now()
    const { title, doing, detail } = describe(tool, input)
    const id = e.tool_use_id
    const step: Step = { id, cat: classify(tool), title, doing, todo, detail, startedAt: started, ms: null, size: null, status: 'running' }
    await update($, stepsA, list => [...list, step].slice(-200))

    let ran
    try {
      ran = await next(e)
    } catch (error) {
      await update($, askingA, list => list.filter(one => one !== id))
      const spent = (await $.clock.now()) - started
      await update($, stepsA, list =>
        list.map(one => (one.id === id ? { ...one, ms: spent, size: 'small', status: 'error' } : one)),
      )
      throw error
    }

    await update($, askingA, list => list.filter(one => one !== id))
    const ms = (await $.clock.now()) - started
    const failed = ran.deny !== undefined || ran.isError === true
    const size = sizeOf((ran.text ?? '').length)
    await update($, stepsA, list =>
      list.map(one => (one.id === id ? { ...one, ms, size, status: failed ? 'error' : 'done' } : one)),
    )

    return ran
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const steps = await read($, stepsA)
    const mode = await read($, modeA)
    const hasTurn = (await read($, turnA)) !== null

    // Stay on screen once a turn has happened, even one with no tool calls (or only a plan); only a survey, or
    // having no history at all, hides it.
    if (e.props.hasSurvey || (steps.length === 0 && !hasTurn)) {
      return next(e)
    }

    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const [seen, todos, now] = [await read($, turnA), await read($, todosA), await read($, nowA)]
    const [phase, asking] = [await read($, phaseA), await read($, askingA)]
    // Steps without a turn (the module reloaded mid-session) still draw, under a neutral title.
    const turn: Turn = seen ?? { title: 'Activity', startedAt: now, endedAt: now }
    const v = summarize({ steps, turn, todos, now, phase, asking })
    const fill = fillOf(v.percent, v.isWorking)

    if (mode === 'min') {
      const cols = e.props.bodyColumns
      const expand = () => setMode($, 'max')
      const hasBadge = v.percent !== undefined && cols >= 40
      const expandLabel = cols >= 50 ? 'Expand ⤢' : '⤢'
      const barWidth = Math.max(4, Math.min(28, Math.floor(cols * 0.25)))
      // Everything that can be a Button is one, so a click almost anywhere on the line expands it; only the
      // colored bar and the percent badge cannot (a Button's label is plain text). The status is cut to fit.
      const gaps = hasBadge ? 5 : 4
      const fixed = 1 + v.stepText.length + barWidth + (hasBadge ? 6 : 0) + expandLabel.length + gaps
      const room = Math.max(4, cols - fixed)
      const cut = (text: string, max: number) => (text.length > max ? text.slice(0, Math.max(1, max - 1)).trimEnd() : text)
      const status = v.isWorking
        ? `${cut(v.base, room - v.more.length - 1)}…${v.more}`
        : clip(`${v.base} · ${fmtMs(v.elapsed)}`, room)

      return (
        <Box gap={1}>
          <Text color={ACCENT}>◆</Text>
          <Button key="step" plain label={v.stepText} onPress={expand} />
          {bar(ui, steps, barWidth, fill, false, e.surface === 'desktop')}
          <Box flexGrow={1}>
            <Button key="status" plain dimColor label={status} onPress={expand} />
          </Box>
          {hasBadge && badge(ui, v.percent)}
          <Button key="expand" plain dimColor label={expandLabel} onPress={expand} />
        </Box>
      )
    }

    // Expanded: the band grows upward into the full view, as many step rows as the band may take.
    const width = Math.max(10, e.props.bodyColumns - 2)
    // Every line of the expanded view is a Button that collapses it, as every part of the band expands it.
    const collapse = () => setMode($, 'min')
    const room = Math.max(10, e.props.bodyColumns - 24)
    const legendRows = Math.ceil(counts(steps).length / 2)
    const budget = e.props.maxRows - 9 - legendRows
    const isFull = steps.length * 3 <= budget
    const shown = isFull ? steps : steps.slice(-40)

    return (
      <Box flexDirection="column" paddingX={1}>
        <Box justifyContent="space-between">
          <Box gap={1} flexShrink={1}>
            <Text color={ACCENT}>◆</Text>
            <Button key="title" plain label={clip(turn.title, room)} onPress={collapse} />
          </Box>
          <Box gap={1}>
            {badge(ui, v.percent)}
            <Button key="minimise" plain dimColor label="Minimise ⌄" onPress={() => setMode($, 'min')} />
          </Box>
        </Box>
        <Button
          key="sub"
          plain
          dimColor
          label={clip(`  ${v.stepText} · ${v.activity} · ${v.isWorking ? 'running for' : 'took'} ${fmtMs(v.elapsed)}`, e.props.bodyColumns - 4)}
          onPress={collapse}
        />
        <Box marginY={1}>{bar(ui, steps, '100%', fill, true)}</Box>
        <Box flexDirection="column">
          {pairs(counts(steps)).map(pair => (
            <Box>
              {pair.map(([cat, n]) => (
                <Box width="50%">
                  <Box gap={1}>
                    <Text color={CATS[cat].color}>■</Text>
                    <Button key={`l-${cat}`} plain label={`${CATS[cat].label} ${n}`} onPress={collapse} />
                  </Box>
                </Box>
              ))}
            </Box>
          ))}
        </Box>
        <Box flexDirection="column" marginTop={1}>
          {todos.length > 0 ? (
            <Box flexDirection="column">
              {steps.filter(step => step.todo === '' || !todos.some(item => item.content === step.todo)).map(step => compactRow(ui, step, now, collapse, room))}
              {todos.map((item, i) => (
                <Box flexDirection="column">
                  <Box justifyContent="space-between" gap={2}>
                    <Box gap={1} flexShrink={1}>
                      <Text color={item.status === 'completed' ? GOOD : item.status === 'in_progress' ? ACCENT : '#8a8f98'} dimColor={item.status === 'pending'}>
                        {item.status === 'completed' ? '✓' : item.status === 'in_progress' ? '●' : '○'}
                      </Text>
                      <Button key={`t-${i}`} plain dimColor={item.status === 'pending'} label={clip(item.status === 'in_progress' ? item.activeForm : item.content, room)} onPress={collapse} />
                    </Box>
                    {timeUnder(steps, item.content, now) !== null && <Text dimColor>{fmtMs(timeUnder(steps, item.content, now)!)}</Text>}
                  </Box>
                  {steps.filter(step => step.todo === item.content).slice(-6).map(step => (
                    <Box marginLeft={3}>{compactRow(ui, step, now, collapse, room)}</Box>
                  ))}
                </Box>
              ))}
            </Box>
          ) : (
            <Box flexDirection="column">
              {steps.length > shown.length && <Button key="earlier" plain dimColor label={`… ${steps.length - shown.length} earlier`} onPress={collapse} />}
              {shown.map(step => (isFull ? row(ui, step, now, width, collapse, room) : compactRow(ui, step, now, collapse, room)))}
            </Box>
          )}
        </Box>
      </Box>
    )
  })
}
