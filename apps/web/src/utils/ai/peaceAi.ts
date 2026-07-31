/**
 * 求和谈判 AI 模块
 *
 * 敌方 AI 裁定是否接受停战及赔款条件。
 * 对外接口：negotiatePeace(opts) → PeaceResult
 *
 * 原文件：src/utils/aiInvoke.ts invokePeaceOutcome()
 */
import { callLlm } from './client'
import type { LlmCallOpts } from './client'
import { buildPlayerProfile } from './prompts'
import { extractPayloads } from '@/utils/aiParse'

/** 求和谈判输入 */
export interface PeaceOpts {
  foeTag: string
  foeLeader: string
  personality: string
  playerTag: string
  playerSide: 'attacker' | 'defender'
  fromName: string
  toName: string
  myForce: number
  foeForce: number
  turns: number
  myLastLoss: number
  foeLastLoss: number
  myTreasury: number
  foeTreasury: number
  round: number
  playerCounter?: number
  llmOpts?: Omit<LlmCallOpts, 'messages'>
}

/** 求和谈判结果 */
export interface PeaceResult {
  accept: boolean
  indemnity: number
  narrative: string
  final: boolean
}

import { PEACE_INDEMNITY_CAP } from '@/data/gameConfig'

const SYSTEM_PROMPT = `你是「{{foeTag}}」的{{foeLeader}}，性格{{personality}}。
{{playerIdentity}}
战况：{{playerTag}}（玩家）正{{sideText}}。
  玩家兵力 {{myForce}}k，我方兵力 {{foeForce}}k，已战 {{turns}} 回合
  上回合 玩家损 {{myLastLoss}}k / 我方损 {{foeLastLoss}}k
  玩家银库 {{myTreasury}} 万银，我方银库 {{foeTreasury}} 万银
这是第 {{round}} 轮谈判（至多 3 轮）。{{counterLine}}

裁定是否接受停战、以及赔款条件：
- 若我方占优（玩家兵劣、损重、久攻不下），可索要赔款；玩家越弱、战越久，要价越高
- 若我方不利或战事胶着，可少要甚至倒贴求和（赔款为负）
- 好战者苛刻、务实者见好就收、持重者重信守约
- 赔款为整数万银，正数=玩家付给我方，负数=我方付给玩家；绝对值不宜超过 {{cap}}
- 第 3 轮或你已无退让余地时，把 final 设为 true

必须只返回一个 JSON 对象：
{"accept": 是否接受(true/false), "indemnity": 赔款整数(玩家视角万银), "narrative": "30-70字半文言回应", "final": 是否最终报价(true/false)}`

function fillPrompt(opts: PeaceOpts): string {
  const sideText = opts.playerSide === 'attacker'
    ? `围攻${opts.toName}（${opts.playerTag} 主攻）`
    : `据守${opts.toName}（${opts.playerTag} 主守）`
  const counterLine = opts.playerCounter != null
    ? `\n玩家本轮还价：愿赔 ${opts.playerCounter} 万银（负数表示反要你家赔款）。请就这个数回应：接受、或报出你的最终数。`
    : '\n这是玩家首次求和。请开价。'

  return SYSTEM_PROMPT
    .replaceAll('{{foeTag}}', opts.foeTag)
    .replaceAll('{{foeLeader}}', opts.foeLeader)
    .replaceAll('{{personality}}', opts.personality)
    .replaceAll('{{playerTag}}', opts.playerTag)
    .replaceAll('{{sideText}}', sideText)
    .replaceAll('{{myForce}}', String(opts.myForce))
    .replaceAll('{{foeForce}}', String(opts.foeForce))
    .replaceAll('{{turns}}', String(opts.turns))
    .replaceAll('{{myLastLoss}}', String(opts.myLastLoss))
    .replaceAll('{{foeLastLoss}}', String(opts.foeLastLoss))
    .replaceAll('{{myTreasury}}', String(opts.myTreasury))
    .replaceAll('{{foeTreasury}}', String(opts.foeTreasury))
    .replaceAll('{{round}}', String(opts.round))
    .replaceAll('{{counterLine}}', counterLine)
    .replaceAll('{{cap}}', String(PEACE_INDEMNITY_CAP))
    .replaceAll('{{playerIdentity}}', buildPlayerProfile())
}

const FALLBACK: PeaceResult = {
  accept: false,
  indemnity: 0,
  narrative: '来使未及陈词，已遭逐出辕门。和议不成，唯战而已。',
  final: false,
}

export async function negotiatePeace(opts: PeaceOpts): Promise<PeaceResult> {
  try {
    const raw = await callLlm({
      messages: [
        { role: 'system', content: fillPrompt(opts) },
        { role: 'user', content: `${opts.playerTag}遣使至${opts.foeTag}辕门，请议和。` },
      ],
    })
    const payloads = extractPayloads(raw)
    const obj = (payloads?.[0] ?? {}) as Record<string, unknown>
    const accept = obj.accept === true
    let indemnity = typeof obj.indemnity === 'number' ? Math.round(obj.indemnity) : 0
    indemnity = Math.max(-PEACE_INDEMNITY_CAP, Math.min(PEACE_INDEMNITY_CAP, indemnity))
    const narrative = typeof obj.narrative === 'string' && obj.narrative.trim()
      ? obj.narrative.trim()
      : FALLBACK.narrative
    const final = obj.final === true
    return { accept, indemnity, narrative, final }
  } catch {
    return FALLBACK
  }
}
