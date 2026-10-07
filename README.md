# mods

Claude Code mods in one marketplace.

| Plugin | What it does |
|---|---|
| `tool-lens-mod` | A one-line band above the prompt that says in plain language what the agent is doing, and expands upward into the plan, tool calls, times and progress. |

## Install

```bash
claude plugin marketplace add denyslokhmatov/mod-marketplace
claude plugin install tool-lens-mod@mods
```

Or load one mod straight from disk, without installing:

```bash
claude --plugin-dir ./plugins/tool-lens-mod
```

Inside a session, `/lens` toggles the expanded view, `/lens min` and `/lens max` set it.

## Notes

- The mods are function-hook plugins (`hooks/hooks.json` names a `register.tsx` module). Check that your Claude Code
  build loads them from an installed plugin; `--plugin-dir` is the path that has been tested.
- `tool-lens-mod` registers a `plan` tool and adds a short system-prompt section asking the model to post its plan.
- Commands and URLs shown in the band have credentials masked before they are drawn.
