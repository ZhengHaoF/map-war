import { test, describe } from 'node:test';
import * as assert from 'node:assert/strict';
import { loadAiProxyConfig, configBlockReason } from '../src/ai/ai-proxy.config';
import { authorizeAiRequest } from '../src/ai/ai-auth';
import { validateChatRequest, ChatValidationError } from '../src/ai/chat-request.schema';
import { ConcurrencyLimiter, FixedWindowRateLimiter, QueueRejectedError, AbortedError } from '../src/ai/limiters';
import { createLLMClient } from '../src/ai/llm.client';

const BASE = { LLM_API_KEY: 'sk-test', LLM_BASE_URL: 'http://127.0.0.1:9/v1', LLM_MODEL: 'deepseek-chat' };
const SECRET = 'a'.repeat(40);
const cfgOf = (extra: Record<string, string> = {}) => loadAiProxyConfig({ ...BASE, ...extra });

describe('config', () => {
  test('development defaults to local-dev with conservative budgets', () => {
    const c = cfgOf();
    assert.equal(c.authMode, 'local-dev');
    assert.deepEqual(c.errors, []);
    assert.equal(configBlockReason(c), null);
    assert.equal(c.upstreamTimeoutMs, 70_000);
    assert.equal(c.upstreamMaxRetries, 0);
    assert.equal(c.maxOutputTokens, 8192);
    assert.deepEqual(c.allowedModels, ['deepseek-chat']);
    assert.equal(c.healthProbeEnabled, false);
    // 排队 + 上游超时必须小于前端 90s 单次尝试超时
    assert.ok(c.queueTimeoutMs + c.upstreamTimeoutMs < 90_000);
  });

  test('production without auth config fails closed', () => {
    const c = cfgOf({ NODE_ENV: 'production' });
    assert.equal(c.authMode, null);
    assert.ok(c.errors.length > 0);
    assert.ok(configBlockReason(c));
  });

  test('production rejects local-dev and short secrets', () => {
    assert.ok(configBlockReason(cfgOf({ NODE_ENV: 'production', AI_PROXY_AUTH_MODE: 'local-dev' })));
    assert.ok(configBlockReason(cfgOf({ NODE_ENV: 'production', AI_PROXY_AUTH_MODE: 'shared-secret', AI_PROXY_SHARED_SECRET: 'short' })));
    assert.equal(configBlockReason(cfgOf({ NODE_ENV: 'production', AI_PROXY_AUTH_MODE: 'shared-secret', AI_PROXY_SHARED_SECRET: SECRET })), null);
  });

  test('invalid numbers / unknown modes / whitelist missing default become errors', () => {
    assert.ok(cfgOf({ AI_MAX_CONCURRENT: 'abc' }).errors.length);
    assert.ok(cfgOf({ LLM_MAX_RETRIES: '5' }).errors.length);
    assert.ok(cfgOf({ AI_PROXY_AUTH_MODE: 'open' }).errors.length);
    assert.ok(cfgOf({ LLM_ALLOWED_MODELS: 'other-model' }).errors.length);
    assert.deepEqual(cfgOf({ LLM_ALLOWED_MODELS: 'deepseek-chat, deepseek-reasoner' }).allowedModels, ['deepseek-chat', 'deepseek-reasoner']);
  });

  test('disabled mode blocks', () => {
    assert.ok(configBlockReason(cfgOf({ AI_PROXY_AUTH_MODE: 'disabled' })));
  });
});

describe('auth', () => {
  test('local-dev accepts loopback only, without forwarded headers', () => {
    const c = cfgOf();
    assert.equal(authorizeAiRequest(c, { remoteAddress: '127.0.0.1', headers: {} }).ok, true);
    assert.equal(authorizeAiRequest(c, { remoteAddress: '::ffff:127.0.0.1', headers: {} }).ok, true);
    assert.equal(authorizeAiRequest(c, { remoteAddress: '::1', headers: {} }).ok, true);
    const lan = authorizeAiRequest(c, { remoteAddress: '192.168.1.5', headers: {} });
    assert.equal(lan.ok, false);
    assert.equal(!lan.ok && lan.status, 403);
    const fwd = authorizeAiRequest(c, { remoteAddress: '127.0.0.1', headers: { 'x-forwarded-for': '8.8.8.8' } });
    assert.equal(fwd.ok, false);
    assert.equal(authorizeAiRequest(cfgOf({ AI_PROXY_DEV_ALLOW_FORWARDED: 'true' }),
      { remoteAddress: '127.0.0.1', headers: { 'x-forwarded-for': '8.8.8.8' } }).ok, true);
  });

  test('production unconfigured returns 503 even from loopback', () => {
    const r = authorizeAiRequest(cfgOf({ NODE_ENV: 'production' }), { remoteAddress: '127.0.0.1', headers: {} });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.status, 503);
  });

  test('shared-secret requires exact header; client id header trusted only after secret', () => {
    const c = cfgOf({ NODE_ENV: 'production', AI_PROXY_AUTH_MODE: 'shared-secret', AI_PROXY_SHARED_SECRET: SECRET, AI_PROXY_CLIENT_ID_HEADER: 'X-Auth-Request-User' });
    const none = authorizeAiRequest(c, { remoteAddress: '10.0.0.2', headers: { 'x-auth-request-user': 'alice' } });
    assert.equal(none.ok, false);
    assert.equal(!none.ok && none.status, 401);
    assert.equal(authorizeAiRequest(c, { remoteAddress: '10.0.0.2', headers: { 'x-ai-proxy-secret': SECRET + 'x' } }).ok, false);
    assert.equal(authorizeAiRequest(c, { remoteAddress: '10.0.0.2', headers: { 'x-ai-proxy-secret': [SECRET, SECRET] } }).ok, false);
    const ok = authorizeAiRequest(c, { remoteAddress: '10.0.0.2', headers: { 'x-ai-proxy-secret': SECRET, 'x-auth-request-user': 'alice' } });
    assert.deepEqual(ok, { ok: true, clientId: 'user:alice' });
    const noUser = authorizeAiRequest(c, { remoteAddress: '10.0.0.2', headers: { 'x-ai-proxy-secret': SECRET } });
    assert.deepEqual(noUser, { ok: true, clientId: 'ip:10.0.0.2' });
  });
});

describe('chat schema', () => {
  const c = cfgOf({ LLM_ALLOWED_MODELS: 'deepseek-chat,deepseek-reasoner' });
  const messages = [{ role: 'system', content: '你是世界 AI，输出 JSON' }, { role: 'user', content: 'hi' }];

  test('accepts the current frontend call shape and applies server budgets', () => {
    const p = validateChatRequest({ messages, response_format: { type: 'json_object' } }, c);
    assert.deepEqual(p, {
      model: 'deepseek-chat', messages, response_format: { type: 'json_object' },
      reasoning_effort: 'low', max_tokens: 8192, stream: false,
    });
    const q = validateChatRequest({ messages, model: 'deepseek-reasoner', reasoning_effort: 'high', response_format: { type: 'text' }, max_tokens: 512, temperature: 0.3 }, c);
    assert.equal(q.model, 'deepseek-reasoner');
    assert.equal(q.reasoning_effort, 'high');
    assert.equal(q.max_tokens, 512);
    assert.equal(q.temperature, 0.3);
  });

  test('accepts bounded json_schema', () => {
    const p = validateChatRequest({ messages, response_format: { type: 'json_schema', json_schema: { name: 'orders', schema: { type: 'object' }, strict: true } } }, c);
    assert.equal(p.response_format?.type, 'json_schema');
  });

  const bad: [string, unknown][] = [
    ['unknown top-level field', { messages, tools: [] }],
    ['stream', { messages, stream: true }],
    ['n', { messages, n: 5 }],
    ['model not whitelisted', { messages, model: 'gpt-4o' }],
    ['empty messages', { messages: [] }],
    ['bad role', { messages: [{ role: 'tool', content: 'x' }] }],
    ['extra message field', { messages: [{ role: 'user', content: 'x', name: 'n' }] }],
    ['non-string content', { messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }] }],
    ['bad effort', { messages, reasoning_effort: 'max' }],
    ['max_tokens over cap', { messages, max_tokens: 100_000 }],
    ['bad response_format', { messages, response_format: { type: 'xml' } }],
    ['too long message', { messages: [{ role: 'user', content: 'x'.repeat(60_001) }] }],
    ['too many messages', { messages: Array.from({ length: 41 }, () => ({ role: 'user', content: 'x' })) }],
    ['total chars over budget', { messages: [{ role: 'user', content: 'x'.repeat(60_000) }, { role: 'user', content: 'x'.repeat(40_001) }] }],
    ['not an object', [1, 2]],
  ];
  for (const [name, body] of bad) {
    test(`rejects: ${name}`, () => {
      assert.throws(() => validateChatRequest(body, c), ChatValidationError);
    });
  }
});

describe('limiters', () => {
  test('fixed window per key with refund', () => {
    let now = 0;
    const l = new FixedWindowRateLimiter(2, 1000, () => now);
    assert.equal(l.tryConsume('a'), null);
    assert.equal(l.tryConsume('a'), null);
    assert.equal(l.tryConsume('a'), 1000);
    assert.equal(l.tryConsume('b'), null);
    l.refund('a');
    assert.equal(l.tryConsume('a'), null);
    now = 1000;
    assert.equal(l.tryConsume('a'), null);
  });

  test('fixed window key cap fails closed', () => {
    const l = new FixedWindowRateLimiter(5, 1000, () => 0, 2);
    assert.equal(l.tryConsume('a'), null);
    assert.equal(l.tryConsume('b'), null);
    assert.notEqual(l.tryConsume('c'), null);
  });

  test('concurrency: queue full, timeout, abort, hand-over', async () => {
    const l = new ConcurrencyLimiter(1, 1, 50);
    const r1 = await l.acquire();
    const queued = l.acquire();
    await assert.rejects(l.acquire(), (e: unknown) => e instanceof QueueRejectedError && e.reason === 'queue_full');
    r1();
    const r2 = await queued;
    assert.equal(l.activeCount, 1);
    await assert.rejects(l.acquire(), (e: unknown) => e instanceof QueueRejectedError && e.reason === 'queue_timeout');
    const ac = new AbortController();
    const p = l.acquire(ac.signal);
    ac.abort();
    await assert.rejects(p, AbortedError);
    assert.equal(l.queuedCount, 0);
    r2();
    r2(); // 幂等
    assert.equal(l.activeCount, 0);
  });
});

describe('llm client', () => {
  test('sets explicit timeout and maxRetries; null when unconfigured', () => {
    const c = cfgOf({ LLM_TIMEOUT_MS: '30000', LLM_MAX_RETRIES: '1' });
    const client = createLLMClient(c, BASE) as unknown as { timeout: number; maxRetries: number };
    assert.equal(client.timeout, 30_000);
    assert.equal(client.maxRetries, 1);
    assert.equal(createLLMClient(loadAiProxyConfig({})), null);
  });
});
