import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Stats } from '../types'

const draft = atom({ plugin: 'usage-prediction', key: 'draft' } as const, 0)
const stats = atom({ plugin: 'usage-prediction', key: 'stats' } as const, null)
const effort = atom({ plugin: 'usage-prediction', key: 'effort' } as const, null)

// ponytail: heuristic tokenizer (ASCII ~4 chars/token, other scripts ~1 char/token); swap for a count-tokens call if precision matters
export const estimate = (text: string) => {
  const ascii = text.replace(/[^\x00-\x7f]/g, '').length
  return Math.ceil(ascii / 4 + (text.length - ascii))
}

// running mean over the last ~10 turns
const blend = (avg: number, x: number, n: number) => avg + (x - avg) / Math.min(n, 10)

export const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`)
const pct = (n: number) => `${n < 1 && n > 0 ? n.toFixed(1) : Math.round(n)}%`

// claude-opus-5-5[1m] → Opus 5.5; anything else as given
export const prettyModel = (id: string) => {
  const m = /(opus|sonnet|haiku|fable)-(\d+)(?:-(\d+))?/i.exec(id)
  if (!m) return id
  const [, family = '', major, minor] = m
  return `${family[0]!.toUpperCase()}${family.slice(1).toLowerCase()} ${major}${minor ? `.${minor}` : ''}`
}

export const predict = (prompt: number, context: { tokens?: number; window: number }, s: Stats | null) => {
  const oneCall = (context.tokens ?? 0) + prompt
  const input = oneCall * Math.max(1, s?.ratio ?? 1)
  const output = s?.output ?? 0
  return {
    input,
    output,
    total: input + output,
  }
}

const isStats = (v: unknown): v is Stats =>
  typeof v === 'object' && v !== null && typeof (v as Stats).model === 'string' && typeof (v as Stats).ratio === 'number'

const fiveHour = (limits: { kind: string; percentUsed: number }[]) =>
  limits.find(l => l.kind === 'five_hour')?.percentUsed

// ponytail: weighs every token alike, though the limit likely counts cache reads cheaper; split by token kind if it drifts
export const limitShare = (total: number, s: Stats | null) =>
  s && s.limitPct > 0 && s.limitTokens > 0 ? total * (s.limitPct / s.limitTokens) : undefined

export const register: Register = on => {
  let base = 0 // context + prompt tokens at submit, i.e. one request's input
  let limitAtSubmit: number | undefined

  on('session.start', async ($, e, next) => {
    $.ui.status(undefined) // drop the status line an earlier version pinned
    // a new session starts from what earlier sessions learned
    const saved = await $.store.get('stats')
    if ((await read($, stats)) === null && isStats(saved)) await update($, stats, () => saved)
    return next(e)
  })

  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    await update($, draft, () => estimate(box.text))
    return box
  })

  on('prompt.change', async ($, e, next) => {
    await update($, draft, () => estimate(e.text))
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const { context, rateLimits } = await $.session.usage()
    base = (context.tokens ?? 0) + (await read($, draft))
    limitAtSubmit = fiveHour(rateLimits)
    return next(e)
  })

  // effort has no getter: take it from the main loop's last request
  on('turn.step', async function* ($, e, next) {
    if (!e.agentId && e.effort !== undefined) {
      const level = String(e.effort)
      if ((await read($, effort)) !== level) await update($, effort, () => level)
    }
    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const u = e.usage
    if (!e.agentId && u && base > 0 && !e.isAborted) {
      const input = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
      const ratio = input / base
      const now = fiveHour((await $.session.usage()).rateLimits)
      // a negative delta means the window reset mid-turn: learn nothing from it
      const delta = now !== undefined && limitAtSubmit !== undefined && now >= limitAtSubmit ? now - limitAtSubmit : undefined
      const spent = delta === undefined ? 0 : input + u.output_tokens
      // a different model has its own tokenizer, verbosity and limit weight: start its averages over
      await update($, stats, (s): Stats => {
        if (!s || s.model !== u.model) {
          return { model: u.model, turns: 1, ratio, output: u.output_tokens, limitPct: delta ?? 0, limitTokens: spent }
        }
        const turns = s.turns + 1
        return {
          model: u.model,
          turns,
          ratio: blend(s.ratio, ratio, turns),
          output: blend(s.output, u.output_tokens, turns),
          limitPct: (s.limitPct ?? 0) + (delta ?? 0),
          limitTokens: (s.limitTokens ?? 0) + spent,
        }
      })
      await $.store.set('stats', await read($, stats))
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { context, rateLimits } = await $.session.usage()
    const used = fiveHour(rateLimits)
    const prompt = await read($, draft)
    const s = await read($, stats)
    const model = prettyModel(await $.session.model())
    const level = await read($, effort)
    const p = predict(prompt, context, s)
    const share = limitShare(p.total, s)
    const left = used === undefined ? undefined : 100 - used
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
        <Text>
          <Text color="claude" weight="bold">▶ 이 입력을 제출하면 </Text>
          <Text weight="bold">{s ? `~${fmt(p.total)}` : `≥${fmt(p.input)}`} 토큰</Text>
          {share !== undefined && (
            <Text>
              <Text> = </Text>
              <Text color="claude" weight="bold">5h 한도의 {share.toFixed(1)}%</Text>
              {left !== undefined && left > 0 && (
                <Text color="inactive"> (남은 한도 {pct(left)} 중 {pct((share / left) * 100)})</Text>
              )}
            </Text>
          )}
          {share === undefined && used !== undefined && (
            <Text color="inactive">
              {' '}(한도 % 학습 중: {fmt(s?.limitTokens ?? 0)} 토큰 집계, 사용률 0.1% 변화 대기)
            </Text>
          )}
        </Text>
        <Text color="inactive">
          {`${model}${level ? ` · effort ${level}` : ''} │ `}
          {s ? `입력 ${fmt(p.input)} · 출력 ${fmt(p.output)} · 요청 ×${s.ratio.toFixed(1)}` : '입력만 (첫 턴 후 출력 예측)'}
          {` · 프롬프트 ${fmt(prompt)}`}
        </Text>
      </Box>
    )
  })
}
