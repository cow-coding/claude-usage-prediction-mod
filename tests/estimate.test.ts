import { expect, test } from 'claude-code/testing'

import { estimate, lastShare, limitShare, MESSAGES, pickLang, predict, prettyModel, quantile } from '../hooks/register'

const STATS = { model: 'm', turns: 3, ratio: 2, output: 1000, limitPct: 0, limitTokens: 0, mults: [] as number[] }

test('estimate counts ASCII at ~4 chars/token and other scripts at ~1', async () => {
  expect(estimate('')).toBe(0)
  expect(estimate('abcdefgh')).toBe(2)
  expect(estimate('안녕하세요')).toBe(5)
  expect(estimate('hi 안녕')).toBe(3)
})

test('predict uses the mean without history, the median and p90 with it', async () => {
  const ctx = { tokens: 99000, window: 200000 }
  expect(predict(1000, ctx, STATS)).toEqual({ input: 200000, output: 1000, total: 201000, big: undefined })
  expect(predict(10, { window: 200000 }, null).total).toBe(10)
  const p = predict(1000, ctx, { ...STATS, mults: [1, 1, 2, 2, 2, 3, 3, 4, 5, 20] })
  expect(p.total).toBe(200000)
  expect(p.big).toBe(500000)
})

test('quantile is nearest-rank', async () => {
  expect(quantile([3, 1, 2], 0.5)).toBe(2)
  expect(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9)
  expect(quantile([], 0.5)).toBe(0)
})

test('limitShare converts predicted tokens to five-hour percent once learned', async () => {
  const s = { ...STATS, limitPct: 2, limitTokens: 400000 }
  expect(limitShare(100000, s)).toBe(0.5)
  expect(limitShare(100000, { ...s, limitPct: 0 })).toBeUndefined()
  expect(limitShare(100000, null)).toBeUndefined()
})

test('prettyModel turns ids into display names', async () => {
  expect(prettyModel('claude-opus-5-5')).toBe('Opus 5.5')
  expect(prettyModel('claude-sonnet-5-5[1m]')).toBe('Sonnet 5.5')
  expect(prettyModel('Opus 5.5')).toBe('Opus 5.5')
  expect(prettyModel('gpt-x')).toBe('gpt-x')
})

test('pickLang: setting wins, auto follows the locale', async () => {
  expect(pickLang('auto', 'ko_KR.UTF-8')).toBe('ko')
  expect(pickLang('auto', 'en_US.UTF-8')).toBe('en')
  expect(pickLang('auto', undefined)).toBe('en')
  expect(pickLang('en', 'ko_KR.UTF-8')).toBe('en')
  expect(pickLang('ko', 'en_US')).toBe('ko')
})

test('lastShare prefers the measured rise, then the estimate, then <0.1%', async () => {
  const t = MESSAGES.ko
  const s = { ...STATS, limitPct: 2, limitTokens: 400000 }
  expect(lastShare({ tokens: 100000, measured: 1.2 }, s, t)).toBe(' · 5h 한도의 1.2% 소모 (실측)')
  expect(lastShare({ tokens: 100000, measured: 0 }, s, t)).toBe(' · 5h 한도의 0.5% 소모 (추정)')
  expect(lastShare({ tokens: 100000, measured: 0 }, null, t)).toBe(' · 5h 한도의 <0.1% 소모')
  expect(lastShare({ tokens: 100000, measured: null }, null, t)).toBe('')
})
