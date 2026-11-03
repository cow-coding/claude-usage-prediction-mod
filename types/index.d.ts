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

// the running turn: tokens spent so far (subagents included), main-loop requests, the 5h limit at submit
export type Live = { tokens: number; steps: number; startLimit: number | null }

declare module 'claude-code' {
  interface PluginState {
    'usage-prediction': { draft: number; stats: Stats | null; effort: string | null; live: Live | null }
  }
}
