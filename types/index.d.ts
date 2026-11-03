// limitPct / limitTokens: five-hour-limit percent gained and tokens spent, summed over learned turns
export type Stats = { model: string; turns: number; ratio: number; output: number; limitPct: number; limitTokens: number }

declare module 'claude-code' {
  interface PluginState {
    'usage-prediction': { draft: number; stats: Stats | null; effort: string | null }
  }
}
