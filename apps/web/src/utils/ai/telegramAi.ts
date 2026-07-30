/**
 * 电报回信 AI 模块
 *
 * 生成势力对玩家电报的回复（私信 single 或 世界公屏多人回应）。
 * 对外接口：sendTelegram(opts) → TelegramReply[]
 *
 * 原文件：src/utils/aiInvoke.ts invokeTelegramReply()
 */
import { callLlm } from './client'
import type { LlmCallOpts } from './client'
import { buildPlayerProfile } from './prompts'
import { extractPayloads } from '@/utils/aiParse'
import { OWNER_LABELS } from '@/data/owners'
import { COUNTRY_COMMS, worldCountries } from '@/data/worldCountries'

/** 势力中文名对照表（注入 prompt，让 AI 用中文名而非代号） */
const FACTION_LABELS = [
  ...Object.entries(OWNER_LABELS)
    .filter(([k]) => k !== 'NEUTRAL')
    .map(([code, label]) => `${label}=${code}`),
  ...Object.entries(COUNTRY_COMMS).map(([iso, comms]) => {
    const country = worldCountries.find((c) => c.iso_a3 === iso)
    return `${country?.name ?? iso}=country_${iso}（${comms.leader}）`
  }),
].join(', ')

/** 电报回信条目 */
export interface TelegramReply {
  name: string
  faction: string
  content: string
}

/** 电报回信输入 */
export interface TelegramOpts {
  factionName: string
  factionTag: string
  factionCode?: string
  personality: string
  situation: string
  recentChat: { from: 'player' | 'faction'; text: string; name?: string }[]
  playerMessage: string
  mode?: 'direct' | 'world'
  llmOpts?: Omit<LlmCallOpts, 'messages'>
}

const DIRECT_PROMPT = `你是「{{factionTag}}」的{{factionName}}，性格{{personality}}。
当前局势：{{situation}}。
{{playerIdentity}}
你正和该玩家通过电报对话。结合现在局势和你的身份与性格回一句话（50-80字），半文言。

必须返回 JSON 数组（只含一条）：
[{"name": "{{factionName}}", "faction": "{{code}}", "content": "你的回复内容"}]`

const WORLD_PROMPT = `你是民国军阀推演游戏的电报系统。玩家向天下喊话，1-3个势力听到后各自回应。
{{situation}}
{{playerIdentity}}
每个势力的回应要符合其代表人物的性格，20-60字，半文言，性格鲜明。回应者可以是领袖、将领或幕僚，不一定是最高领导人。

势力对照（用中文名；国民政府/中共苏区/日本关东军/东北军/晋系/桂系/川军/马家军/新疆/西藏/苏联等）：{{factionLabels}}
必须返回 JSON 数组（1-3条），每条是一个包含 name/faction/content 的独立对象，faction 用中文名：
[
  {"name": "张学良", "faction": "东北军", "content": "电文内容..."},
  {"name": "蒋中正", "faction": "国民政府", "content": "电文内容..."}
]
注意：不要用平行数组格式（不要把 name、faction、content 各写成一个数组）。
挑 1-3 个最有戏的势力即可。`

function fillDirectPrompt(opts: TelegramOpts): string {
  return DIRECT_PROMPT
    .replaceAll('{{factionTag}}', opts.factionTag)
    .replaceAll('{{factionName}}', opts.factionName)
    .replaceAll('{{personality}}', opts.personality)
    .replaceAll('{{situation}}', opts.situation)
    .replaceAll('{{code}}', opts.factionCode ?? '')
    .replaceAll('{{playerIdentity}}', buildPlayerProfile())
}

function fillWorldPrompt(opts: TelegramOpts): string {
  return WORLD_PROMPT
    .replaceAll('{{situation}}', opts.situation)
    .replaceAll('{{factionLabels}}', FACTION_LABELS)
    .replaceAll('{{playerIdentity}}', buildPlayerProfile())
}

const FALLBACK: TelegramReply = {
  name: '???',
  faction: '???',
  content: '（线路故障，电报未能送达）',
}

export async function sendTelegram(opts: TelegramOpts): Promise<TelegramReply[]> {
  const mode = opts.mode ?? 'direct'

  // fallback with actual name/faction
  const fallback: TelegramReply = {
    name: opts.factionName || FALLBACK.name,
    faction: opts.factionTag || FALLBACK.faction,
    content: FALLBACK.content,
  }

  const history = opts.recentChat
    .map((m) => `${m.from === 'player' ? '玩家' : (m.name || opts.factionName || '对方')}："${m.text}"`)
    .join('\n')

  const systemPrompt = mode === 'direct'
    ? fillDirectPrompt(opts)
    : fillWorldPrompt(opts)

  const messages: { role: string; content: string }[] = [
    { role: 'system', content: systemPrompt },
  ]
  if (history) {
    messages.push({ role: 'user', content: `近期对话：\n${history}` })
  }
  messages.push({ role: 'user', content: `玩家最新发言：「${opts.playerMessage}」` })

  try {
    const raw = await callLlm({
      messages,
      ...opts.llmOpts,
    })
    const payloads = extractPayloads(raw)
    const obj = payloads[0]
    let items: TelegramReply[] = []
    if (Array.isArray(obj)) {
      items = obj as TelegramReply[]
    } else if (obj && typeof obj === 'object') {
      const o = obj as Record<string, unknown>
      if (Array.isArray(o.data)) items = o.data as TelegramReply[]
      else if (Array.isArray(o.replies)) items = o.replies as TelegramReply[]
      else if (Array.isArray(o.responses)) items = o.responses as TelegramReply[]
      else if (typeof o.content === 'string') items = [obj as TelegramReply]
      if (!items.length) {
        for (const val of Object.values(o)) {
          if (Array.isArray(val) && val.length) {
            items = val as TelegramReply[]
            break
          }
        }
      }
    }
    items = items.filter((it) => it && typeof it.content === 'string' && it.content.trim())
    return items.length ? items : [{ ...fallback, content: '……' }]
  } catch {
    return [fallback]
  }
}
