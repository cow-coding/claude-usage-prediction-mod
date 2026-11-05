import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

export const estimate = text => Math.ceil([...text].reduce((n, c) => n + (c.charCodeAt(0) < 128 ? 0.25 : 1), 0));
const valid = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const fmt = n => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`;
const percentile = (xs, q) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * q) - 1];

// shortcut: Codex transcript records are not a stable API; update this reader when their format changes.
export async function snapshot(path) {
  let result = {};
  if (typeof path !== 'string' || !path.endsWith('.jsonl')) return result;
  try {
    const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
    for await (const line of lines) {
      let row;
      try { row = JSON.parse(line); } catch { continue; }
      if (row.type !== 'event_msg' || row.payload?.type !== 'token_count') continue;
      const { info, rate_limits: limits } = row.payload;
      const usage = info?.total_token_usage;
      const last = info?.last_token_usage;
      if (usage && valid(usage.total_tokens)) result.usage = usage;
      if (last && valid(last.total_tokens)) result.context = last.total_tokens;
      const primary = limits?.primary;
      if (primary?.window_minutes === 300 && valid(primary.used_percent) && valid(primary.resets_at)) {
        result.limit = { used: primary.used_percent, reset: primary.resets_at };
      } else delete result.limit;
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  return result;
}

export function consumption(before, after) {
  if (!before?.usage || !after?.usage) return null;
  const total = after.usage.total_tokens - before.usage.total_tokens;
  if (!valid(total)) return null;
  const input = after.usage.input_tokens - before.usage.input_tokens;
  const output = after.usage.output_tokens - before.usage.output_tokens;
  // Some clients report only total_tokens. Zero category fields do not mean zero input/output.
  const detailed = valid(input) && valid(output) && input + output === total;
  const limit = before.limit && after.limit && before.limit.reset === after.limit.reset
    && after.limit.used >= before.limit.used ? after.limit.used - before.limit.used : null;
  return { total, input: detailed ? input : null, output: detailed ? output : null, limit };
}

export function prediction(base, samples) {
  const rows = samples.filter(s => valid(s.base) && s.base > 0 && valid(s.total));
  if (!rows.length) return { typical: null, heavy: null, percent: null };
  const multipliers = rows.map(s => s.total / s.base);
  const typical = base * percentile(multipliers, 0.5);
  const rated = rows.filter(s => valid(s.limit));
  const spent = rated.reduce((n, s) => n + s.total, 0);
  const increase = rated.reduce((n, s) => n + s.limit, 0);
  return {
    typical,
    heavy: rows.length >= 5 ? base * percentile(multipliers, 0.9) : null,
    percent: spent > 0 && increase > 0 ? typical * increase / spent : null,
  };
}

async function save(path, state) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(state), { mode: 0o600 });
  await rename(temp, path);
}

export async function handle(event, env = process.env) {
  if (!event || typeof event.session_id !== 'string' || !event.session_id) return {};
  if (!['UserPromptSubmit', 'Stop', 'Interrupt'].includes(event.hook_event_name)) return {};
  const language = env.USAGE_PREDICTION_LANGUAGE || env.LC_ALL || env.LANG || '';
  const ko = /^ko(?:$|[_-])/i.test(language);
  const root = env.PLUGIN_DATA || env.CLAUDE_PLUGIN_DATA || join(homedir(), '.codex', 'usage-prediction');
  const key = createHash('sha256').update(event.session_id).digest('hex');
  const path = join(root, `${key}.json`);
  let state = { samples: [] };
  try {
    state = JSON.parse(await readFile(path, 'utf8'));
    if (!state || !Array.isArray(state.samples)) throw new Error('Invalid usage-prediction state');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const current = await snapshot(event.transcript_path);
  const model = typeof event.model === 'string' ? event.model : 'unknown';

  if (event.hook_event_name === 'UserPromptSubmit') {
    if (typeof event.prompt !== 'string') return {};
    const prompt = estimate(event.prompt);
    const base = (current.context ?? 0) + prompt;
    // A missing baseline may be a resumed session, so never assume usage started at zero.
    state.pending = { id: randomUUID(), before: current, base, model, turn: event.turn_id ?? null };
    const p = prediction(base, state.samples.filter(s => s.model === model));
    const lines = [ko ? `▶ 제출 예측 · ${model} · 프롬프트 약 ${fmt(prompt)} 토큰` : `▶ Submission estimate · ${model} · prompt ~${fmt(prompt)} tokens`];
    if (p.typical !== null) {
      lines.push(ko ? `보통 ~${fmt(p.typical)} 토큰${p.heavy !== null ? ` · 큰 작업 ~${fmt(p.heavy)}` : ''}` : `Typical ~${fmt(p.typical)} tokens${p.heavy !== null ? ` · heavy ~${fmt(p.heavy)}` : ''}`);
      if (p.percent !== null) lines.push(ko ? `5h 한도의 약 ${p.percent.toFixed(1)}%를 소모할 것으로 추정합니다` : `Estimated consumption: ${p.percent.toFixed(1)}% of the 5h limit`);
    } else {
      lines.push(ko ? '작업 전체 예상량: 완료 기록을 모으는 중' : 'Full-turn estimate: collecting completed turns');
    }
    await save(path, state);
    return { systemMessage: lines.join('\n') };
  }

  const pending = state.pending;
  if (!pending || (pending.turn && event.turn_id && pending.turn !== event.turn_id)) return {};
  const spent = consumption(pending.before, current);
  // Stop can be called repeatedly if another hook asks Codex to continue: keep the original baseline.
  if (spent && event.hook_event_name === 'Stop' && (!event.model || event.model === pending.model)) {
    if (state.recorded === pending.id) state.samples.pop();
    state.samples.push({ model: pending.model, base: pending.base, ...spent });
    state.samples = state.samples.slice(-30);
    state.recorded = pending.id;
  }
  if (event.hook_event_name === 'Interrupt') state.pending = null;
  await save(path, state);
  if (!spent) return { systemMessage: ko ? '↺ 이전 작업: 사용량 집계 정보 없음' : '↺ Last turn: token usage unavailable' };
  const detail = spent.input === null ? '' : ko ? `입력 ${fmt(spent.input)} + 출력 ${fmt(spent.output)} = ` : `input ${fmt(spent.input)} + output ${fmt(spent.output)} = `;
  const limit = spent.limit === null ? '' : ko ? ` · 5h 한도 ${spent.limit.toFixed(1)}%p 증가 (실측)` : ` · 5h limit +${spent.limit.toFixed(1)} percentage points (measured)`;
  return { systemMessage: (ko ? `↺ 이전 작업: ${detail}총 ${fmt(spent.total)} 토큰` : `↺ Last turn: ${detail}${fmt(spent.total)} tokens`) + limit };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    console.log(JSON.stringify(await handle(JSON.parse(input))));
  } catch (err) {
    // A display failure must never block a prompt or ask Codex to keep working.
    console.error(`usage-prediction: ${err.message}`);
    console.log('{}');
  }
}
