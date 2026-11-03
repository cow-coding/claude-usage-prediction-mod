import { expect, test } from 'claude-code/testing'

import { estimate, limitShare, predict, prettyModel } from '../hooks/register'

test('estimate counts ASCII at ~4 chars/token and other scripts at ~1', async () => {
  expect(estimate('')).toBe(0)
  expect(estimate('abcdefgh')).toBe(2)
  expect(estimate('안녕하세요')).toBe(5)
  expect(estimate('hi 안녕')).toBe(3)
})

test('predict scales input by the request ratio and adds average output', async () => {
  const p = predict(1000, { tokens: 99000, window: 200000 }, { model: 'm', turns: 3, ratio: 2, output: 1000, limitPct: 0, limitTokens: 0 })
  expect(p).toEqual({ input: 200000, output: 1000, total: 201000 })
  expect(predict(10, { window: 200000 }, null).total).toBe(10)
})

test('limitShare converts predicted tokens to five-hour percent once learned', async () => {
  const s = { model: 'm', turns: 4, ratio: 1, output: 0, limitPct: 2, limitTokens: 400000 }
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
