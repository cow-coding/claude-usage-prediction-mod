// limitPct / limitTokens: five-hour-limit percent gained and tokens spent, summed over learned turns
// mults: recent turns' tokens spent per token of one request's input, newest last
export type Stats = {
  model: string
  turns: number
  ratio: number
  output: number
  limitPct: number
  limitTokens: number
  mults: number[]
}

// the running turn: tokens spent so far (subagents included), main-loop requests, the 5h limit at submit,
// one request's input at submit (kept here, not in a module variable, so a reload mid-turn keeps it)
export type Live = { tokens: number; steps: number; startLimit: number | null; base: number }

// the last finished main turn: its first request's input (context + prompt), all tokens spent (subagents included),
// requests, measured 5h-limit rise
export type Last = { input: number; tokens: number; steps: number; measured: number | null }

declare module 'claude-code' {
  interface PluginState {
    'usage-prediction': { draft: number; stats: Stats | null; effort: string | null; live: Live | null; last: Last | null }
  }
}
