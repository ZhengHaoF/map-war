import 'reflect-metadata';
import { test, describe, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AiModule } from '../src/ai/ai.module';
import { loadAiProxyConfig } from '../src/ai/ai-proxy.config';
import { AI_PROXY_CONFIG, LLM_CLIENT, LlmRequestOptions } from '../src/ai/llm.client';
import { configureApp } from '../src/bootstrap';

Logger.overrideLogger(false);

const BASE = { LLM_API_KEY: 'sk-test', LLM_BASE_URL: 'http://127.0.0.1:9/v1', LLM_MODEL: 'deepseek-chat' };
const SECRET = 's'.repeat(48);

interface Call { params: Record<string, unknown>; options?: LlmRequestOptions }

/** 假上游：永不发起网络请求 */
function fakeClient(behavior: 'ok' | 'hang' | 'fail' = 'ok') {
  const calls: Call[] = [];
  const aborted: boolean[] = [];
  const client = {
    chat: {
      completions: {
        create(params: Record<string, unknown>, options?: LlmRequestOptions) {
          calls.push({ params, options });
          if (behavior === 'fail') return Promise.reject(Object.assign(new Error('upstream boom'), { status: 500 }));
          if (behavior === 'hang') {
            return new Promise((_, reject) => {
              options?.signal?.addEventListener('abort', () => { aborted.push(true); reject(new Error('aborted')); });
            });
          }
          return Promise.resolve({ id: 'x', choices: [{ index: 0, message: { role: 'assistant', content: '{"orders":[]}' }, finish_reason: 'stop' }] });
        },
      },
    },
  };
  return { client, calls, aborted };
}

const apps: NestExpressApplication[] = [];
after(async () => { await Promise.all(apps.map(a => a.close())); });

async function startApp(env: Record<string, string>, client: unknown) {
  const cfg = loadAiProxyConfig({ ...BASE, ...env });
  const mod = await Test.createTestingModule({ imports: [AiModule] })
    .overrideProvider(AI_PROXY_CONFIG).useValue(cfg)
    .overrideProvider(LLM_CLIENT).useValue(client)
    .compile();
  const app = mod.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
  configureApp(app, {});
  await app.listen(0, '127.0.0.1');
  apps.push(app);
  const { port } = app.getHttpServer().address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

const messages = [{ role: 'system', content: '输出 JSON' }, { role: 'user', content: '行动' }];
const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${url}/api/ai/chat`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

describe('POST /api/ai/chat (local-dev)', () => {
  test('forwards only whitelisted params with explicit timeout/maxRetries', async () => {
    const f = fakeClient();
    const url = await startApp({}, f.client);
    const res = await post(url, { messages, response_format: { type: 'json_object' } });
    assert.equal(res.status, 200);
    const json = await res.json() as { choices: unknown[] };
    assert.equal(json.choices.length, 1);
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.calls[0].params, {
      model: 'deepseek-chat', messages, response_format: { type: 'json_object' },
      reasoning_effort: 'low', max_tokens: 8192, stream: false,
    });
    assert.equal(f.calls[0].options?.timeout, 70_000);
    assert.equal(f.calls[0].options?.maxRetries, 0);
    assert.ok(f.calls[0].options?.signal instanceof AbortSignal);
  });

  test('rejects unknown fields and non-whitelisted models without calling upstream', async () => {
    const f = fakeClient();
    const url = await startApp({}, f.client);
    const r1 = await post(url, { messages, tools: [{ type: 'function' }] });
    assert.equal(r1.status, 400);
    const b1 = await r1.json() as { code: string; detail: string };
    assert.equal(b1.code, 'ai_invalid_request');
    assert.match(b1.detail, /tools/);
    const r2 = await post(url, { messages, model: 'gpt-4o' });
    assert.equal(r2.status, 400);
    assert.equal(f.calls.length, 0);
  });

  test('rejects forwarded requests in local-dev', async () => {
    const f = fakeClient();
    const url = await startApp({}, f.client);
    const res = await post(url, { messages }, { 'x-forwarded-for': '203.0.113.9' });
    assert.equal(res.status, 403);
    assert.equal(f.calls.length, 0);
  });

  test('oversized body → 413', async () => {
    const f = fakeClient();
    const url = await startApp({ AI_MAX_BODY_BYTES: '2048' }, f.client);
    const res = await post(url, { messages: [{ role: 'user', content: 'x'.repeat(5000) }] });
    assert.equal(res.status, 413);
    assert.equal(f.calls.length, 0);
  });

  test('per-client rate limit → 429 with Retry-After', async () => {
    const f = fakeClient();
    const url = await startApp({ AI_RATE_LIMIT_PER_CLIENT_PER_MIN: '2' }, f.client);
    assert.equal((await post(url, { messages })).status, 200);
    assert.equal((await post(url, { messages })).status, 200);
    const res = await post(url, { messages });
    assert.equal(res.status, 429);
    assert.ok(Number(res.headers.get('retry-after')) > 0);
    assert.equal(f.calls.length, 2);
  });

  test('upstream error → 502', async () => {
    const url = await startApp({}, fakeClient('fail').client);
    const res = await post(url, { messages });
    assert.equal(res.status, 502);
  });

  test('LLM not configured → 503 (previous behavior kept)', async () => {
    const url = await startApp({}, null);
    const res = await post(url, { messages });
    assert.equal(res.status, 503);
    assert.equal((await res.json() as { code: string }).code, 'ai_not_configured');
  });

  test('client disconnect aborts the upstream request and frees the slot', async () => {
    const f = fakeClient('hang');
    const url = await startApp({ AI_MAX_CONCURRENT: '1', AI_MAX_QUEUE: '0' }, f.client);
    const { hostname, port } = new URL(url);
    await new Promise<void>((resolve) => {
      const req = http.request({ hostname, port, path: '/api/ai/chat', method: 'POST', headers: { 'content-type': 'application/json' } });
      req.on('error', () => resolve());
      req.end(JSON.stringify({ messages }));
      const poll = setInterval(() => {
        if (f.calls.length === 1) { clearInterval(poll); req.destroy(); }
      }, 5);
    });
    for (let i = 0; i < 100 && f.aborted.length === 0; i++) await new Promise(r => setTimeout(r, 10));
    assert.equal(f.aborted.length, 1);
    // 名额已释放：下一个请求能进入上游（而非 503 ai_busy）
    const ac = new AbortController();
    const next = fetch(`${url}/api/ai/chat`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages }), signal: ac.signal }).catch(() => null);
    for (let i = 0; i < 100 && f.calls.length < 2; i++) await new Promise(r => setTimeout(r, 10));
    assert.equal(f.calls.length, 2);
    ac.abort();
    await next;
    for (let i = 0; i < 100 && f.aborted.length < 2; i++) await new Promise(r => setTimeout(r, 10));
    assert.equal(f.aborted.length, 2);
  });

  test('concurrency queue full → 503 ai_busy', async () => {
    const f = fakeClient('hang');
    const url = await startApp({ AI_MAX_CONCURRENT: '1', AI_MAX_QUEUE: '0' }, f.client);
    const ac = new AbortController();
    const first = fetch(`${url}/api/ai/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages }), signal: ac.signal }).catch(() => null);
    for (let i = 0; i < 100 && f.calls.length === 0; i++) await new Promise(r => setTimeout(r, 10));
    const res = await post(url, { messages });
    assert.equal(res.status, 503);
    assert.equal((await res.json() as { code: string }).code, 'ai_busy');
    ac.abort();
    await first;
  });
});

describe('production auth', () => {
  test('production without auth config refuses AI calls (fail closed)', async () => {
    const f = fakeClient();
    const url = await startApp({ NODE_ENV: 'production' }, f.client);
    const res = await post(url, { messages });
    assert.equal(res.status, 503);
    const health = await (await fetch(`${url}/api/ai/health`)).json() as { ok: boolean };
    assert.equal(health.ok, false);
    assert.equal(f.calls.length, 0);
  });

  test('shared-secret injected by reverse proxy', async () => {
    const f = fakeClient();
    const url = await startApp({ NODE_ENV: 'production', AI_PROXY_AUTH_MODE: 'shared-secret', AI_PROXY_SHARED_SECRET: SECRET }, f.client);
    assert.equal((await post(url, { messages })).status, 401);
    assert.equal((await post(url, { messages }, { 'x-ai-proxy-secret': 'wrong' })).status, 401);
    const ok = await post(url, { messages, reasoning_effort: 'medium', response_format: { type: 'text' } },
      { 'x-ai-proxy-secret': SECRET, 'x-forwarded-for': '198.51.100.7' });
    assert.equal(ok.status, 200);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].params.reasoning_effort, 'medium');
  });
});

describe('GET /api/ai/health', () => {
  test('default health never calls the model', async () => {
    const f = fakeClient();
    const url = await startApp({}, f.client);
    const res = await fetch(`${url}/api/ai/health`);
    assert.equal(res.status, 200);
    const body = await res.json() as { ok: boolean; probed: boolean };
    assert.equal(body.ok, true);
    assert.equal(body.probed, false);
    const probe = await fetch(`${url}/api/ai/health?probe=1`);
    assert.equal(probe.status, 403);
    assert.equal(f.calls.length, 0);
  });

  test('opt-in probe is authenticated, budgeted and cached', async () => {
    const f = fakeClient();
    const url = await startApp({ AI_HEALTH_PROBE_ENABLED: 'true' }, f.client);
    const forwarded = await fetch(`${url}/api/ai/health?probe=1`, { headers: { 'x-forwarded-for': '203.0.113.1' } });
    assert.equal(forwarded.status, 403);
    const a = await (await fetch(`${url}/api/ai/health?probe=1`)).json() as { ok: boolean; probed: boolean };
    const b = await (await fetch(`${url}/api/ai/health?probe=1`)).json() as { cached?: boolean };
    assert.equal(a.ok, true);
    assert.equal(a.probed, true);
    assert.equal(b.cached, true);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].params.max_tokens, 16);
  });
});
