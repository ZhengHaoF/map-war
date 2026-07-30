/**
 * 三段式外交 LLM 调用层（Phase2）。
 *
 * 三条函数对应外交总线三段：
 * 1. invokeDiplomacyRoute  —— 世界AI 校验意图 + 发出叙事（"使者出发"）
 * 2. invokeDiplomacyReply  —— 目标阵营AI 回应（stance=accept|reject|counter）
 * 3. invokeDiplomacySettle —— 世界AI 收口（叙事 + 可选世界通电）
 *
 * 关系矩阵改写（relationChange applyEvent）由 useDiplomacyBus 按 stance+intent 确定性构造，
 * LLM 不产出结构化事件——叙事归 LLM、事件归 bus，各司其职，避免 LLM 不稳定。
 */

import { callLlm } from './ai/client'
import { extractPayloads } from '@/utils/aiParse'
import { buildFactionContext } from '@/utils/aiContext'
import { buildPlayerProfile } from './ai/prompts'
import { Owner, OWNER_DETAILS, OWNER_LABELS } from '@/data/owners'
import type { DiplomacyIntent, DiplomacyStance, DiplomacyRound, Condition } from '@/utils/diplomacy'
import { INTENT_LABELS } from '@/utils/diplomacy'
import { useGameStore } from '@/stores/game'

// ════════════════════════════════════════════════════════════════
//  共享工具
// ════════════════════════════════════════════════════════════════

function ownerLabel(o: Owner): string {
  return OWNER_LABELS[o] ?? o
}

function ownerDetail(o: Owner): { leader: string; description: string } {
  const d = OWNER_DETAILS[o]
  return { leader: d?.leader ?? ownerLabel(o), description: d?.description ?? '' }
}

/**
 * 组装协商历史文本（最新在前，轮次标注）。
 * 第一轮 playerMessage 为原始意图，后续为玩家回话。
 */
function formatRounds(rounds: DiplomacyRound[]): string {
  return rounds
    .map(
      (r) =>
        `[第${r.round}轮]\n  玩家：「${r.playerMessage}」\n  对方：${r.reply}${r.counterOffer ? `（反提议：${r.counterOffer}）` : ''}`,
    )
    .join('\n')
}

/** 生成玩家势力资源摘要（银库/粮仓/城市列表，供 AI 在开出条件时参考） */
function buildPlayerResourceSummary(playerFaction: Owner): string {
  const store = useGameStore()
  const snap = store.getSnapshot()
  const silver = snap.factionTreasury[playerFaction] ?? 0
  const food = snap.factionGranary[playerFaction] ?? 0
  const cityNames = Object.entries(snap.cities)
    .filter(([, c]) => c.owner === playerFaction)
    .map(([gb]) => store.cities[gb]?.name ?? gb)
  return `银库 ${silver} 万银 | 粮仓 ${food} 万石 | 控制城市：[${cityNames.join('、')}]`
}

// ════════════════════════════════════════════════════════════════
//  第一段：校验路由
// ════════════════════════════════════════════════════════════════

export interface DiplomacyRouteResult {
  intent: DiplomacyIntent
  narrative: string // "公元1931年x月，川军遣密使赴太原…"
  ok: boolean
  reason?: string // 失败时说明原因
}

const ROUTE_SYSTEM = `你是民国军阀推演游戏的世界AI（外交路由官）。
玩家向目标势力发起外交谈判，你的任务：
1. 识别玩家意图（仅限以下六种）：结盟/停战议和/宣战/解除结盟/借道通行/交涉
2. 游戏合理性校验：
   - 不能对自身发起外交
   - "结盟"若双方已在战争中则拒绝（先停战才能结盟）
   - 目标必须为存活势力
3. isOk 判断：只有校验通过+意图可识别才为 true
4. 生成一则出发叙事（40-60 字，半文言，第三人称，提及年代、使者、目的地）。

返回纯 JSON（不含 markdown 标记）：
{"intent":"alliance","narrative":"民国二十年秋，川军遣密使携亲笔信北上太原…","isOk":true}
失败时 isOk=false + reason 字段：
{"intent":"custom","narrative":"","isOk":false,"reason":"双方尚在交战，无法结盟，须先停战"}

意图值：alliance(结盟) | peace(停战议和) | war(宣战) | breakAlliance(解除结盟) | passage(借道通行) | custom(交涉)`

async function invokeDiplomacyRoute(
  playerFaction: Owner,
  targetFaction: Owner,
  playerMessage: string,
): Promise<DiplomacyRouteResult> {
  const context = buildFactionContext(playerFaction)
  const messages = [
    { role: 'system' as const, content: ROUTE_SYSTEM },
    { role: 'system' as const, content: `玩家信息：${buildPlayerProfile()}\n玩家势力局势：\n${context}` },
    { role: 'user' as const, content: `玩家向「${ownerLabel(targetFaction)}」（${targetFaction}）发起外交，原文：「${playerMessage}」` },
  ]

  try {
    const raw = await callLlm({ messages })
    const payloads = extractPayloads(raw)
    const obj = (payloads[0] ?? {}) as Record<string, unknown>
    return {
      intent: (obj.intent as DiplomacyIntent) || 'custom',
      narrative: (obj.narrative as string) || '',
      ok: obj.isOk === true,
      reason: obj.reason as string | undefined,
    }
  } catch {
    return { intent: 'custom', narrative: '', ok: false, reason: '外交路由校验失败（网络或AI异常）' }
  }
}

// ════════════════════════════════════════════════════════════════
//  第二段：目标阵营回应
// ════════════════════════════════════════════════════════════════

export interface DiplomacyReplyResult {
  stance: DiplomacyStance
  reply: string // 对方领袖回复（50-120 字半文言）
  counterOffer?: string
  conditions?: Condition[]
}

function buildReplySystemPrompt(
  targetFaction: Owner,
  playerFaction: Owner,
  intent: DiplomacyIntent,
  playerResources: string,
): string {
  const detail = ownerDetail(targetFaction)
  const label = ownerLabel(targetFaction)
  const playerLabel = ownerLabel(playerFaction)
  const intentLabel = INTENT_LABELS[intent] ?? intent

  return `你是民国军阀推演游戏中「${label}」的领导人 ${detail.leader}。
身份：${detail.description}

${playerLabel}的使者来访，意图：${intentLabel}。
你需要根据当前局势、你的性格和利益，给出回应。

回应分三种立场：
- accept：同意对方请求。可附带条件（conditions 数组）。
- reject：拒绝。婉言谢绝或严词拒绝均可（拒绝即终结，对方不可再辩）。
- counter：提出反提议（counterOffer 字段），给对方一个还价空间。

回复要求：
- 回复 reply 字段：50-120 字，半文言，第三人称转述你的态度而非直接对话
  （例："阎锡山沉吟良久，言道晋省力薄，若川军肯割让汉中，方可议盟。"）
- 立场应结合势力实力、当前粮饷、周边敌友——强则倨傲，弱则圆滑。
- "婉言谢绝"即 reject，不必设拖延话术。

═══════════════════════════════════════
  可执行条件（conditions 数组，对方同意后系统自动执行）
═══════════════════════════════════════

你可以在 accept 或 counter 的 conditions 数组中附带可执行条件，格式如下：
- 割让城池：{"type":"cedeCity","city":"汉中"}
- 赔银（万银）：{"type":"transferSilver","amount":50}
- 赔粮（万石）：{"type":"transferFood","amount":30}
- 口头声明（不执行，仅叙事）：{"type":"verbal","text":"川军须通电全国承认晋系辖权"}

⚠ accept 或 counter 时，必须在 conditions 中重述所有当前达成的条件。
⚠ 对方不允许同意对自己不利的条件——割城只能让对方割给你，赔款只能让对方赔给你。
⚠ 条件数量克制，0-3 条即可；留白也是策略。

═══════════════════════════════════════
  对方（${playerLabel}）当前实力
═══════════════════════════════════════
${playerResources}

返回纯 JSON（不含 markdown）：
{
  "stance":"counter",
  "reply":"阎锡山阅罢来信，良久言曰：若川军肯割汉中，再助银五十万，方可共图大事。",
  "counterOffer":"川军割让汉中，另助饷五十万银",
  "conditions":[
    {"type":"cedeCity","city":"汉中"},
    {"type":"transferSilver","amount":50},
    {"type":"verbal","text":"川军须通电全国承认晋系辖权"}
  ]
}`
}

async function invokeDiplomacyReply(
  playerFaction: Owner,
  targetFaction: Owner,
  intent: DiplomacyIntent,
  rounds: DiplomacyRound[],
  playerMessage: string,
): Promise<DiplomacyReplyResult> {
  const context = buildFactionContext(targetFaction)
  const history = rounds.length > 0 ? `此前协商：\n${formatRounds(rounds)}` : ''

  const messages: { role: string; content: string }[] = [
    { role: 'system', content: buildReplySystemPrompt(targetFaction, playerFaction, intent, buildPlayerResourceSummary(playerFaction)) },
    { role: 'system', content: `${ownerLabel(targetFaction)}当前局势：\n${context}` },
  ]
  if (history) {
    messages.push({ role: 'system', content: history })
  }
  messages.push({
    role: 'user',
    content: rounds.length === 0
      ? `玩家原始陈情：「${playerMessage}」`
      : `玩家本轮发言：「${playerMessage}」`,
  })

  try {
    const raw = await callLlm({ messages })
    const payloads = extractPayloads(raw)
    const obj = (payloads[0] ?? {}) as Record<string, unknown>
    const stance: DiplomacyStance =
      obj.stance === 'accept' || obj.stance === 'reject' || obj.stance === 'counter'
        ? obj.stance
        : 'reject'
    return {
      stance,
      reply: (obj.reply as string) || '……',
      counterOffer: obj.counterOffer as string | undefined,
      conditions: parseConditions(obj.conditions),
    }
  } catch {
    return { stance: 'reject', reply: '（密使未得召见，悻悻而返。）' }
  }
}

/**
 * 解析 AI 返回的 conditions：兼容新旧格式。
 * - 新格式：[{type:'cedeCity',city:'汉中'}, ...]
 * - 旧格式纯文本：["割让汉中", ...] → 全部转为 verbal
 * - 格式错误 / 非数组 → undefined
 */
function parseConditions(raw: unknown): Condition[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const result: Condition[] = []
  for (const item of raw) {
    if (typeof item === 'string') {
      // 旧格式兼容：纯文本视为 verbal
      result.push({ type: 'verbal', text: item })
    } else if (item && typeof item === 'object') {
      const c = item as Record<string, unknown>
      const type = c.type as string
      if (type === 'cedeCity' || type === 'transferSilver' || type === 'transferFood' || type === 'verbal') {
        result.push({
          type,
          city: typeof c.city === 'string' ? c.city : undefined,
          amount: typeof c.amount === 'number' ? c.amount : undefined,
          text: typeof c.text === 'string' ? c.text : undefined,
        })
      }
    }
  }
  return result.length > 0 ? result : undefined
}

// ════════════════════════════════════════════════════════════════
//  第三段：世界AI 收口
// ════════════════════════════════════════════════════════════════

export interface DiplomacySettleResult {
  narrative: string // 收口叙事（60-120 字半文言）
  worldTelegram?: string // 可选的世界通电（宣战/结盟/停战大事公告）
}

const SETTLE_SYSTEM = `你是民国军阀推演游戏的世界AI（外交收口官）。
外交谈判已经完成，你需要根据最终磋商结果撰写一段收口叙事（60-120 字半文言，第三人称，
载明年月，如"民国二十年九月，……"）。
若为宣战/结盟/停战等重大事件，可同时生成一条 worldTelegram（世界通电，30-50 字，半文言、
如"太原通电：……"），否则 worldTelegram 字段省略。

返回纯 JSON（不含 markdown）：
{"narrative":"民国二十年秋，川军密使自太原归…","worldTelegram":"太原通电：川晋即日结盟，共御外侮。"}
若无通电则：{"narrative":"…"}`

async function invokeDiplomacySettle(
  playerFaction: Owner,
  targetFaction: Owner,
  intent: DiplomacyIntent,
  rounds: DiplomacyRound[],
  finalStance: DiplomacyStance,
): Promise<DiplomacySettleResult> {
  const history = formatRounds(rounds)
  const messages = [
    { role: 'system', content: SETTLE_SYSTEM },
    { role: 'system', content: `玩家势力：${ownerLabel(playerFaction)}（${playerFaction}）\n目标势力：${ownerLabel(targetFaction)}（${targetFaction}）\n意图：${INTENT_LABELS[intent] ?? intent}\n结局：${finalStance === 'accept' ? '对方同意' : finalStance === 'reject' ? '对方拒绝' : '对方反提议，玩家强行收口'}` },
    { role: 'user', content: `协商过程：\n${history}` },
  ]

  try {
    const raw = await callLlm({ messages })
    const payloads = extractPayloads(raw)
    const obj = (payloads[0] ?? {}) as Record<string, unknown>
    return {
      narrative: (obj.narrative as string) || '外交交涉告一段落。',
      worldTelegram: obj.worldTelegram as string | undefined,
    }
  } catch {
    return { narrative: '外交交涉告一段落。' }
  }
}

// ════════════════════════════════════════════════════════════════
//  公开接口
// ════════════════════════════════════════════════════════════════

export { invokeDiplomacyRoute, invokeDiplomacyReply, invokeDiplomacySettle, parseConditions }
