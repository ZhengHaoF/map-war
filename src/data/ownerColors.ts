import { Owner } from './owners'

/** 政权颜色映射（PixiJS 使用 0xRRGGBB 格式） */
export const OWNER_COLORS = {
  [Owner.KMT]: 0x3b82f6, // 蓝色 - 国民政府
  [Owner.CCP]: 0xef4444, // 红色 - 中共苏区
  [Owner.JPN]: 0xa855f7, // 紫色 - 日本
  [Owner.NEA]: 0x6b7280, // 灰色 - 东北军
  [Owner.SHX]: 0xf97316, // 橙色 - 晋系
  [Owner.GXC]: 0x22c55e, // 绿色 - 桂系
  [Owner.SCC]: 0xca8a04, // 黄褐 - 川军
  [Owner.MA]: 0x06b6d4,  // 青色 - 马家军
  [Owner.XJ]: 0x92400e,  // 棕色 - 新疆
  [Owner.TIB]: 0xeab308, // 金色 - 西藏
}

/** 政权中文名 */
export const OWNER_LABELS = {
  [Owner.KMT]: '国民政府',
  [Owner.CCP]: '中共苏区',
  [Owner.JPN]: '日本关东军',
  [Owner.NEA]: '东北军',
  [Owner.SHX]: '晋系',
  [Owner.GXC]: '桂系',
  [Owner.SCC]: '川军',
  [Owner.MA]: '马家军',
  [Owner.XJ]: '新疆',
  [Owner.TIB]: '西藏',
}
