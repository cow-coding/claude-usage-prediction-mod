# usage-prediction

A Claude Code mod that shows, in a box above the prompt, how many tokens the prompt you are typing is expected to use once submitted, and what share of your 5-hour limit that is.

```
╭──────────────────────────────────────────────────────────────────────╮
│ ▶ 이 입력을 제출하면 ~85.5k 토큰 = 5h 한도의 1.2% (남은 한도 66% 중 1.8%) │
│ Opus 5.5 · effort high │ 입력 84.2k · 출력 1.3k · 요청 ×2.1 · 프롬프트 42  │
╰──────────────────────────────────────────────────────────────────────╯
```

## How it predicts

- **Input**: current context + the draft's estimated tokens, times the average number of requests a turn makes (tool loops re-send the context).
- **Output**: the average output tokens of recent turns.
- **5h limit %**: learned per model from how much the 5-hour limit rose per token spent in earlier turns. It appears once a turn moves the limit by at least 0.1%, and is kept across sessions.

All figures are estimates: the draft is counted with a heuristic (ASCII ~4 chars/token, other scripts ~1 char/token), and other sessions sharing the same limit skew the learned rate.

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
