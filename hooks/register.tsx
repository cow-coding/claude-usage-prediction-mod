import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Stats } from '../types'

const draft = atom({ plugin: 'usage-prediction', key: 'draft' } as const, 0)
const stats = atom({ plugin: 'usage-prediction', key: 'stats' } as const, null)
const effort = atom({ plugin: 'usage-prediction', key: 'effort' } as const, null)
const live = atom({ plugin: 'usage-prediction', key: 'live' } as const, null)
const last = atom({ plugin: 'usage-prediction', key: 'last' } as const, null)

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

// nearest-rank quantile; q in [0, 1]
export const quantile = (xs: number[], q: number) => {
  const sorted = [...xs].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))] ?? 0
}

const MULTS_KEPT = 30
const RANGE_MIN_TURNS = 5

export const predict = (prompt: number, context: { tokens?: number; window: number }, s: Stats | null) => {
  const oneCall = (context.tokens ?? 0) + prompt
  const input = oneCall * Math.max(1, s?.ratio ?? 1)
  const output = s?.output ?? 0
  const mults = s?.mults ?? []
  return {
    input,
    output,
    // median turn when there is history, the mean otherwise
    total: mults.length >= 3 ? oneCall * quantile(mults, 0.5) : input + output,
    // a heavy turn: the 90th percentile, once enough turns are seen
    big: mults.length >= RANGE_MIN_TURNS ? oneCall * quantile(mults, 0.9) : undefined,
  }
}

const isStats = (v: unknown): v is Stats =>
  typeof v === 'object' && v !== null && typeof (v as Stats).model === 'string' && typeof (v as Stats).ratio === 'number'

const fiveHour = (limits: { kind: string; percentUsed: number }[]) =>
  limits.find(l => l.kind === 'five_hour')?.percentUsed

// ponytail: weighs every token alike, though the limit likely counts cache reads cheaper; split by token kind if it drifts
export const limitShare = (total: number, s: Stats | null) =>
  s && s.limitPct > 0 && s.limitTokens > 0 ? total * (s.limitPct / s.limitTokens) : undefined

const usageTokens = (u: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }) =>
  u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens

export const MESSAGES = {
  ko: {
    submit: '▶ 이 입력을 제출하면 ',
    tokens: '토큰',
    ofLimit: (x: string) => `5h 한도의 ${x}`,
    willUse: '를 소모하게 됩니다',
    ofLeft: (left: string, x: string) => ` (남은 한도 ${left} 중 ${x})`,
    big: (t: string, x?: string) => ` · 큰 작업이면 ~${t}${x ? ` (${x})` : ''}`,
    learning: (t: string) => ` (한도 % 학습 중: ${t} 토큰 집계, 사용률 0.1% 변화 대기)`,
    detail: (i: string, o: string, r: string, p: string) => `입력 ${i} · 출력 ${o} · 요청 ×${r} · 프롬프트 ${p}`,
    firstTurn: (p: string) => `입력만 (첫 턴 후 출력 예측) · 프롬프트 ${p}`,
    working: '⏳ 작업 중 ',
    steps: (n: number) => `요청 ${n}회 · `,
    spent: (t: string) => `${t} 토큰`,
    measured: (x: string) => ` · 실측 +${x}`,
    vsTypical: (k: string) => ` (보통 턴의 ${k}배)`,
    last: (i: string, w: string, total: string) => `↺ 이전 작업: 입력 ${i} + 작업 중 ${w} = 총 ${total} 토큰`,
    lastUsed: (x: string) => ` · 5h 한도의 ${x} 소모`,
    measuredTag: ' (실측)',
    estimatedTag: ' (추정)',
  },
  en: {
    submit: '▶ Submitting this will use ',
    tokens: 'tokens',
    ofLimit: (x: string) => `${x} of the 5h limit`,
    willUse: '',
    ofLeft: (left: string, x: string) => ` (${x} of the ${left} left)`,
    big: (t: string, x?: string) => ` · heavy task ~${t}${x ? ` (${x})` : ''}`,
    learning: (t: string) => ` (learning the limit %: ${t} tokens seen, waiting for a 0.1% move)`,
    detail: (i: string, o: string, r: string, p: string) => `in ${i} · out ${o} · requests ×${r} · prompt ${p}`,
    firstTurn: (p: string) => `input only (output predicted after the first turn) · prompt ${p}`,
    working: '⏳ Working ',
    steps: (n: number) => `${n} requests · `,
    spent: (t: string) => `${t} tokens`,
    measured: (x: string) => ` · measured +${x}`,
    vsTypical: (k: string) => ` (${k}× a typical turn)`,
    last: (i: string, w: string, total: string) => `↺ Last turn: input ${i} + while working ${w} = ${total} tokens`,
    lastUsed: (x: string) => ` · used ${x} of the 5h limit`,
    measuredTag: ' (measured)',
    estimatedTag: ' (estimated)',
  },
}
type Lang = keyof typeof MESSAGES

export const pickLang = (setting: unknown, locale: string | undefined): Lang =>
  setting === 'en' || setting === 'ko' ? setting : locale?.toLowerCase().startsWith('ko') ? 'ko' : 'en'

// the measured rise when the limit moved, else the learned rate's estimate, else under the 0.1% the limit reports
export const lastShare = (
  prev: { tokens: number; measured: number | null },
  s: Stats | null,
  t: { lastUsed: (x: string) => string; measuredTag: string; estimatedTag: string },
) => {
  if (prev.measured !== null && prev.measured > 0) return t.lastUsed(`${prev.measured.toFixed(1)}%`) + t.measuredTag
  const est = limitShare(prev.tokens, s)
  if (est !== undefined) return t.lastUsed(`${est.toFixed(1)}%`) + t.estimatedTag
  return prev.measured === 0 ? t.lastUsed('<0.1%') : ''
}

export const register: Register = (on, options) => {
  let lang: Lang = 'en'

  on('session.start', async ($, e, next) => {
    $.ui.status(undefined) // drop the status line an earlier version pinned
    lang = pickLang(options.language, (await $.env.get('LC_ALL')) || (await $.env.get('LANG')))
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
    const base = (context.tokens ?? 0) + (await read($, draft))
    await update($, live, () => ({ tokens: 0, steps: 0, startLimit: fiveHour(rateLimits) ?? null, base }))
    return next(e)
  })

  // counts every request of the running turn, subagents' included; effort has no getter, so it is taken here too
  on('turn.step', async function* ($, e, next) {
    if (!e.agentId && e.effort !== undefined) {
      const level = String(e.effort)
      if ((await read($, effort)) !== level) await update($, effort, () => level)
    }
    const result = yield* next(e)
    const u = result.usage
    if (u) {
      await update($, live, l => l && { ...l, tokens: l.tokens + usageTokens(u), steps: l.steps + (e.agentId ? 0 : 1) })
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const u = e.usage
    const running = e.agentId ? null : await read($, live)
    const base = running?.base ?? 0
    const limitAtSubmit = running?.startLimit ?? undefined
    if (!e.agentId && u && base > 0 && !e.isAborted) {
      const input = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
      const ratio = input / base
      const mult = (input + u.output_tokens) / base
      const now = fiveHour((await $.session.usage()).rateLimits)
      // a negative delta means the window reset mid-turn: learn nothing from it
      const delta = now !== undefined && limitAtSubmit !== undefined && now >= limitAtSubmit ? now - limitAtSubmit : undefined
      const spent = delta === undefined ? 0 : input + u.output_tokens
      // a different model has its own tokenizer, verbosity and limit weight: start its averages over
      await update($, stats, (s): Stats => {
        if (!s || s.model !== u.model) {
          return { model: u.model, turns: 1, ratio, output: u.output_tokens, limitPct: delta ?? 0, limitTokens: spent, mults: [mult] }
        }
        const turns = s.turns + 1
        return {
          model: u.model,
          turns,
          ratio: blend(s.ratio, ratio, turns),
          output: blend(s.output, u.output_tokens, turns),
          limitPct: (s.limitPct ?? 0) + (delta ?? 0),
          limitTokens: (s.limitTokens ?? 0) + spent,
          mults: [...(s.mults ?? []), mult].slice(-MULTS_KEPT),
        }
      })
      await $.store.set('stats', await read($, stats))
    }
    if (!e.agentId) {
      if (running && base > 0) {
        const now = fiveHour((await $.session.usage()).rateLimits)
        const measured = now !== undefined && running.startLimit !== null && now >= running.startLimit ? now - running.startLimit : null
        // the turn's own usage when no step was counted (a reload mid-turn)
        const tokens = running.tokens || (u ? u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens : 0)
        if (tokens > 0) await update($, last, () => ({ input: Math.min(base, tokens), tokens, steps: running.steps, measured }))
      }
      await update($, live, () => null)
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const t = MESSAGES[lang]
    const { context, rateLimits } = await $.session.usage()
    const used = fiveHour(rateLimits)
    const prompt = await read($, draft)
    const s = await read($, stats)
    const running = await read($, live)
    const prev = await read($, last)
    const model = prettyModel(await $.session.model())
    const level = await read($, effort)
    const p = predict(prompt, context, s)
    const { Box, Text } = $.ui.resolve(e)

    const meta = `${model}${level ? ` · effort ${level}` : ''} │ `

    // the running turn's figures, drawn as a third row so the prediction stays in view
    let progress = null
    if (e.props.isWorking && running) {
      const spentShare = limitShare(running.tokens, s)
      const measured = used !== undefined && running.startLimit !== null ? used - running.startLimit : undefined
      const typical = s?.mults?.length ? running.base * quantile(s.mults, 0.5) : undefined
      progress = (
        <Text>
          <Text color="claude" weight="bold">{t.working}</Text>
          <Text color="inactive">{t.steps(running.steps)}</Text>
          <Text weight="bold">{t.spent(fmt(running.tokens))}</Text>
          {spentShare !== undefined && (
            <Text>
              <Text> ≈ </Text>
              <Text color="claude" weight="bold">{t.ofLimit(`${spentShare.toFixed(1)}%`)}</Text>
            </Text>
          )}
          {measured !== undefined && measured > 0 && <Text color="inactive">{t.measured(`${measured.toFixed(1)}%`)}</Text>}
          {typical !== undefined && typical > 0 && running.tokens > typical * 1.5 && (
            <Text color="warning">{t.vsTypical((running.tokens / typical).toFixed(1))}</Text>
          )}
        </Text>
      )
    }

    const share = limitShare(p.total, s)
    const bigShare = p.big === undefined ? undefined : limitShare(p.big, s)
    const left = used === undefined ? undefined : 100 - used

    return (
      <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
        <Text>
          <Text color="claude" weight="bold">{t.submit}</Text>
          <Text weight="bold">{s ? `~${fmt(p.total)}` : `≥${fmt(p.input)}`} {t.tokens}</Text>
          {share !== undefined && (
            <Text>
              <Text> = </Text>
              <Text color="claude" weight="bold">{t.ofLimit(`${share.toFixed(1)}%`)}</Text>
              {t.willUse && <Text>{t.willUse}</Text>}
              {left !== undefined && left > 0 && <Text color="inactive">{t.ofLeft(pct(left), pct((share / left) * 100))}</Text>}
            </Text>
          )}
          {p.big !== undefined && p.big > p.total * 1.3 && (
            <Text color="inactive">{t.big(fmt(p.big), bigShare === undefined ? undefined : `${bigShare.toFixed(1)}%`)}</Text>
          )}
          {share === undefined && used !== undefined && <Text color="inactive">{t.learning(fmt(s?.limitTokens ?? 0))}</Text>}
        </Text>
        {prev && (
          <Text color="inactive">
            {t.last(fmt(prev.input), fmt(prev.tokens - prev.input), fmt(prev.tokens))}
            {prev.steps > 0 ? ` · ${t.steps(prev.steps).replace(/ · $/, '')}` : ''}
            {lastShare(prev, s, t)}
          </Text>
        )}
        <Text color="inactive">
          {meta}
          {s ? t.detail(fmt(p.input), fmt(p.output), s.ratio.toFixed(1), fmt(prompt)) : t.firstTurn(fmt(prompt))}
        </Text>
        {progress}
      </Box>
    )
  })
}
