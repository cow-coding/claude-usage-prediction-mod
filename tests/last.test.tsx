import { expect, test } from 'claude-code/testing'

test('a finished turn leaves the last-turn row', async ($, on) => {
  on('session.usage', () => ({ value: { context: { tokens: 1000, window: 200000 }, rateLimits: [] } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('ui.status', () => ({ value: {} }))
  on('env.get', () => ({ value: undefined }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: {} }))
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'hello there' })
  await $.turn.complete({ answer: 'x', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer',
    usage: { input_tokens: 500, output_tokens: 200, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' } })
  const ui = await $.ui.mount({ plugin: 'usage-prediction', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false }, surface: 'terminal' })
  const all = await ui.find({ type: 'Box' })
  console.log(JSON.stringify(all?.text ?? all))
  expect((await ui.find({ type: 'Text', text: /이전 작업|Last turn/ })) !== undefined).toBe(true)
  await ui.unmount()
})
