import { AiProxyConfig, ReasoningEffort, VALID_EFFORTS } from './ai-proxy.config';

/**
 * /api/ai/chat 请求体的显式白名单 schema。
 * 只构造允许的字段发往上游；未知字段直接 400（不静默透传，也不静默丢弃，
 * 避免 tools / stream / n / logit_bias / user 等字段绕过预算或改变计费）。
 */
export const ALLOWED_FIELDS = [
  'messages',
  'model',
  'response_format',
  'reasoning_effort',
  'max_tokens',
  'temperature',
] as const;

export type ChatRole = 'system' | 'user' | 'assistant';
const ROLES: readonly ChatRole[] = ['system', 'user', 'assistant'];

export type ResponseFormat =
  | { type: 'text' }
  | { type: 'json_object' }
  | { type: 'json_schema'; json_schema: { name: string; schema: Record<string, unknown>; strict?: boolean; description?: string } };

export interface SanitizedChatParams {
  model: string;
  messages: { role: ChatRole; content: string }[];
  response_format?: ResponseFormat;
  reasoning_effort: ReasoningEffort;
  max_tokens: number;
  temperature?: number;
  stream: false;
}

export class ChatValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(issues.join('; '));
    this.name = 'ChatValidationError';
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}

function validateResponseFormat(v: unknown, cfg: AiProxyConfig, issues: string[]): ResponseFormat | undefined {
  if (!isPlainObject(v)) {
    issues.push('response_format 必须是对象');
    return undefined;
  }
  const type = v.type;
  if (type === 'text' || type === 'json_object') {
    const extra = Object.keys(v).filter(k => k !== 'type');
    if (extra.length) issues.push(`response_format 不支持字段: ${extra.join(', ')}`);
    return { type };
  }
  if (type === 'json_schema') {
    const extra = Object.keys(v).filter(k => k !== 'type' && k !== 'json_schema');
    if (extra.length) issues.push(`response_format 不支持字段: ${extra.join(', ')}`);
    const js = v.json_schema;
    if (!isPlainObject(js)) {
      issues.push('response_format.json_schema 必须是对象');
      return undefined;
    }
    const jsExtra = Object.keys(js).filter(k => !['name', 'schema', 'strict', 'description'].includes(k));
    if (jsExtra.length) issues.push(`response_format.json_schema 不支持字段: ${jsExtra.join(', ')}`);
    if (typeof js.name !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(js.name)) {
      issues.push('response_format.json_schema.name 必须是 1-64 位字母数字/下划线/连字符');
    }
    if (!isPlainObject(js.schema)) issues.push('response_format.json_schema.schema 必须是对象');
    else if (JSON.stringify(js.schema).length > cfg.maxJsonSchemaChars) {
      issues.push(`response_format.json_schema.schema 超过 ${cfg.maxJsonSchemaChars} 字符上限`);
    }
    if (js.strict !== undefined && typeof js.strict !== 'boolean') issues.push('response_format.json_schema.strict 必须是布尔值');
    if (js.description !== undefined && (typeof js.description !== 'string' || js.description.length > 1000)) {
      issues.push('response_format.json_schema.description 必须是不超过 1000 字符的字符串');
    }
    return {
      type: 'json_schema',
      json_schema: {
        name: js.name as string,
        schema: js.schema as Record<string, unknown>,
        ...(js.strict !== undefined ? { strict: js.strict as boolean } : {}),
        ...(js.description !== undefined ? { description: js.description as string } : {}),
      },
    };
  }
  issues.push('response_format.type 只能是 text / json_object / json_schema');
  return undefined;
}

export function validateChatRequest(body: unknown, cfg: AiProxyConfig): SanitizedChatParams {
  const issues: string[] = [];
  if (!isPlainObject(body)) throw new ChatValidationError(['请求体必须是 JSON 对象']);

  const unknown = Object.keys(body).filter(k => !(ALLOWED_FIELDS as readonly string[]).includes(k));
  if (unknown.length) issues.push(`不支持的字段: ${unknown.slice(0, 10).join(', ')}`);

  // messages
  const messages: SanitizedChatParams['messages'] = [];
  const rawMessages = body.messages;
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    issues.push('messages 必须是非空数组');
  } else if (rawMessages.length > cfg.maxMessages) {
    issues.push(`messages 最多 ${cfg.maxMessages} 条（当前 ${rawMessages.length}）`);
  } else {
    let total = 0;
    rawMessages.forEach((m, i) => {
      if (!isPlainObject(m)) {
        issues.push(`messages[${i}] 必须是对象`);
        return;
      }
      const extra = Object.keys(m).filter(k => k !== 'role' && k !== 'content');
      if (extra.length) issues.push(`messages[${i}] 不支持字段: ${extra.join(', ')}`);
      if (typeof m.role !== 'string' || !(ROLES as readonly string[]).includes(m.role)) {
        issues.push(`messages[${i}].role 只能是 ${ROLES.join(' / ')}`);
      }
      if (typeof m.content !== 'string') {
        issues.push(`messages[${i}].content 必须是字符串`);
        return;
      }
      if (m.content.length > cfg.maxMessageChars) {
        issues.push(`messages[${i}].content 超过单条 ${cfg.maxMessageChars} 字符上限`);
      }
      total += m.content.length;
      messages.push({ role: m.role as ChatRole, content: m.content });
    });
    if (total > cfg.maxTotalChars) issues.push(`messages 总长度 ${total} 超过 ${cfg.maxTotalChars} 字符上限`);
  }

  // model（白名单）
  let model = cfg.defaultModel;
  if (body.model !== undefined) {
    if (typeof body.model !== 'string' || !body.model.trim()) issues.push('model 必须是非空字符串');
    else if (!cfg.allowedModels.includes(body.model.trim())) issues.push(`model 不在允许列表中: ${body.model.slice(0, 80)}`);
    else model = body.model.trim();
  }

  // reasoning_effort
  let reasoning_effort = cfg.defaultReasoningEffort;
  if (body.reasoning_effort !== undefined) {
    if (typeof body.reasoning_effort !== 'string' || !(VALID_EFFORTS as readonly string[]).includes(body.reasoning_effort)) {
      issues.push(`reasoning_effort 只能是 ${VALID_EFFORTS.join(' / ')}`);
    } else {
      reasoning_effort = body.reasoning_effort as ReasoningEffort;
    }
  }

  // max_tokens（输出预算：只能调低，不能超过服务端上限）
  let max_tokens = cfg.maxOutputTokens;
  if (body.max_tokens !== undefined) {
    const v = body.max_tokens;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > cfg.maxOutputTokens) {
      issues.push(`max_tokens 必须是 1..${cfg.maxOutputTokens} 的整数`);
    } else {
      max_tokens = v;
    }
  }

  let temperature: number | undefined;
  if (body.temperature !== undefined) {
    const v = body.temperature;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 2) issues.push('temperature 必须是 0..2 的数字');
    else temperature = v;
  }

  const response_format = body.response_format !== undefined
    ? validateResponseFormat(body.response_format, cfg, issues)
    : undefined;

  if (issues.length) throw new ChatValidationError(issues);

  return {
    model,
    messages,
    ...(response_format ? { response_format } : {}),
    reasoning_effort,
    max_tokens,
    ...(temperature !== undefined ? { temperature } : {}),
    stream: false,
  };
}
