# mods

Claude Code mods in one marketplace.

| Plugin | Version | What it does |
|---|---|---|
| [`tool-lens-mod`](plugins/tool-lens-mod) | 0.3.4 | A one-line band above the prompt that says in plain language what the agent is doing, and expands upward into the plan, tool calls, times and progress. |
| [`token-weather`](plugins/token-weather) | 0.2.0 | A weather-style forecast of the context window above the prompt: how full it is, how it grew, whether the prompt cache is still warm, and what the session cost. |

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
| `requirePlan` | `true` | The plan gate (see below): the third tool call of a task that has posted no plan is refused once. |

Change `smartLabels` with `/lens labels off`, or either option with `/config tool-lens-mod.smartLabels=false` /
`/config tool-lens-mod.requirePlan=false`. When labels are off, or if a label call fails, the built-in wording is used.

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

**The plan gate.** A reminder alone is not reliable: a model can do the work first and post a tidy plan at the end,
which shows the plan and percent only after the task is done. So the third tool call of a task that has posted no plan
is refused once, with a note asking for the plan and a repeat of the call. It refuses at most once per task, never
counts tool lookups, accepts `TodoWrite` as a plan, and is off under `/lens off` or `requirePlan=false`. The cost is one
wasted call on a task that skipped the plan; a refused call is not shown as a step.

## token-weather

One line above the prompt, updated after each turn:

```
☂ Showers  58%  116.2k / 200k  ▂▃▃▄▅▅  ▲ +8.4k last turn        🔥 Warm  reused 97% of context (52 min left) · spent $1.84
```

- **Forecast** from how full the context window is: `☀ Clear` (<25%), `☁ Cloudy` (25%), `☂ Showers` (50%),
  `☇ Storm` (75%), `↯ Compact soon` (90%+).
- tokens used of the window, a sparkline of the last 12 turns, and the change since the previous turn
- **Cache:** `🔥 Warm` when at least half of the last request's input came from the prompt cache and the cache has not
  expired yet, otherwise `🧊 Cold`; with the share reused and the minutes left (TTL minus a one-minute margin). The TTL
  (5 min or 1 h) is read from the session transcript; on desktop-hosted sessions, which cannot run processes, it stays 1 h.
- the session's spend so far, when the engine reports it

Only the main thread counts; helper agents' turns are ignored. No settings, no commands, no model calls.

## Install

### Requirements

- Claude Code with mod (function-hook plugin) support; tested on Claude Code 2.1.295. Check with `claude --version`.
- Read access to the GitHub repo `denyslokhmatov/mod-marketplace`. The short form `denyslokhmatov/mod-marketplace`
  clones over SSH (`git@github.com:...`), so it needs a GitHub SSH key with access. Without SSH, use the HTTPS URL
  `https://github.com/denyslokhmatov/mod-marketplace.git` (git asks for credentials if the repo is private).

### Terminal (recommended)

```bash
claude plugin marketplace add denyslokhmatov/mod-marketplace
claude plugin install tool-lens-mod@mods
claude plugin install token-weather@mods
```

Without an SSH key, add the marketplace over HTTPS instead of the first line:

```bash
claude plugin marketplace add https://github.com/denyslokhmatov/mod-marketplace.git
```

The marketplace is named `mods` (from `marketplace.json`), so plugin ids are `<plugin>@mods`. Install only the ones you
want. Installs go to user scope (all projects). Start a new Claude Code session for the mods to load.

Verify with `claude plugin list`: each should show `Status: ✔ enabled`. If one shows disabled:

```bash
claude plugin enable tool-lens-mod@mods
```

The install of `tool-lens-mod` prints "2 userConfig options not yet set". This is expected: both options have defaults
(`smartLabels` and `requirePlan` are both `true`). See the Settings table above, or change them later with
`/config tool-lens-mod.smartLabels=false`.

### Desktop app

Plugins installed from the terminal as above are user-scope and are also used by the Code tab of the Claude desktop
app, after a new session.

If installed mods do not show up, clone the repo and point the app at the folders, since the app takes no command-line
flags:

```bash
git clone https://github.com/denyslokhmatov/mod-marketplace.git ~/mod-marketplace
```

Then add this to `~/.claude/settings.json` (merge into an existing `env` block, do not replace the file):

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "/Users/you/mod-marketplace/plugins/tool-lens-mod:/Users/you/mod-marketplace/plugins/token-weather"
  }
}
```

Use absolute paths (no `~`) and separate several folders with `:`. Do not also install the same mod from the
marketplace, or it loads twice.

### Try without installing

From a clone, for one session only:

```bash
claude --plugin-dir ~/mod-marketplace/plugins/tool-lens-mod --plugin-dir ~/mod-marketplace/plugins/token-weather
```

`--plugin-dir` can be repeated.

### Update

```bash
claude plugin marketplace update mods
claude plugin update tool-lens-mod@mods
claude plugin update token-weather@mods
```

For a clone used with `--plugin-dir` or `CLAUDE_CODE_PLUGIN_DIRS`:

```bash
git -C ~/mod-marketplace pull
```

Start a new session afterwards.

### Uninstall

```bash
claude plugin uninstall tool-lens-mod@mods
claude plugin uninstall token-weather@mods
claude plugin marketplace remove mods
```

For the desktop fallback, remove the `CLAUDE_CODE_PLUGIN_DIRS` entry.

### Troubleshooting

| Symptom | Fix |
|---|---|
| `marketplace add` fails with "Permission denied (publickey)" or "Repository not found" | No SSH access. Add the marketplace with the HTTPS URL (see Terminal), or ask the repo owner for read access. |
| Mod not visible | Start a new session, check `claude plugin list`, and enable it. |
| Band appears twice | The same mod is loaded both installed and via `--plugin-dir`, `CLAUDE_CODE_PLUGIN_DIRS` or a shell alias. Keep one. |
| `claude plugin install` says plugin not found | Run `claude plugin marketplace update mods`, and check the id ends in `@mods`. |

## Notes

- The mods are function-hook plugins (`hooks/hooks.json` names a `register.tsx` module). They need a Claude Code build
  with mod support; if an installed mod does not load on your build, load it from a clone with `--plugin-dir` (see
  Install).
- The band is drawn above the prompt on the terminal and the desktop app. Percent-width boxes keep the bar inside the
  available width on both; the minimised bar is half a row tall on the desktop and a full row on the terminal.
- A helper agent's own turns and tool calls are not counted as steps; the helper appears as one step.
- A task that was stopped, failed or declined says so (`Stopped`, `Stopped by an error`, `Declined`) with no percent, and
  its open plan does not carry into the next task. A task that never reported its end is closed when the next one starts.

## Develop

```bash
cd plugins/tool-lens-mod
claude plugin validate .
claude plugin test .          # 31 tests: logic, rendering on both surfaces, task lifecycle, labels, off/on, plan reminder and listing

cd ../token-weather
claude plugin validate .
claude plugin test .          # 10 tests: forecast thresholds, formatting, chart, cache hit rate, warmth, TTL parsing
```

The logic (summary, percent, bar shares, status wording, redaction, label prompt and parsing) lives in
`hooks/lens.ts` and is unit-tested; `hooks/register.tsx` holds the hooks and the drawing.
