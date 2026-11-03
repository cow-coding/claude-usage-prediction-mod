# usage-prediction

A Claude Code mod that shows, in a box above the prompt, how many tokens the prompt you are typing will likely use once submitted, and what share of your 5-hour limit that is. While Claude works, the same box tracks what the running turn has actually spent.

Before you submit:

```
╭─────────────────────────────────────────────────────────────────────────────────────────────╮
│ ▶ Submitting this will use ~85.5k tokens = 1.2% of the 5h limit (1.8% of the 66% left)      │
│   · heavy task ~410.0k (5.8%)                                                               │
│ Opus 5.5 · effort high │ in 84.2k · out 1.3k · requests ×2.1 · prompt 42                    │
╰─────────────────────────────────────────────────────────────────────────────────────────────╯
```

While Claude works:

```
╭─────────────────────────────────────────────────────────────────────────────────────────────╮
│ ⏳ Working 12 requests · 312.4k tokens ≈ 4.4% of the 5h limit · measured +3.9% (3.6× a typical turn) │
│ Opus 5.5 · effort high │ predicted typical ~85.5k · heavy ~410.0k                           │
╰─────────────────────────────────────────────────────────────────────────────────────────────╯
```

## How it predicts

- **One request**: the current context plus the draft's estimated tokens.
- **A turn**: Claude Code re-sends the context on every tool call, so a turn costs several requests. Each finished turn records its tokens spent per token of one request's input; the typical figure is the median of the last 30 turns, and once 5 turns are seen a heavy-task figure (90th percentile) shows beside it when it differs. Before 3 turns are seen, the mean request count and output are used.
- **5h limit %**: learned per model from how much the 5-hour limit rose per token spent in earlier turns. It appears once a turn moves the limit by at least 0.1%.
- **While working**: requests made, tokens spent (subagents included), their 5h-limit share, the measured rise of the limit since submit, and a warning once the turn passes 1.5× a typical one.

What it learns is kept across sessions and starts over when the answering model changes.

All figures are estimates. The draft is counted with a heuristic (ASCII ~4 chars/token, other scripts ~1 char/token), how much work a prompt leads to is only known once Claude does it, and other sessions sharing the same limit skew the learned rate. The 5h-limit figures need an account that reports rate limits (a Claude subscription); with an API key only the token figures show.

## Language

Korean or English. `auto` (the default) follows `LC_ALL` / `LANG`: a `ko_*` locale shows Korean, anything else English. Change it in `/config` (usage-prediction → Language) or in `~/.claude/settings.json`:

```json
"pluginConfigs": { "usage-prediction": { "options": { "language": "en" } } }
```

## Install

At the prompt of a terminal session:

```
/plugin install usage-prediction --marketplace cow-coding/claude-usage-prediction-mod
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session).

From a shell:

```
claude plugin install usage-prediction --marketplace cow-coding/claude-usage-prediction-mod
```

In the desktop app: click + next to the prompt box, then Plugins, Add marketplace with `cow-coding/claude-usage-prediction-mod`, then Add plugin.

## Developing

Run it from a clone with `claude --plugin-dir <clone>`, or load it in every session by naming the folder in `~/.claude/settings.json`: `"env": { "CLAUDE_CODE_PLUGIN_DIRS": "<clone>" }`. Edits reload while a session runs. `claude plugin test <clone>` runs the tests.

## License

MIT
