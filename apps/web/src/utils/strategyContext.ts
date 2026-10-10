import { useGameStore } from '@/stores/game'
import type { Owner } from '@/data/owners'
import { economyOutlook, runwayLabel, ECONOMY_RESERVE_TURNS } from './economyOutlook'
import { FAMINE_TROOP_LOSS_RATE, FAMINE_MIN_TROOP_LOSS_K } from '@/data/gameConfig'
export function buildStrategyContext(faction: Owner): string {
  const store = useGameStore()
  const outlook = economyOutlook(
    store.cities,
    faction,
    store.turnCount,
    store.getTreasury(faction),
    store.getGranary(faction),
    store.battles.filter((b) => b.active && b.attacker === faction).length,
  )
  return [
    `本回合阶段建议：${outlook.goal}。${outlook.reason}。这是建议，不替代指挥权和执行检查。`,
    `静态经济预测：税${outlook.eco.silverTax}/养兵银${outlook.eco.silverUpkeep}，净银${outlook.eco.silverNet}万/回合；产粮${outlook.eco.foodProduce}/养兵粮${outlook.eco.foodUpkeep}，净粮${outlook.eco.foodNet}万石/回合。`,
    `维持当前领土、兵力和产出时：银储备${runwayLabel(outlook.silverRunway)}，粮储备${runwayLabel(outlook.foodRunway)}。不包含战斗、失地、整合完成、外交和未来指令，不能当作保证。`,
    `建议至少保留${ECONOMY_RESERVE_TURNS}回合净消耗储备（银${outlook.reserveSilver.toFixed(1)}/粮${outlook.reserveFood.toFixed(1)}）。按当前净收入及购买后新增养兵成本，本批次新增征兵建议总量不超过${outlook.recruitLimit}k；多条征兵须累计，不是每条都可用这个量。`,
    `新回合缺粮会影响驻军与外出部队：每个非空兵力池损耗${Math.round(FAMINE_TROOP_LOSS_RATE * 100)}%，最少${FAMINE_MIN_TROOP_LOSS_K}k，并按0.1k粒度收敛；外出不能规避缺粮。`,
    '按顺序核算整批银粮与剩余行动点；无值得执行的行动时允许等待。每条指令都可能改变后续预算，执行层会重新校验。若建议与明确战术目标冲突，可解释取舍，但不要把付得起当作养得起。',
    '历史中的执行层回执优先于AI叙事：未执行的指令不能当作成功。依据失败原因与最新余额调整后续计划，不要原样重复失败操作；等待是合法选择。',
  ].join('\n')
}
