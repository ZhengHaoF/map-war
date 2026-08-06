/**
 * 烽火舆图 —— 游戏平衡参数统一配置
 *
 * 所有可调参数集中在此文件，按功能分组、中文注释。
 * 各模块（economy / battleFormula / aiContext 等）从此导入，不再本地定义。
 *
 * 调参指南：
 *   - 改完数字 → pnpm typecheck → pnpm --filter warlords-1931-web run dev 看效果
 *   - 每个常量都有注释说明"调大/调小的后果"
 *   - 不在此文件的参数均属视觉/动画常数，不应在此调
 */

// ═══════════════════════════════════════════════════════════
//  一、经济系统
// ═══════════════════════════════════════════════════════════

// ── 收入公式 ──

/** 每级城市规模贡献税饷（万银/回合）。调大 → 大城市更富 */
export const TAX_PER_CITY_LEVEL = 2

/** 每点工业贡献税饷（万银/回合）。调大 → 工业城经济碾压 */
export const TAX_PER_INDUSTRY = 0.3

/** 每点粮食产能贡献粮秣（万石/回合）。调大 → 农业省粮食充足 */
export const FOOD_PER_FOOD_POINT = 0.4

// ── 养兵消耗 ──

/** 每千兵每回合银饷（万银/k/回合）。调大 → 养兵更贵，小势力更难维持 */
export const UPKEEP_SILVER_PER_K = 0.5

/** 每千兵每回合粮秣（万石/k/回合）。调大 → 大兵团需更多产粮省支撑 */
export const UPKEEP_FOOD_PER_K = 0.3

// ── 内政动作成本（一次性）──

/** 征兵：每千兵银两（万银/k）。调大 → 暴兵更贵 */
export const RECRUIT_SILVER_PER_K = 2

/** 征兵：每千兵粮秣（万石/k）。调大 → 征兵需更多存粮 */
export const RECRUIT_FOOD_PER_K = 1

/** 建设（develop）：每点工业/粮食的银两（万银/点） */
export const DEVELOP_SILVER_PER_POINT = 1.5

/** 筑防（fortify）：每点工事的银两（万银/点） */
export const FORTIFY_SILVER_PER_POINT = 1

/** 整军（rally）：固定银两（万银/次）。调大 → 提振士气更贵 */
export const RALLY_SILVER_FLAT = 0.5

// ── 行军成本（远征消耗）──

/** 行军每公里每千兵耗银（万银/km/k）。调大 → 远征更贵，鼓励邻接作战 */
export const MARCH_SILVER_PER_KM_PER_K = 0.02

/** 行军每公里每千兵耗粮（万石/km/k）。调大 → 远征需更多粮食储备 */
export const MARCH_FOOD_PER_KM_PER_K = 0.015

// ── 远征战力衰减 ──

/** 远征战力衰减参考距离（km）。调大 → 远征惩罚更宽容 */
export const EXPEDITION_DECAY_REF_KM = 2000

/** 远征战力衰减下限。调大 → 远征军即使极远也保留更多战力 */
export const EXPEDITION_DECAY_FLOOR = 0.4

// ── 经济惩罚 ──

/** 欠饷时全军士气惩罚（每回合）。调大（更负）→ 破产惩罚更严厉 */
export const ARREAR_MORALE_PENALTY = -5

/** 缺粮时兵力损耗比例（每回合）。调大 → 断粮死更快 */
export const FAMINE_TROOP_LOSS_RATE = 0.02

/** 占领城市后，新占领城市的士气奖励。调大 → 占领后稳定控制更快 */
export const CAPTURE_MORALE_BONUS = 12

// ── 初始资金 ──

/** 初始银库 = 养兵银 × 此倍数。调大 → 开局更富，AI 侵略性更强 */
export const INIT_TREASURY_UPKEEP_MULTIPLIER = 8

/** 初始银库下限（万银）。防止无兵势力开局为零 */
export const INIT_TREASURY_FLOOR = 100

/** 初始粮仓 = 养兵粮 × 此倍数 */
export const INIT_GRANARY_UPKEEP_MULTIPLIER = 8

/** 初始粮仓下限（万石） */
export const INIT_GRANARY_FLOOR = 50


// ═══════════════════════════════════════════════════════════
//  二、战斗系统
// ═══════════════════════════════════════════════════════════

/** 战斗基础规则（原 BATTLE_RULES） */
export const BATTLE = {
  /** 每回合基准损耗率。调大 → 战斗更血腥、节奏更快 */
  baseRate: 0.08,

  /** 士气参考线（乘数 = 1.0）。士气高于此值 → 损耗低于基准 */
  moraleRef: 70,

  /** 士气乘数下限（士气满时）。调小 → 高士气优势更大 */
  moraleFactorFloor: 0.7,

  /** 士气乘数上限（士气归零时）。调大 → 溃兵死更快 */
  moraleFactorCeil: 1.6,

  /** 每损失 10% 兵力 → 士气惩罚 */
  moraleDamagePer10pct: 3,

  /** 工事满（100）时攻方损耗乘数上限。调大 → 坚城更难啃 */
  fortMaxFactor: 2.0,

  /** 守方地形对攻方的损耗加成 */
  terrainFactor: {
    mountain: 1.5,
    hill: 1.2,
    plain: 1.0,
  } as Record<string, number>,

  /** 兵力比钳制范围 [下限, 上限]。扩宽 → 极端兵力差更悬殊 */
  ratioClamp: [0.5, 3.0] as readonly [number, number],

  /** 士气崩溃判定 */
  collapse: {
    enabled: true,
    /** 士气 ≤ 此值才可能触发崩溃 */
    threshold: 20,
    /** 阈值线上的基础崩溃概率。调大 → 溃败更频繁 */
    baseRate: 0.4,
  },

  /** AI 调味（战地记者）钳制 */
  flavor: {
    /** 突发减员 ≤ 该方基础减员的百分比。调大 → AI 调味更夸张 */
    shockCap: 0.5,
    /** 单条士气扰动 |delta| 上限。调大 → AI 士气事件更极端 */
    moraleCap: 20,
  },
}

/** 战斗趋势判断阈值。攻损/守损比超过此值判定占优。调大 → 趋势判定更迟钝 */
export const BATTLE_TREND_THRESHOLD = 1.2


// ═══════════════════════════════════════════════════════════
//  三、AI 上下文窗口
// ═══════════════════════════════════════════════════════════

/** 势力 AI 单次决策看到的历史事件条数。调大 → AI 更有远见，但 prompt 更长、成本更高 */
export const FACTION_AI_HISTORY_MAX = 20

/** 势力 AI 看到的与玩家电报往来条数 */
export const FACTION_AI_TELEGRAM_WINDOW = 6

/** 世界 AI（批量小势力）看到的历史事件条数 */
export const MINOR_AI_HISTORY_MAX = 20

/** P4 世界结算总结的事件条数上限 */
export const SETTLE_CONTEXT_MAX_EVENTS = 50

/** P4 世界公屏电报条数 */
export const SETTLE_WORLD_TELEGRAM_WINDOW = 8


// ═══════════════════════════════════════════════════════════
//  四、历史叙事截断
// ═══════════════════════════════════════════════════════════

/** P4 结算叙事截断（字符数）。调大 → 上下文更完整，但 token 消耗更高 */
export const SETTLE_NARRATIVE_SNIPPET = 80

/** 玩家输入截断（字符数） */
export const PLAYER_INPUT_SNIPPET = 40

/** AI 回复截断（字符数） */
export const AI_REPLY_SNIPPET = 60


// ═══════════════════════════════════════════════════════════
//  五、世界规则
// ═══════════════════════════════════════════════════════════

/** 士气范围 */
export const MORALE_MIN = 0
export const MORALE_MAX = 100

/** 城市初始 / 默认士气（种子数据未提供时回退） */
export const DEFAULT_MORALE = 70


// ═══════════════════════════════════════════════════════════
//  六、城市属性上限 & 战斗杂项
// ═══════════════════════════════════════════════════════════

/** 工业上限 */
export const CITY_CAP_INDUSTRY = 100
/** 粮食上限 */
export const CITY_CAP_FOOD = 100
/** 工事上限 */
export const CITY_CAP_FORT = 100
/** 城市规模上限 */
export const CITY_CAP_LEVEL = 99

/** 每回合战斗最低损耗（k）。确保不出现零伤亡回合 */
export const BATTLE_MIN_ATTRITION_PER_ROUND = 1

/** 和谈中赔款金额硬上限（万银） */
export const PEACE_INDEMNITY_CAP = 500

/** 事件历史构建默认值（软上限，buildEventHistory 使用） */
export const EVENT_HISTORY_MAX_EVENTS = 30
export const EVENT_HISTORY_MAX_TURNS = 2
export const EVENT_HISTORY_MAX_CHARS = 1200


// ═══════════════════════════════════════════════════════════
//  七、基础设施
// ═══════════════════════════════════════════════════════════

/** LLM 调用重试退避基础间隔（ms）。重试退避 = 此值 × 尝试次数 */
export const LLM_RETRY_BASE_MS = 1000

/** LLM 调用最大重试次数 */
export const LLM_MAX_RETRIES = 3

/** 每回合 AI 可发送给玩家的最大电报数 */
export const AI_TELEGRAMS_PER_TURN = 2
