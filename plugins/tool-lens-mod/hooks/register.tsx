import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Phase, Step, Todo, Turn } from '../types'
import { CATS, barRuns, classify, clip, counts, describe, fillOf, fmtMs, labelPrompt, needsLabel, parseLabel, redact, sizeOf, summarize, timeUnder } from './lens'

const PLAN_TOOL = 'mcp__tool-lens-mod__plan'
const PLAN_REMINDER =
  `Tool lens: if this task needs three or more tool calls, first call ${PLAN_TOOL} with every step you plan ` +
  '(status pending, the first one in_progress), and call it again as each step finishes, keeping exactly one ' +
  'in_progress. If a TodoWrite tool is available, use it instead. Skip this for quick one-step questions.'
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
// /lens off: nothing is tracked, drawn, labelled or asked of the model until /lens on.
const enabledA = atom({ plugin: 'tool-lens-mod', key: 'enabled' } as const, true)

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
let request = ''
let inflight = 0
const labels = new Map<string, { doing: string; done: string }>()

// Asks a small model for a plain label of a step in the person's own terms, then swaps it in. Any failure leaves the
// built-in wording, which is already there. The prompt carries redacted text only.
async function relabel($: any, id: string, key: string, prompt: string) {
  let label = labels.get(key)
  if (label === undefined) {
    if (inflight >= 3) return
    inflight += 1
    try {
      const reply = await $.model.complete({ model: 'haiku', prompt, maxTokens: 100 })
      label = reply.isAnswered ? (parseLabel(reply.text) ?? undefined) : undefined
    } finally {
      inflight -= 1
    }
    if (label === undefined) return
    labels.set(key, label)
  }
  const found = label
  await update($, stepsA, list => list.map(one => (one.id === id ? { ...one, title: found.done, doing: found.doing } : one)))
}

// The phase changes a few times a turn; writing it only when it differs keeps the band from redrawing per chunk.
async function setPhase($: any, phase: Phase) {
  if (phase === lastPhase) return
  lastPhase = phase
  await update($, phaseA, () => phase)
}

async function clearAsking($: any) {
  if ((await read($, askingA)).length > 0) await update($, askingA, () => [])
}

export const register: Register = (on, options) => {
  const isSmart = options.smartLabels !== false
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
      description: 'Tool lens: /lens (toggle), /lens min, /lens max, /lens labels on|off, /lens settings',
    })
    // One ticker for the whole session keeps elapsed times live while a turn runs.
    $.clock.every(1000, () => {
      if (isWorking) void $.clock.now().then(n => update($, nowA, () => n))
    })

    return next(e)
  })

  on('command.run', { command: 'lens' }, async ($, e) => {
    const [word, value] = e.args.trim().toLowerCase().split(/\s+/)
    const current = await read($, modeA)
    const isOn = await read($, enabledA)
    const help =
      `Tool lens: ${isOn ? `on, view ${current === 'max' ? 'expanded' : 'minimised'}` : 'off'}, plain-language labels ${isSmart ? 'on' : 'off'}.\n` +
      '/lens off | on  hide it and stop tracking, or bring it back\n' +
      '/lens          toggle expanded / minimised\n' +
      '/lens min|max  set the view\n' +
      '/lens labels on|off   reword skill, app and shell steps with a small model (setting: smartLabels)\n' +
      '/lens settings        this summary'

    if (word === 'off' || word === 'on') {
      await update($, enabledA, () => word === 'on')
      if (word === 'off') {
        // A task running right now will never reach turn.complete here, so end the clock's work and the phase too.
        isWorking = false
        await clearAsking($)
        await setPhase($, null)
      }

      return {
        text:
          word === 'on'
            ? 'Tool lens on.'
            : 'Tool lens off: nothing is tracked or drawn. /lens on brings it back. The model is no longer asked to post a plan.',
      }
    }
    if (!isOn && (word === undefined || word === '' || word === 'min' || word === 'max')) {
      return { text: 'Tool lens is off. /lens on turns it back on.' }
    }
    if (word === undefined || word === '') {
      const mode = current === 'min' ? 'max' : 'min'
      await setMode($, mode)

      return { text: mode === 'max' ? 'Tool lens expanded.' : 'Tool lens minimised.' }
    }
    if (word === 'min' || word === 'max') {
      await setMode($, word)

      return { text: word === 'max' ? 'Tool lens expanded.' : 'Tool lens minimised.' }
    }
    if (word === 'labels' && (value === 'on' || value === 'off')) {
      try {
        const done = await $.config.set({ key: 'tool-lens-mod.smartLabels', value: value === 'on' })
        if ('deny' in done && done.deny !== undefined) return { text: `Could not change the setting: ${done.deny}` }
      } catch {
        return { text: `Could not change the setting here. Set smartLabels to ${value === 'on'} under this plugin's options in the config menu or settings.json.` }
      }

      return { text: `Plain-language labels ${value}. The mod reloads to apply it.` }
    }

    return { text: help }
  })

  // On a machine with many connected apps the engine lists every MCP tool behind ToolSearch, where the model never
  // finds a tool it was not asked to look for. The plan tool is the one it must reach without searching.
  on('tool.describe', { tool: PLAN_TOOL }, async ($, e, next) => ({ ...(await next(e)), isDeferred: false }))

  // Asks the model to post its plan first. It rides each prompt as hidden context: the composed system prompt is not
  // a reliable place (a live helper agent never saw it), and this way /lens off takes it back at once.
  on('prompt.submit', async ($, e, next) => {
    if (!(await read($, enabledA))) return next(e)

    return next({ ...e, context: [...(e.context ?? []), PLAN_REMINDER] })
  }).catch(($, e, next) => next(e))

  // The turn's own request stream says what the model is doing: thinking, writing, or picking a tool.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined || !(await read($, enabledA))) return yield* next(e)

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
    if (id !== undefined && answer.decision === 'ask' && (await read($, enabledA))) await update($, askingA, list => [...list, id])

    return answer
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    if (!(await read($, enabledA))) return next(e)

    const now = await $.clock.now()
    isWorking = true
    request = e.text
    const line = clip(redact(e.text.split('\n')[0] ?? ''), 70)
    // The previous task may never have reported its end (interrupted, failed): close it as stopped, so what is kept
    // for a later no-tool turn is not left looking live, and drop its plan so open steps do not leak into this task.
    const before = await read($, stepsA)
    if (before.length > 0) {
      const beforeTurn = await read($, turnA)
      const closed = before.map(one =>
        one.status === 'running' ? { ...one, ms: now - one.startedAt, size: 'small' as const, status: 'error' as const } : one,
      )
      const ended = beforeTurn === null ? null : { ...beforeTurn, endedAt: beforeTurn.endedAt ?? now, reason: beforeTurn.reason ?? ('aborted' as const) }
      await update($, prevA, () => ({ steps: closed, turn: ended }))
    }
    await clearAsking($)
    await setPhase($, 'waiting')
    await update($, stepsA, () => [])
    await update($, todosA, () => [])
    await update($, nowA, () => now)
    await update($, turnA, old => ({ title: line || old?.title || 'Working', startedAt: now, endedAt: null }))

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    // A helper agent's own turns end here too; only the main task's end counts.
    if (e.agentId !== undefined || !(await read($, enabledA))) return next(e)

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
    await update($, turnA, old => (old === null ? old : { ...old, endedAt: now, reason: e.reason }))
    await update($, nowA, () => now)
    await update($, stepsA, list =>
      list.map(one => (one.status === 'running' ? { ...one, ms: now - one.startedAt, size: 'small', status: 'error' } : one)),
    )

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    if (!(await read($, enabledA))) {
      return String(e.tool) === PLAN_TOOL
        ? { result: 'The tool lens is off, so no plan is shown. Carry on without calling this tool.' }
        : next(e)
    }

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
    if (isSmart && needsLabel(tool, input)) {
      const prompt = labelPrompt(request, todo, tool, detail)
      $.clock.after(0, () => {
        void relabel($, id, `${request}|${tool}|${detail}`, prompt)
      })
    }

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
    if (!(await read($, enabledA))) return next(e)

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
