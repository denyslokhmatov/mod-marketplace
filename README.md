# mods

Claude Code mods in one marketplace.

| Plugin | Version | What it does |
|---|---|---|
| [`tool-lens-mod`](plugins/tool-lens-mod) | 0.3.3 | A one-line band above the prompt that says in plain language what the agent is doing, and expands upward into the plan, tool calls, times and progress. |

## tool-lens-mod

**Minimised:** one line above the prompt: `Step 4 of 7`, a segmented bar, what the agent is doing right now, the
percent, and `Expand`. Click almost anywhere on it to expand.

```
◆ Step 4 of 7  ▇▇▇▇▇▇▇▇░░░░  Looking up your open CoBrain tasks…   57%   Expand ⤢
```

**Expanded:** the band grows upward into the full view. Click almost anywhere on it to minimise.

- the plan, each planned step with the tool calls made under it and the total time it took
- a colored bar and a legend by kind of work (reading files, searching, connected apps, commands, helper agents, skills, editing, web)
- `✓` done, `●` running, `✗` failed, `○` still to do, with the duration of each call

What it says between tool calls comes from the model's own response stream: "Thinking it through", "Writing the
answer", "Choosing the next tool", or "Reviewing the result of …". A call the engine puts to the permission dialog
shows "Needs your approval: …" (best effort: the plugin API reports when the dialog opens, not when you answer).

### Commands

| Command | Effect |
|---|---|
| `/lens off` / `/lens on` | hide it and stop tracking, or bring it back (state is kept for the session) |
| `/lens` | toggle expanded and minimised |
| `/lens min` / `/lens max` | set the view |
| `/lens labels on` / `off` | turn plain-language labels on or off |
| `/lens settings` | show the current view and label setting, and this list |

### Settings

| Option | Default | Effect |
|---|---|---|
| `smartLabels` | `true` | Reword skill, connected-app, tool-lookup and bare shell steps with a small model (`haiku`), in terms of your request: "Looking up your open CoBrain tasks" instead of "Loaded the tasks-sync skill". |

Change it with `/lens labels off`, or `/config tool-lens-mod.smartLabels=false`. When it is off, or if a label call
fails, the built-in wording is used.

### Cost and privacy

- `smartLabels` makes one short call per labelled step: about 250 input and 35 output tokens, roughly $0.0005 at
  Claude Haiku 4.5 rates. At most 3 run at once and identical steps reuse the label. Only skills, connected apps,
  tool lookups and shell commands without a description are labelled.
- The call carries your request (first 300 characters) and the step, both with credentials masked.
- Commands, URLs and paths shown in the band, and your request shown as the title, are masked before they are drawn:
  `Authorization:` headers, `--token`/`--password` values, `NAME_TOKEN=…`, `https://user:pass@…`, common key
  prefixes (`sk-`, `ghp_`, `xox…`, `AKIA…`) and long key-like strings. File paths are left alone. This changes
  what is displayed and sent for labels; the model still sees the real tool calls.

### The plan tool

The mod registers a `plan` tool, lists it directly in the model's tools (not behind tool search, where it would
never be found among many connected apps), and attaches a short reminder to each prompt as hidden context: post the
plan first for tasks that need three or more tool calls, and update it as steps finish. That is where `Step 4 of 7`,
the percent and the per-step times come from. Without a plan the band shows `Step N` and a bar that fills with what
has run. If a `TodoWrite` tool is available the model is told to use it instead. `/lens off` stops the reminder at
once, and while off the `plan` tool answers that the lens is off.

## Install

```bash
claude plugin marketplace add denyslokhmatov/mod-marketplace
claude plugin install tool-lens-mod@mods
```

Or load one mod straight from disk, without installing:

```bash
claude --plugin-dir ./plugins/tool-lens-mod
```

For the desktop app, which takes no command-line flags, add the folder to the `env` block of `~/.claude/settings.json`:

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/absolute/path/to/plugins/tool-lens-mod" } }
```

## Notes

- The mods are function-hook plugins (`hooks/hooks.json` names a `register.tsx` module). Loading them from an
  installed plugin has not been verified on every Claude Code build; `--plugin-dir` is the path that has been tested.
- The band is drawn above the prompt on the terminal and the desktop app. Percent-width boxes keep the bar inside the
  available width on both; the minimised bar is half a row tall on the desktop and a full row on the terminal.
- A helper agent's own turns and tool calls are not counted as steps; the helper appears as one step.
- A task that was stopped, failed or declined says so (`Stopped`, `Stopped by an error`, `Declined`) with no percent, and
  its open plan does not carry into the next task. A task that never reported its end is closed when the next one starts.

## Develop

```bash
cd plugins/tool-lens-mod
claude plugin validate .
claude plugin test .          # 26 tests: logic, rendering on both surfaces, task lifecycle, labels, off/on, plan reminder and listing
```

The logic (summary, percent, bar shares, status wording, redaction, label prompt and parsing) lives in
`hooks/lens.ts` and is unit-tested; `hooks/register.tsx` holds the hooks and the drawing.
