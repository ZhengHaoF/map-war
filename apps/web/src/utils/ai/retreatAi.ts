/**
 * 撤退裁决 AI 模块
 *
 * 敌方阵营判断是否追击撤退中的玩家部队。
 * 对外接口：judgeRetreat(opts) → RetreatResult
 *
 * 原文件：src/utils/aiInvoke.ts invokeRetreatOutcome()
 */
import { callLlm } from './client'
import type { LlmCallOpts } from './client'
import { buildPlayerProfile } from './prompts'
import { extractPayloads } from '@/utils/aiParse'

/** 撤退裁决输入 */
export interface RetreatOpts {
  defenderTag: string
  defenderLeader: string
  personality: string
  attackerTag: string
  fromName: string
  toName: string
  atkForce: number
  defForce: number
  turns: number
  lastAtkLoss: number
  lastDefLoss: number
  llmOpts?: Omit<LlmCallOpts, 'messages'>
}

/** 撤退裁决结果 */
export interface RetreatResult {
  pursuitLoss: number
  narrative: string
}

const SYSTEM_PROMPT = `你是「{{defenderTag}}」的{{defenderLeader}}，性格{{personality}}。
{{playerIdentity}}
{{attackerTag}}（玩家）围攻{{toName}}后请求收兵撤退。战况：
  攻方野战兵 {{atkForce}}k，守方驻军 {{defForce}}k，已战 {{turns}} 回合
  上回合 攻损 {{lastAtkLoss}}k / 守损 {{lastDefLoss}}k

裁决这次撤退的经过：
- 若你兵力占优、士气正盛，可下令追击，造成减员（追击减员不得超过 {{atkForce}}k）
- 若你已疲敝、乐见停战，可目送其归去，减员为 0
- 须符合你的性格（暴烈者追击凶，持重者多礼送）

必须只返回一个 JSON 对象：
{"pursuitLoss": 减员数(k,整数,0=不追击), "narrative": "30-60字半文言撤退经过加上其他内容（这是对用户说的，可以是符合对方性格的对用户的嘲讽之类的）"}`

function fillPrompt(opts: RetreatOpts): string {
  return SYSTEM_PROMPT
    .replaceAll('{{defenderTag}}', opts.defenderTag)
    .replaceAll('{{defenderLeader}}', opts.defenderLeader)
    .replaceAll('{{personality}}', opts.personality)
    .replaceAll('{{attackerTag}}', opts.attackerTag)
    .replaceAll('{{toName}}', opts.toName)
    .replaceAll('{{atkForce}}', String(opts.atkForce))
    .replaceAll('{{defForce}}', String(opts.defForce))
    .replaceAll('{{turns}}', String(opts.turns))
    .replaceAll('{{lastAtkLoss}}', String(opts.lastAtkLoss))
    .replaceAll('{{lastDefLoss}}', String(opts.lastDefLoss))
    .replaceAll('{{playerIdentity}}', buildPlayerProfile())
}

const FALLBACK: RetreatResult = {
  pursuitLoss: 0,
  narrative: '敌军未追，我军安然收兵。',
}

export async function judgeRetreat(opts: RetreatOpts): Promise<RetreatResult> {
  try {
    const raw = await callLlm({
      messages: [
        { role: 'system', content: fillPrompt(opts) },
        { role: 'user', content: `${opts.attackerTag}欲从「${opts.fromName} → ${opts.toName}」战线撤退。` },
      ],
    })
    const payloads = extractPayloads(raw)
    const obj = (payloads?.[0] ?? {}) as Record<string, unknown>
    const pursuitLoss = Math.max(0, Math.min(
      typeof obj.pursuitLoss === 'number' ? Math.round(obj.pursuitLoss) : 0,
      opts.atkForce,
    ))
    const narrative = typeof obj.narrative === 'string' && obj.narrative.trim()
      ? obj.narrative.trim()
      : FALLBACK.narrative
    return { pursuitLoss, narrative }
  } catch {
    return FALLBACK
  }
}
