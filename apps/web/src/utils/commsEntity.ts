/**
 * 通讯实体适配层 —— 把 Telegram.from 字符串（势力代号 / country:ISO 前缀 / 系统占位）
 * 统一解析为 CommsEntity，供面板显示与 AI 回信消费。
 *
 * 设计意图：
 * - 势力（Owner 裸代号）走 OWNER_* 三套映射，与原逻辑等价
 * - 国家（country: 或 country_ 前缀）查 COUNTRY_COMMS + worldCountries
 * - 系统（PLAYER/WORLD/SYSTEM）返回固定占位
 * - 不做缓存：status 每次实时计算（城数/兵力/存亡会在回合间变化）
 */
import { Owner, OWNER_LABELS, OWNER_DETAILS, OWNER_COLORS } from '@/data/owners'
import { COUNTRY_COMMS, worldCountries } from '@/data/worldCountries'
import { useGameStore } from '@/stores/game'

export interface CommsEntity {
  /** 实体类别 */
  kind: 'faction' | 'country' | 'system'
  /** 去前缀后的代号（势力/国家） */
  code: string
  /** 显示名（领袖名优先；国家用领袖 > name；世界频道固定中文） */
  name: string
  /** 短标签（川军 / 苏联） */
  label: string
  /** 头像字（领袖首字或国名首字） */
  avatarChar: string
  /** 颜色 #rrggbb */
  colorHex: string
  /** 回信性格关键词 */
  personality: string
  /** 线路副标题（存亡·城·兵 / 军事·工业·外交） */
  status: string
  /** 线路是否畅通（势力 isAlive，国家恒 true） */
  alive: boolean
}

/** number 转 #rrggbb */
function colorToHex(c: number | undefined, fallback = '#666'): string {
  if (c === undefined) return fallback
  return '#' + c.toString(16).padStart(6, '0')
}

/**
 * 解析 Telegram.from 字符串 → CommsEntity
 *
 * 命名空间约定：
 * - 国家 private：from = "country:ISO"（冒号，代码约定）
 * - 国家 world：  from = "country_ISO"（下划线，LLM 友好）
 * - 势力：         from = "KMT"/"CCP"…（裸 Owner 枚举值）
 * - 系统：         from = "PLAYER"/"WORLD"/"SYSTEM"
 */
export function resolveEntity(from: string): CommsEntity {
  // ── 系统实体 ──
  if (from === 'WORLD') {
    return {
      kind: 'system', code: 'WORLD',
      name: '世界频道', label: '世界', avatarChar: '世',
      colorHex: '#2c1a0a', personality: '', status: '诸势力时局短评', alive: true,
    }
  }
  if (from === 'PLAYER') {
    return {
      kind: 'system', code: 'PLAYER',
      name: '玩家', label: '玩家', avatarChar: '我',
      colorHex: '#b04a3a', personality: '', status: '', alive: true,
    }
  }

  // ── 国家实体（country: 或 country_ 前缀）──
  const countryMatch = from.match(/^country[:_](.+)$/)
  if (countryMatch) {
    const iso = countryMatch[1]
    const comms = COUNTRY_COMMS[iso]
    const country = worldCountries.find((c) => c.iso_a3 === iso)
    return {
      kind: 'country', code: iso,
      name: comms?.leader ?? country?.name ?? iso,
      label: country?.name ?? iso,
      avatarChar: comms?.leader?.[0] ?? (country?.name?.[0] ?? iso[0]),
      colorHex: colorToHex(comms?.color),
      personality: comms?.personality ?? '老练务实',
      status: country
        ? `${country.full_name} · 军事${country.military} · 工业${country.industry} · ${country.diplomacy === 'HOSTILE' ? '敌对' : '中立'}`
        : iso,
      alive: true,
    }
  }

  // ── 势力实体（裸 Owner 代号）──
  const store = useGameStore()
  const detail = OWNER_DETAILS[from]
  const label = OWNER_LABELS[from as Owner] ?? from
  const alive = store.isAlive(from as Owner)
  const color = OWNER_COLORS[from as Owner]

  if (!alive) {
    return {
      kind: 'faction', code: from,
      name: detail?.leader ?? label, label,
      avatarChar: detail?.leader?.[0] ?? label[0],
      colorHex: colorToHex(color),
      personality: detail?.description?.slice(0, 20) ?? '沉稳',
      status: '已覆灭', alive: false,
    }
  }

  return {
    kind: 'faction', code: from,
    name: detail?.leader ?? label, label,
    avatarChar: detail?.leader?.[0] ?? label[0],
    colorHex: colorToHex(color),
    personality: detail?.description?.slice(0, 20) ?? '沉稳',
    status: `存活 · ${store.factionCities(from as Owner).length}城 · 兵力${store.factionTroops(from as Owner)}k`,
    alive: true,
  }
}
