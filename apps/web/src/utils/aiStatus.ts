import { OWNER_LABELS, type Owner } from '@/data/owners'

/** Advisory only: no raw provider errors, prompts or authentication metadata. */
export interface AiStatus {
  type: 'aiStatus'
  phase: 'faction' | 'batch' | 'battleFlavor' | 'settlement'
  factions: Owner[]
  status: 'ok' | 'empty' | 'partial' | 'failed'
  reason?: 'request' | 'format' | 'filtered' | 'missing'
}

export function aiStatusText(e: AiStatus): string {
  const subject = e.phase === 'faction' || e.phase === 'batch'
    ? `${e.factions.map(f => OWNER_LABELS[f] ?? f).join('、')}决策`
    : e.phase === 'battleFlavor' ? '战斗调味' : '世界叙事'
  if (e.status === 'ok') return `${subject}：取得有效回复（执行结果另见回执）`
  if (e.status === 'empty') return `${subject}：有效回复，无行动计划`
  const reason = { request: '请求失败', format: '回复格式无效',
    filtered: '部分指令被预检拒绝', missing: '部分战线缺少有效回复' }[e.reason ?? 'request']
  if (e.reason === 'filtered') return `${subject}：${reason}，仅提交通过预检的指令`
  const fallback = e.phase === 'faction' || e.phase === 'batch'
    ? '决策缺失，不代表主动按兵不动'
    : e.phase === 'battleFlavor' ? '缺失调味的战线仅按本地公式结算'
      : '使用默认叙事与日期规则'
  return `${subject}：${reason}；${fallback}`
}

export function isAiDegraded(e: AiStatus): boolean {
  return e.status === 'failed' || e.status === 'partial'
}
