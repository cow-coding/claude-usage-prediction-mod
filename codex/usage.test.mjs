import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { consumption, estimate, handle, prediction, snapshot } from './usage.mjs';

const usage = (input, output) => ({ input_tokens: input, output_tokens: output, total_tokens: input + output });
const record = (input, output, used = 10, reset = 1000) => JSON.stringify({
  type: 'event_msg', payload: { type: 'token_count',
    info: { total_token_usage: usage(input, output), last_token_usage: usage(100, 20) },
    rate_limits: { primary: { window_minutes: 300, used_percent: used, resets_at: reset } },
  },
});

test('count and predict with median, p90, and measured limit rates', () => {
  assert.equal(estimate('abcd안녕'), 3);
  assert.equal(prediction(100, []).typical, null);
  const samples = [1, 2, 3, 4, 50].map(n => ({ base: 100, total: n * 100, limit: n }));
  assert.deepEqual(prediction(100, samples), { typical: 300, heavy: 5000, percent: 3 });
});

test('usage deltas do not double count cached or reasoning tokens; missing categories stay unknown', () => {
  const before = { usage: usage(1000, 100), limit: { used: 10, reset: 1000 } };
  const after = { usage: { ...usage(1400, 200), cached_input_tokens: 100, reasoning_output_tokens: 50 }, limit: { used: 12, reset: 1000 } };
  assert.deepEqual(consumption(before, after), { input: 400, output: 100, total: 500, limit: 2 });
  assert.equal(consumption({}, after), null);
  assert.equal(consumption(after, before), null);
  assert.equal(consumption(before, { ...after, limit: { used: 12, reset: 2000 } }).limit, null);
  assert.equal(consumption({ usage: { total_tokens: 0 } }, { usage: { input_tokens: 0, output_tokens: 0, total_tokens: 20 } }).input, null);
});

test('submission, reload, completion, repeated Stop, model change, and private state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'usage-prediction-test-'));
  try {
    const transcript = join(dir, 'rollout.jsonl');
    const data = join(dir, 'data');
    const env = { PLUGIN_DATA: data, USAGE_PREDICTION_LANGUAGE: 'en' };
    const event = { session_id: '../../example', turn_id: 'one', model: 'gpt-example', transcript_path: transcript };
    await writeFile(transcript, record(1000, 100));
    const submit = await handle({ ...event, hook_event_name: 'UserPromptSubmit', prompt: 'secret draft' }, env);
    assert.match(submit.systemMessage, /collecting completed turns/);
    await writeFile(transcript, `${record(1000, 100)}\nmalformed\n${record(1400, 200, 12)}\n`);
    // A different process runs each hook, as it does in Codex.
    const stop = spawnSync(process.execPath, [new URL('./usage.mjs', import.meta.url).pathname], {
      env: { ...process.env, ...env }, encoding: 'utf8',
      input: JSON.stringify({ ...event, hook_event_name: 'Stop' }),
    });
    assert.equal(stop.status, 0, stop.stderr);
    assert.match(JSON.parse(stop.stdout).systemMessage, /input 400 \+ output 100 = 500 tokens/);
    await handle({ ...event, hook_event_name: 'Stop' }, env);
    const files = await readdir(data);
    assert.equal(files.length, 1);
    const saved = await readFile(join(data, files[0]), 'utf8');
    assert.equal(JSON.parse(saved).samples.length, 1);
    assert.ok(!saved.includes('secret draft'));
    const next = await handle({ ...event, turn_id: 'two', hook_event_name: 'UserPromptSubmit', prompt: 'test' }, env);
    assert.match(next.systemMessage, /Typical/);
    assert.match(next.systemMessage, /5h limit/);
    const changed = await handle({ ...event, turn_id: 'three', model: 'different', hook_event_name: 'UserPromptSubmit', prompt: 'test' }, env);
    assert.match(changed.systemMessage, /collecting completed turns/);
    assert.deepEqual(await handle({ ...event, hook_event_name: 'Stop' }, env), {});
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('missing transcripts, partial records, and first observed turn are not reported as zero usage', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'usage-prediction-test-'));
  try {
    assert.deepEqual(await snapshot(join(dir, 'absent.jsonl')), {});
    const event = { session_id: 'new', model: 'm', hook_event_name: 'UserPromptSubmit', prompt: 'hello' };
    const env = { PLUGIN_DATA: dir, USAGE_PREDICTION_LANGUAGE: 'ko' };
    assert.match((await handle(event, env)).systemMessage, /완료 기록/);
    assert.match((await handle({ ...event, hook_event_name: 'Stop' }, env)).systemMessage, /집계 정보 없음/);
    assert.deepEqual(await handle({ ...event, hook_event_name: 'Interrupt' }, env), { systemMessage: '↺ 이전 작업: 사용량 집계 정보 없음' });
    assert.deepEqual(await handle({ ...event, hook_event_name: 'Stop' }, env), {});
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('malformed input fails open without requesting continuation or blocking', () => {
  const result = spawnSync(process.execPath, [new URL('./usage.mjs', import.meta.url).pathname], { input: '{broken', encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), {});
});

test('Codex explicitly loads its own hooks and leaves Claude module hooks intact', async () => {
  const root = new URL('../', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('.codex-plugin/plugin.json', root), 'utf8'));
  const hooks = JSON.parse(await readFile(new URL(manifest.hooks, root), 'utf8'));
  assert.deepEqual(Object.keys(hooks.hooks), ['UserPromptSubmit', 'Stop', 'Interrupt']);
  for (const groups of Object.values(hooks.hooks)) {
    for (const group of groups) {
      for (const hook of group.hooks) {
        assert.equal(hook.type, 'command');
        assert.equal(hook.command, 'node "${PLUGIN_ROOT}/codex/usage.mjs"');
      }
    }
  }
  const claude = JSON.parse(await readFile(new URL('hooks/hooks.json', root), 'utf8'));
  assert.deepEqual(claude.modules, ['./register.tsx']);
});
