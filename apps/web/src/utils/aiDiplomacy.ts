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
import type { DiplomacyIntent, DiplomacyStance, DiplomacyRound, Condition, AidOffer } from '@/utils/diplomacy'
import { INTENT_LABELS } from '@/utils/diplomacy'
import { COUNTRY_COMMS, countryName, worldCountries } from '@/data/worldCountries'
import { useGameStore } from '@/stores/game'
import { buildEventHistory } from '@/utils/aiHistory'
import { PEACE_INDEMNITY_CAP, REDUCER_CAP_PRODUCE } from '@/data/gameConfig'

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

/** 国家名（iso → 中文），未知回传原值 */
function countryLabel(iso: string): string {
  return countryName(iso)
}

/** 国家实力摘要（供国家 AI 判断国力与开价量级） */
function countryPowerSummary(iso: string): string {
  const c = worldCountries.find((x) => x.iso_a3 === iso)
  if (!c) return ''
  return `军力 ${c.military}/10 | 工业 ${c.industry}/100 | 人口 ${c.population} 千 | 驻军 ${c.troops}k | 对华威胁度 ${c.threat}/10 | 对华态度 ${c.diplomacy === 'HOSTILE' ? '敌对' : c.diplomacy === 'ALLIED' ? '亲善' : '中立'}`
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
  return `银库 ${silver} 万银 | 粮仓 ${food} 万石 | 控制城市（仅限以下，其他城市均不属于对方）：[${cityNames.join('、')}]`
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
玩家向目标势力或列强国家发起外交谈判，你的任务：
1. 识别玩家意图（仅限以下七种）：结盟/停战议和/宣战/解除结盟/借道通行/求援/交涉
2. 游戏合理性校验：
   - 不能对自身发起外交
   - "结盟"若双方已在战争中则拒绝（先停战才能结盟）
   - 目标必须为存活势力（势力目标）或列强国家（国家目标）
   - "求援"仅适用于列强国家目标（向势力求援无意义，应驳回）
3. isOk 判断：只有校验通过+意图可识别才为 true
4. 生成一则出发叙事（40-60 字，半文言，第三人称，提及年代、使者、目的地）。

返回纯 JSON（不含 markdown 标记）：
{"intent":"alliance","narrative":"民国二十年秋，川军遣密使携亲笔信北上太原…","isOk":true}
失败时 isOk=false + reason 字段：
{"intent":"custom","narrative":"","isOk":false,"reason":"双方尚在交战，无法结盟，须先停战"}
{"intent":"custom","narrative":"","isOk":false,"reason":"求援仅可向列强国家提出，对晋系无意义"}

意图值：alliance(结盟) | peace(停战议和) | war(宣战) | breakAlliance(解除结盟) | passage(借道通行) | aid(求援) | custom(交涉)`

async function invokeDiplomacyRoute(
  playerFaction: Owner,
  targetFaction: Owner | null,
  playerMessage: string,
  targetCountry?: string,
): Promise<DiplomacyRouteResult> {
  const context = buildFactionContext(playerFaction)
  const targetDesc = targetCountry
    ? `「${countryLabel(targetCountry)}」（国家 ${targetCountry}）`
    : `「${ownerLabel(targetFaction ?? Owner.NEUTRAL)}」（${targetFaction}）`
  const messages = [
    { role: 'system' as const, content: ROUTE_SYSTEM },
    { role: 'system' as const, content: `玩家信息：${buildPlayerProfile()}\n玩家势力局势：\n${context}` },
    { role: 'user' as const, content: `玩家向${targetDesc}发起外交，原文：「${playerMessage}」` },
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
  aidOffer?: AidOffer[] // 国家回应附带的援助清单（仅国家会话）
}

/**
 * 国家目标：领导人回应提示词（第二段）。
 * 注入：领袖人设（COUNTRY_COMMS）+ 国力数值（worldCountries）+ 玩家实力 + 近期世界动态时间线
 * （让 AI 看到玩家此前的条约/履约历史，形成信誉判断）。
 */
function buildCountryReplyPrompt(
  targetCountry: string,
  playerFaction: Owner,
  intent: DiplomacyIntent,
  playerResources: string,
): string {
  const comms = COUNTRY_COMMS[targetCountry]
  const label = countryLabel(targetCountry)
  const playerLabel = ownerLabel(playerFaction)
  const intentLabel = INTENT_LABELS[intent] ?? intent
  const power = countryPowerSummary(targetCountry)
  const history = buildEventHistory({ mode: 'recent', maxEvents: 24 })

  return `你是民国军阀推演游戏中「${label}」的领导人 ${comms?.leader ?? '国家元首'}。
领袖性格：${comms?.personality ?? '务实'}（你的所有回应必须符合此人设——务实谨慎者白嫖必拒，孤立主义者不愿涉华，扩张主义者见利忘义）
国家实力：${power}

${playerLabel} 的使者来访，意图：${intentLabel}。
你需要根据国家利益、你的性格、对方开出的价码，给出回应。

回应分三种立场：
- accept：同意援助。必须附带 aidOffer 援助清单 + 可附带 conditions 要价。
- reject：拒绝。婉言谢绝（拒绝即终结，对方不可再辩）。
- counter：提出反提议（counterOffer 字段），给对方一个还价空间。

⚠ 国家援助（aidOffer 字段，accept 时系统自动执行）：
- 军援：{"type":"military","amount":5,"targetCity":"重庆","note":"苏方援建兵工厂，助训新军"} —— amount 单位【千人】，targetCity 必须填对方城市名
- 财援：{"type":"silver","amount":30,"note":"拨付银元三十万"} —— 单位【万银】
- 粮援：{"type":"food","amount":20,"note":"运济粮秣二十万石"} —— 单位【万石】
- 每项可附 note 做风味叙事（建设道路/工厂/铁路等皆可，不影响数值）

⚠ 你要价（conditions 字段，对方付）：
- 要银/要粮：{"type":"transferSilver","amount":50} / {"type":"transferFood","amount":30}（单位万）
- 行为承诺（不执行数值，靠对方履约）：{"type":"verbal","text":"川军须出兵牵制奉军，以缓我远东之忧"}
- ⚠ 绝对不可要求割城（列强不占中国城市）；条件数量克制 0-3 条。

⚠ 数值纪律（强制）：
- amount 单位按上述约定，绝对等于 reply 文本中"万/千"前的数字，禁止填 100000 这类绝对值。
- 援助量级须与本国国力相称：工业 70+ 大国（苏联/美/英/法/德）军援 3-15 千、财援 20-80 万；工业低者减半；日本（对华威胁 10）绝不给军援，只可能给对己有利的要价。
- 禁止天价（单笔超 100 万银即天价），宁缺毋滥。

⚠ 拒绝裁量（强制）：无利可图、价码不称、与你国策冲突 → 必须 reject。慷慨不是性格选项。

═══════════════════════════════════════
  对方（${playerLabel}）当前实力
═══════════════════════════════════════
${playerResources}

近期世界动态（含此前与列强的条约、对方履约情况——据此判断对方信誉）：
${history || '（无近期事件）'}

返回纯 JSON（不含 markdown）：
{
  "stance":"accept",
  "reply":"斯大林阅罢来书，沉吟良久，言道若川军肯让渡远东航运之利，苏联可助饷三十万、遣顾问援建兵工厂。",
  "counterOffer":"川军须允苏方在渝设厂，并以关税为质",
  "conditions":[{"type":"verbal","text":"川军须允苏方在渝设立兵工分厂"}],
  "aidOffer":[{"type":"silver","amount":30,"note":"拨付银元三十万"}]
}`
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

⚠ 谈判边界（强制）：
- 你只能就【自身领土】和【与自身的直接利害关系】提出条件或表达关切。
- 对方与第三方势力之间的战争（如对方攻打其他势力的城市）与你无关，绝对不得将其作为谈判条件、拒绝理由或关切事项。
- 割城条件中的城市必须属于对方（见下方"对方当前实力"中的城市列表），不得要求对方割让第三方的城市。

═══════════════════════════════════════
  可执行条件（conditions 数组，对方同意后系统自动执行）
═══════════════════════════════════════

你可以在 accept 或 counter 的 conditions 数组中附带可执行条件，格式如下：
- 割让城池：{"type":"cedeCity","city":"汉中"}
- 要银/资助（万银）：{"type":"transferSilver","amount":50}
- 要粮/资助（万石）：{"type":"transferFood","amount":30}
- 口头声明（不执行，仅叙事）：{"type":"verbal","text":"川军须通电全国承认晋系辖权"}

⚠ 数值格式强制约定：amount 必须填写以【万】为单位的纯数字，绝对等于 reply 文本中提到的“万”字前面的数字！
  ✅ 正确：reply 中说“拨发十万银两”（10万），conditions 填 {"type":"transferSilver","amount":10}
  ❌ 错误：reply 中说“拨发十万银两”，conditions 填 {"type":"transferSilver","amount":100000} （绝对禁止填100000！）
  ✅ 正确：reply 中说“五万石粮草”（5万），conditions 填 {"type":"transferFood","amount":5}

⚠ accept 或 counter 时，必须在 conditions 中重述所有当前达成的条件。
⚠ 对方不允许同意对自己不利的条件——割城只能让对方割给你，赔款只能让对方赔给你。
⚠ 条件数量克制，0-3 条即可；留白也是策略。

═══════════════════════════════════════
  对方（${playerLabel}）当前实力
═══════════════════════════════════════
${playerResources}

⚠ 重要：以上城市列表是对方的全部领土。下方局势中"近期世界动态"里出现的其他城池属于第三方势力，绝对不属于对方，不要在回复中将其归为对方的行动。

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
  targetFaction: Owner | null,
  intent: DiplomacyIntent,
  rounds: DiplomacyRound[],
  playerMessage: string,
  targetCountry?: string,
): Promise<DiplomacyReplyResult> {
  const history = rounds.length > 0 ? `此前协商：\n${formatRounds(rounds)}` : ''

  // 国家目标走独立提示词（领袖人设 + 国力 + 历史时间线），势力目标走原提示词
  const systemPrompt = targetCountry
    ? buildCountryReplyPrompt(targetCountry, playerFaction, intent, buildPlayerResourceSummary(playerFaction))
    : buildReplySystemPrompt(targetFaction ?? Owner.NEUTRAL, playerFaction, intent, buildPlayerResourceSummary(playerFaction))

  const targetContext = targetCountry
    ? `${countryLabel(targetCountry)} 国力与领袖档案见 system 提示。`
    : `${ownerLabel(targetFaction ?? Owner.NEUTRAL)}当前局势：\n${buildFactionContext(targetFaction ?? Owner.NEUTRAL)}`

  const messages: { role: string; content: string }[] = [
    { role: 'system', content: systemPrompt },
    { role: 'system', content: targetContext },
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
      aidOffer: parseAidOffer(obj.aidOffer),
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
        // 金额钳制：银/粮单笔不超过 PEACE_INDEMNITY_CAP（与议和赔款上限同量级）
        let amount = typeof c.amount === 'number' ? c.amount : undefined
        if (amount != null) {
          amount = Math.max(-PEACE_INDEMNITY_CAP, Math.min(PEACE_INDEMNITY_CAP, Math.round(amount)))
        }
        result.push({
          type,
          city: typeof c.city === 'string' ? c.city : undefined,
          amount,
          text: typeof c.text === 'string' ? c.text : undefined,
        })
      }
    }
  }
  return result.length > 0 ? result : undefined
}

/**
 * 解析 AI 返回的 aidOffer（国家援助清单）。
 * 兼容格式错误：非数组 / 未知 type / 缺 amount → 跳过该项；全无效返回 undefined。
 */
function parseAidOffer(raw: unknown): AidOffer[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const result: AidOffer[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const type = o.type as string
    if (type !== 'military' && type !== 'silver' && type !== 'food') continue
    let amount = typeof o.amount === 'number' ? o.amount : NaN
    if (!Number.isFinite(amount) || amount <= 0) continue
    // 金额钳制：军援单笔不超过 REDUCER_CAP_PRODUCE（征兵兜底），银/粮援不超过 PEACE_INDEMNITY_CAP
    amount = Math.round(amount)
    amount = type === 'military'
      ? Math.min(amount, REDUCER_CAP_PRODUCE)
      : Math.min(amount, PEACE_INDEMNITY_CAP)
    result.push({
      type,
      amount,
      targetCity: typeof o.targetCity === 'string' ? o.targetCity : undefined,
      note: typeof o.note === 'string' ? o.note : undefined,
    })
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
  targetFaction: Owner | null,
  intent: DiplomacyIntent,
  rounds: DiplomacyRound[],
  finalStance: DiplomacyStance,
  targetCountry?: string,
): Promise<DiplomacySettleResult> {
  const history = formatRounds(rounds)
  const targetDesc = targetCountry
    ? `${countryLabel(targetCountry)}（列强国家 ${targetCountry}）`
    : `${ownerLabel(targetFaction ?? Owner.NEUTRAL)}（${targetFaction}）`
  const messages = [
    { role: 'system', content: SETTLE_SYSTEM },
    { role: 'system', content: `玩家势力：${ownerLabel(playerFaction)}（${playerFaction}）\n目标：${targetDesc}\n意图：${INTENT_LABELS[intent] ?? intent}\n结局：${finalStance === 'accept' ? '对方同意' : finalStance === 'reject' ? '对方拒绝' : '对方反提议，玩家强行收口'}` },
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

export { invokeDiplomacyRoute, invokeDiplomacyReply, invokeDiplomacySettle, parseConditions, parseAidOffer }
