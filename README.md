# usage-prediction

A Claude Code mod that shows, in a box above the prompt, how many tokens the prompt you are typing will likely use once submitted, and what share of your 5-hour limit that is. While Claude works, the same box adds a row tracking what the running turn has actually spent. This repository also includes a separate Codex CLI implementation; see [Codex CLI](#codex-cli) below.

Before you submit:

```
╭─────────────────────────────────────────────────────────────────────────────────────────────╮
│ ▶ Submitting this will use ~85.5k tokens = 1.2% of the 5h limit (1.8% of the 66% left)      │
│   · heavy task ~410.0k (5.8%)                                                               │
│ ↺ Last turn: input 85.2k + while working 227.2k = 312.4k tokens · 12 requests · used 3.9% of the 5h limit (measured) │
│ Opus 5.5 · effort high │ in 84.2k · out 1.3k · requests ×2.1 · prompt 42                    │
╰─────────────────────────────────────────────────────────────────────────────────────────────╯
```

While Claude works, a third row tracks the running turn and the prediction stays in view:

```
╭─────────────────────────────────────────────────────────────────────────────────────────────╮
│ ▶ Submitting this will use ~85.5k tokens = 1.2% of the 5h limit (1.8% of the 66% left)      │
│ Opus 5.5 · effort high │ in 84.2k · out 1.3k · requests ×2.1 · prompt 0                     │
│ ⏳ Working 12 requests · 312.4k tokens ≈ 4.4% of the 5h limit · measured +3.9% (3.6× a typical turn) │
╰─────────────────────────────────────────────────────────────────────────────────────────────╯
```

## How it predicts

- **One request**: the current context plus the draft's estimated tokens.
- **A turn**: Claude Code re-sends the context on every tool call, so a turn costs several requests. Each finished turn records its tokens spent per token of one request's input; the typical figure is the median of the last 30 turns, and once 5 turns are seen a heavy-task figure (90th percentile) shows beside it when it differs. Before 3 turns are seen, the mean request count and output are used.
- **5h limit %**: learned per model from how much the 5-hour limit rose per token spent in earlier turns. It appears once a turn moves the limit by at least 0.1%.
- **Last turn**: after a turn finishes, its first request's input (context + prompt), what it spent while working (tool calls, output, subagents) and the total, with the 5h-limit rise measured since submit, or estimated from the learned rate when the rise is under 0.1%. Kept for the current session only.
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

## Codex CLI

Requires Node.js 18+ and a Codex CLI version that supports plugin lifecycle hooks. The implementation targets CLI 0.166.0; automated hook tests pass, but the actual Codex UI has not yet been verified. Claude Code continues to use `hooks/hooks.json`; Codex selects `.codex-plugin/plugin.json`, which explicitly loads `codex/hooks.json`.

Install from a local checkout containing the Codex implementation:

```sh
codex plugin marketplace add /absolute/path/to/claude-usage-prediction-mod
codex plugin add usage-prediction@claude-usage-prediction-mod
```

Alternatively, install from GitHub:

```sh
codex plugin marketplace add cow-coding/claude-usage-prediction-mod
codex plugin add usage-prediction@claude-usage-prediction-mod
```

Start a new Codex CLI session and review/trust the plugin's hook definitions in `/hooks`. Codex skips untrusted hooks. See the official [plugin packaging guide](https://developers.openai.com/plugins/build/plugins).

Codex behavior differs from the Claude Code box:

- **On submit:** shows an approximate prompt-token count and, once completed turns have been collected, a typical full-turn estimate. After five samples it also shows a heavy-task estimate. Samples are grouped by model within the session and survive restarts.
- **On completion:** shows the change in cumulative input/output/total tokens. Input already includes cached tokens; output already includes reasoning tokens. Missing categories are omitted rather than reported as zero. A repeated Stop hook replaces the sample for the current submission instead of counting it twice.
- **5h share:** available only when the transcript supplies a 300-minute rate-limit window with a reset timestamp. It is learned from observed increases within the same window. A reset or missing data is not treated as zero consumption.
- **Language:** follows `LC_ALL`/`LANG`. Set `USAGE_PREDICTION_LANGUAGE=en` or `ko` in the environment used to launch Codex to override it.
- **Display:** hook messages are rendered by Codex as notices/warnings, so their color is controlled by Codex. There is no typing-time box or continuously updating progress row in this implementation.

The reader uses the `event_msg/token_count` records in the `.jsonl` transcript path supplied to each hook. That transcript format is not a stable API. Compressed, paginated, missing or changed transcripts may not expose usage; the mod then says usage is unavailable. The first observed turn also needs an existing cumulative baseline for an accurate completion delta. Subagent usage is included only if Codex includes it in the parent transcript totals; separate subagent files are not scanned.

Only numeric summaries, model IDs and turn IDs are stored locally in `PLUGIN_DATA` (fallback: `~/.codex/usage-prediction`); prompt text and conversation contents are not saved by this plugin or sent over the network. Codex and Claude learning data are independent.

Run the Codex tests with:

```sh
node --test codex/usage.test.mjs
```

## License

MIT
