<template>
  <div class="map-shell">
    <div ref="mapContainer" class="map-container" @click.self="closeContextMenu">
    <div class="layer-switcher map-ui">
      <GameButton
        v-for="(layer, index) in LAYERS"
        :key="layer.file"
        :active="currentLayerIndex === index"
        @click="switchLayer(index)"
      >
        <component :is="ICONS['stack-2']" :size="16" />
        {{ layer.label }}
      </GameButton>
      <div class="switcher-divider"></div>
      <GameButton :active="ownerColorEnabled" @click="toggleOwnerColor">
        <component :is="ICONS['flag']" :size="16" />
        政权着色
      </GameButton>
      <GameButton :active="labelsVisible" @click="toggleLabels">
        <component :is="ICONS['tag']" :size="16" />
        显示地名
      </GameButton>
      <GameButton tooltip="领土文字水印" :active="sealWatermarkEnabled" @click="toggleSealWatermark">
        <component :is="ICONS['texture']" :size="16" />
        水印
      </GameButton>
      <GameButton :active="baseMapVisible" @click="toggleBaseMap">
        <component :is="ICONS['world']" :size="16" />
        世界背景
      </GameButton>
      <GameButton tooltip="领土 · 城市 · 战斗一览" :active="overviewVisible" @click="overviewVisible = !overviewVisible">
        <component :is="ICONS['map']" :size="16" />
        总览
      </GameButton>
      <GameButton tooltip="调出指挥面板" :active="commandVisible" @click="commandVisible = !commandVisible">
        <component :is="ICONS['brain']" :size="16" />
        指挥
      </GameButton>
      <GameButton tooltip="咨询战略顾问" :active="advisorVisible" @click="advisorVisible = !advisorVisible">
        <component :is="ICONS['user']" :size="16" />
        顾问
      </GameButton>
      <GameButton tooltip="外交（电报·遣使）" :active="diplomacyVisible" @click="diplomacyVisible = !diplomacyVisible">
        <component :is="ICONS['affiliate']" :size="16" />
        外交
        <span v-if="unreadCount > 0 || hasDiplomatPending" class="tg-nav-badge">{{ unreadCount > 9 ? '9+' : unreadCount || '!' }}</span>
      </GameButton>
      <GameButton tooltip="查看世界事件日志" :active="eventLogPanelVisible" @click="eventLogPanelVisible = !eventLogPanelVisible">
        <component :is="ICONS['clipboard-text']" :size="16" />
        事件日志
      </GameButton>
      <GameButton tooltip="战纪 · 扩张轨迹 / 势力沉浮 / 功业" :active="chronicleVisible" @click="chronicleVisible = !chronicleVisible">
        <component :is="ICONS['timeline']" :size="16" />
        战纪
      </GameButton>
      <GameButton tooltip="查看各政权总览" :active="factionDebugVisible" @click="factionDebugVisible = !factionDebugVisible">
        <component :is="ICONS['building-castle']" :size="16" />
        政权总览
      </GameButton>
      <GameButton tooltip="保存当前进度" @click="saveModalVisible = true">
        <component :is="ICONS['device-floppy']" :size="16" />
        保存
      </GameButton>
      <GameButton tooltip="载入已有存档" @click="loadModalVisible = true">
        <component :is="ICONS['folder-open']" :size="16" />
        读取
      </GameButton>
      <div class="switcher-divider"></div>
      <GameButton @click="testPanelVisible = !testPanelVisible">
        <component :is="ICONS['bug']" :size="16" />
        调试
      </GameButton>
      <GameButton @click="fullRerender">
        <component :is="ICONS['refresh']" :size="16" />
        刷新
      </GameButton>
    </div>
    <GameDateDisplay class="map-ui" />
    <GameContextMenu
      class="map-ui"
      :visible="contextMenuVisible"
      :position="contextMenuPos"
      :items="contextMenuItems"
      @select="onMenuAction"
    />
    <GameModal class="map-ui"
      :visible="infoModalVisible"
      :title="infoTitle"
      width="340px"
      :z-index="5000"
      variant="parchment"
      @close="closeInfoModal"
    >
      <template #title>
        <span class="modal-title">{{ infoTitle }}</span>
        <button class="title-copy-btn" @click="copyInfoTitle" title="复制名称">
          <component :is="ICONS['copy']" :size="14" />
        </button>
      </template>
      <InfoTable v-if="infoCityData" :rows="infoRows" />
      <InfoTable v-else-if="infoCountryData" :rows="countryInfoRows" />
    </GameModal>
    <GameModal class="map-ui"
      :visible="testPanelVisible"
      title="调试"
      :draggable="true"
      :overlay="false"
      :z-index="4000"
      variant="parchment"
      :init-x="160"
      :init-y="160"
      @close="testPanelVisible = false"
    >
      <div class="test-panel">
        <GameButton
          @click="
            () =>
              executeOrder({ order: 'arrowFly', from: '156500000', to: '156450200', text: '出兵！' })
          "
          ><component :is="ICONS['sword']" :size="16" />派兵测试</GameButton
        >
        <GameButton
          @click="() => executeOrder({ order: 'radarPulse', from: '156500000', text: '侦察！' })"
          ><component :is="ICONS['eye']" :size="16" />探察测试</GameButton
        >
        <GameButton
          @click="
            () =>
              executeOrder({
                order: 'orbBurst',
                from: '156500000',
                to: '156450200',
                text: '宣战！',
              })
          "
          ><component :is="ICONS['flag']" :size="16" />宣战测试</GameButton
        >
        <GameButton
          @click="() => executeOrder({ order: 'battle', from: '156500000', to: '156450200' })"
          ><component :is="ICONS['crosshair']" :size="16" />战斗测试1</GameButton
        >
        <GameButton
          @click="() => executeOrder({ order: 'battle', from: '156500000', to: '156451000' })"
          ><component :is="ICONS['crosshair']" :size="16" />战斗测试2</GameButton
        >
        <GameButton @click="openBattleList"
          ><component :is="ICONS['list']" :size="16" />查看战斗</GameButton
        >
        <GameButton v-if="isDev" @click="aiPanelVisible = true"
          ><component :is="ICONS.brain" :size="16" />世界AI调试</GameButton
        >
        <GameButton @click="playCloudTest"
          ><component :is="ICONS.cloud" :size="16" />云雾切换测试</GameButton
        >
        <GameButton @click="captureTest"
          ><component :is="ICONS['tag']" :size="16" />占领测试</GameButton
        >
        <GameButton @click="recruitTest"
          ><component :is="ICONS['sword']" :size="16" />广元增兵</GameButton
        >
        <label class="seal-alpha-row">
          <span>水印浓度</span>
          <input
            v-model.number="sealWatermarkAlpha"
            type="range"
            min="0.02"
            max="0.6"
            step="0.01"
            @change="redrawSealWatermark"
          />
          <span class="seal-alpha-val">{{ sealWatermarkAlpha.toFixed(2) }}</span>
        </label>
      </div>
    </GameModal>
    <FactionDebugPanel
      :visible="factionDebugVisible"
      @close="factionDebugVisible = false"
    />
    <GameModal v-if="isDev" class="map-ui"
      :visible="aiPanelVisible"
      title="世界AI调试"
      :z-index="4100"
      variant="parchment"
      width="600px"
      :overlay="false"
      :draggable="true"
      @close="aiPanelVisible = false"
    >
      <AiDebugPanel />
    </GameModal>
    <GameModal class="map-ui"
      :visible="eventLogPanelVisible"
      title="事件日志"
      :draggable="true"
      :overlay="false"
      :z-index="4100"
      width="540px"
      variant="parchment"
      @close="eventLogPanelVisible = false"
    >
      <EventLogPanel />
    </GameModal>
    <!-- 保存模态 -->
    <SaveSelectorModal
      :visible="saveModalVisible"
      mode="save"
      :closable="true"
      @close="saveModalVisible = false"
    />
    <!-- 读取模态 -->
    <SaveSelectorModal
      :visible="loadModalVisible"
      mode="load"
      :closable="true"
      @load="onLoadGame"
      @close="loadModalVisible = false"
    />
    <GameModal class="map-ui"
      :visible="battleListVisible"
      title="战斗管理"
      :z-index="3500"
      variant="parchment"
      :draggable="true"
      :overlay="false"
      @close="battleListVisible = false"
    >
      <div class="battle-list-body">
      <div v-if="battleList.length === 0" class="empty-hint">当前没有进行中的战斗</div>
      <!-- 按守方城市分组展示 -->
      <div v-for="g in groupedBattles" :key="g.key" class="battle-group" :class="{ 'battle-stale': !g.battles.some(b => b.active) }">
        <!-- 分组标题：守方城市名 -->
        <div class="group-header">
          <span class="group-city">{{ g.toName }}</span>
          <span class="group-defender">守方：{{ ownerLabel(g.defender) }}</span>
          <span class="group-turns">第 {{ maxTurns(g) }} 回合</span>
        </div>
        <!-- 各攻方路线 -->
        <div v-for="b in g.battles" :key="b.id" class="battle-item" :class="{ 'battle-stale': !b.active }">
          <div class="battle-main">
            <!-- 标题行：出发城 → 目标城 · 回合数 -->
            <div class="battle-title">
              <span v-if="b.active" class="battle-live" title="交战中"></span>
              <span class="battle-route">
                <span class="battle-city atk">{{ b.fromName }}</span>
                <span class="battle-arrow">→</span>
                <span class="battle-city def">{{ b.toName }}</span>
              </span>
              <span class="battle-turns">第 {{ b.turns }} 回合</span>
              <span v-if="!b.active" class="inactive">(已停止)</span>
            </div>
            <!-- 对阵行：攻方野战兵力 vs 守方驻军 -->
            <div class="battle-vs">
              <div class="battle-side side-atk">
                <span class="side-tag">攻</span>
                <span class="side-faction">{{ ownerLabel(b.attacker) }}</span>
                <span class="side-troops" :class="{ warn: atkForce(b) <= 0 }">
                  {{ atkForce(b) }}k
                  <span class="side-sub">外出</span>
                </span>
              </div>
              <span class="vs-mark">对</span>
              <div class="battle-side side-def">
                <span class="side-tag tag-def">守</span>
                <span class="side-faction">{{ ownerLabel(b.defender) }}</span>
                <span class="side-troops" :class="{ warn: defForce(b) <= 0 }">
                  {{ defForce(b) }}k
                  <span class="side-sub">驻军</span>
                </span>
              </div>
            </div>
            <!-- 兵力条：攻守双方当前兵力对比 -->
            <div class="force-bar">
              <div class="force-seg seg-atk" :style="{ width: forceShare(b) + '%' }"></div>
              <div class="force-seg seg-def" :style="{ width: 100 - forceShare(b) + '%' }"></div>
            </div>
            <!-- 统计行：累计损耗 + 上回合战况 + 走势 -->
            <div class="battle-stats">
              <span class="stat">累计 攻损 <b class="loss-atk">{{ b.totalAttackerLoss }}k</b></span>
              <span class="stat">守损 <b class="loss-def">{{ b.totalDefenderLoss }}k</b></span>
              <span v-if="b.turns > 0" class="stat last-turn">上回合 攻-{{ b.lastAttackerLoss }}k / 守-{{ b.lastDefenderLoss }}k</span>
              <span class="trend" :class="trend(b).cls">{{ trend(b).label }}</span>
            </div>
          </div>
          <GameButton v-if="canRetreat(b)" danger size="small" class="battle-end-btn" :disabled="retreatingId === b.id" @click="requestRetreat(b)">
            <component :is="ICONS['x']" :size="14" />
            {{ retreatingId === b.id ? '对方思考中…' : '撤退' }}
          </GameButton>
        </div>
      </div>
      </div>
    </GameModal>
    <GameModal class="map-ui"
      :visible="disclaimerVisible"
      title="免责声明"
      variant="parchment"
      @close="disclaimerVisible = false"
    >
      <div class="disclaimer-content">
        <p>
          本游戏地图数据来源于网络公开数据源，仅用于游戏娱乐目的，可能存在边界线、地名标注等方面的偏差或不准确之处。
        </p>
        <p>其中国家边界线划分来自于ECharts网站中的数据，中国地图市划分来自于天地图数据</p>
        <p>
          游戏中的政权划分、势力范围、外交关系等均为虚构游戏设定，不代表任何个人或组织的政治立场，亦不代表对现实世界领土归属的任何主张。地图边界不对应、不代表当下世界各国法定领土国界。
        </p>
        <p>本人始终坚持遵循以中华人民共和国自然资源部（原国家测绘地理信息局）发布的标准地图。</p>
        <p class="disclaimer-sources">数据来源：</p>
        <ul>
          <li>
            Natural Earth —
            <a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener"
              >https://www.naturalearthdata.com/</a
            >
          </li>
          <li>
            Apache ECharts —
            <a href="https://echarts.apache.org/" target="_blank" rel="noopener"
              >https://echarts.apache.org/</a
            >
          </li>
          <li>
            天地图 —
            <a href="https://cloudcenter.tianditu.gov.cn/" target="_blank" rel="noopener"
              >https://cloudcenter.tianditu.gov.cn/</a
            >
          </li>
        </ul>
      </div>
    </GameModal>
    <GameModal
      :visible="retreatVerdictVisible"
      title="撤退裁决"
      variant="parchment"
      width="360px"
      @close="onRetreatVerdictConfirm"
    >
      <div class="retreat-verdict">
        <p class="verdict-text">{{ retreatVerdictText }}</p>
        <div v-if="retreatVerdictOrder" class="verdict-loss">
          追击损失：{{ retreatVerdictOrder.retreatLoss }}k
        </div>
        <button class="verdict-btn" @click="onRetreatVerdictConfirm">知晓</button>
      </div>
    </GameModal>
    <!-- 求和谈判弹窗 -->
    <GameModal
      :visible="peaceVisible"
      title="议和"
      variant="parchment"
      width="400px"
      :z-index="5100"
      @close="onPeaceReject"
    >
      <div v-if="peaceState" class="peace-dlg">
        <div class="peace-round">与 {{ peaceFoeLabel }} 谈判 · 第 {{ peaceState.round }} / {{ PEACE_MAX_ROUNDS }} 轮</div>
        <!-- AI 思考中 -->
        <div v-if="peaceState.busy" class="peace-thinking">
          <span class="peace-dot"></span><span class="peace-dot"></span><span class="peace-dot"></span>
          <span class="peace-thinking-text">对方权衡中…</span>
        </div>
        <template v-else-if="peaceState.outcome">
          <p class="peace-text">「{{ peaceState.outcome.narrative }}」</p>
          <div class="peace-indemnity" :class="peaceState.outcome.indemnity > 0 ? 'peace-pay' : 'peace-gain'">
            {{ peaceIndemnityText }}
          </div>
          <div v-if="peaceState.outcome.final" class="peace-final-hint">此为对方最终报价</div>
          <!-- 还价输入（可还价时显示） -->
          <div v-if="canCounter" class="peace-counter">
            <input
              v-model="counterInput"
              class="peace-input"
              type="number"
              placeholder="你愿赔多少（万银，可填负数）"
            />
            <GameButton parchment size="small" @click="onPeaceCounter">还价</GameButton>
          </div>
          <div class="peace-actions">
            <GameButton parchment active size="small" @click="onPeaceAccept">接受条件</GameButton>
            <GameButton parchment danger size="small" @click="onPeaceReject">
              {{ canCounter ? '拒绝（战）' : '谈判破裂（战）' }}
            </GameButton>
          </div>
        </template>
      </div>
    </GameModal>
    <!-- 回合摘要弹窗 -->
    <TurnSummaryModal
      :visible="turnSummaryVisible && !!turnEvents.length"
      :events="turnEvents"
      @close="turnSummaryVisible = false"
    />
    <LegendPanel v-if="ownerColorEnabled" class="map-ui" :items="legendItems" />
    <!-- 战况浮层：按守方城市分组，每城一张可折叠卡片，锚定守方城、跟随相机 -->
    <div class="battle-overlay map-ui">
      <div
        v-for="g in groupedBattles"
        v-show="battleCardPos[g.key]"
        :key="g.key"
        class="battle-card"
        :class="{ collapsed: !battleCardExpanded[g.key] }"
        :style="battleCardPos[g.key] ? { transform: battleCardPos[g.key] } : undefined"
      >
        <!-- 折叠态：精简标题条 -->
        <div class="bc-head" @click="toggleBattleCard(g.key)">
          <span class="bc-live" title="交战中"></span>
          <span class="bc-route">{{ g.toName }}（守）</span>
          <span class="bc-turns">{{ maxTurns(g) }} 回合</span>
          <component :is="ICONS[battleCardExpanded[g.key] ? 'chevron-up' : 'chevron-down']" :size="13" class="bc-toggle" />
        </div>
        <!-- 展开态：各攻方路线 / 战报 / 操作 -->
        <div v-show="battleCardExpanded[g.key]" class="bc-body">
          <!-- 各攻方路线 -->
          <div v-for="b in g.battles" :key="b.id" class="bc-route-row">
            <span class="bc-route-name">{{ b.fromName }} ⇢ {{ b.toName }}</span>
            <span class="bc-route-vs">
              <span class="bc-side bc-atk">{{ ownerLabel(b.attacker) }} {{ atkForce(b) }}k</span>
              <span class="bc-vs-mark">对</span>
              <span class="bc-side bc-def">{{ defForce(b) }}k</span>
            </span>
          </div>
          <!-- 守方驻军 -->
          <div class="bc-def-total">
            守方 {{ ownerLabel(g.defender) }} 驻军 {{ defForce(g.battles[0]) }}k
          </div>
          <!-- 战报叙事（取最近一场有叙事的） -->
          <div v-if="latestNarrative(g)" class="bc-report">「{{ latestNarrative(g) }}」</div>
          <!-- 操作按钮（聚合到卡片底部） -->
          <div class="bc-actions">
            <button v-if="canPeaceGroup(g)" class="bc-btn" @click.stop="requestPeaceGroup(g)">
              <component :is="ICONS['affiliate']" :size="13" /> 求和
            </button>
            <button v-if="canRetreatGroup(g)" class="bc-btn bc-btn-danger" :disabled="retreatingGroupId === g.key" @click.stop="requestRetreatGroup(g)">
              <component :is="ICONS['x']" :size="13" />
              {{ retreatingGroupId === g.key ? '对方思考中…' : '撤退' }}
            </button>
          </div>
        </div>
        <!-- 指向守方城的锚点尖角 -->
        <span class="bc-anchor"></span>
      </div>
    </div>
    </div>
    <PlayerAiPanel :visible="commandVisible" @close="commandVisible = false" />
    <AdvisorPanel :visible="advisorVisible" @close="advisorVisible = false" />
    <DiplomacyPanel :visible="diplomacyVisible" @close="diplomacyVisible = false" />
    <PlayerStatusPanel :visible="overviewVisible" @close="overviewVisible = false" />
    <ChroniclePanel :visible="chronicleVisible" @close="chronicleVisible = false" />
    <div class="disclaimer-bar map-ui" @click="disclaimerVisible = true">
      ⚠
      免责声明：本地图数据来源于网络公开数据源，仅供娱乐参考。游戏中的政权划分、边界线等均为虚构设定，不代表任何个人或组织的政治立场，亦不代表对现实世界领土归属的任何主张，不对应、不代表当下世界各国法定领土国界。本人始终坚持遵循以中华人民共和国自然资源部（原国家测绘地理信息局）发布的标准地图。
      点击查看详情
    </div>
    <PaperTexture />
    <MapCompass />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import {
  Application,
  Container,
  Graphics,
  Matrix,
  Rectangle,
  Text,
  TextStyle,
} from 'pixi.js'
import type { Texture } from 'pixi.js'
import {
  OWNER_COLORS,
  OWNER_LABELS,
  OWNER_DETAILS,
  Owner,
} from '@/data/owners'
import type { CityData } from '@/data/chinaCities'
import type { CountryData } from '@/data/worldCountries'
import { worldCountries, GEO_TO_GAME_ISO } from '@/data/worldCountries'
import { getDisplayName } from '@/data/displayNames'
import { init as initGameOrders, executeOrder, restoreActiveAnimations, resetBattleRuntime } from '@/utils/gameOrders'
import type { GameOrder, CameraTarget } from '@/utils/gameOrders'
import { useGameStore } from '@/stores/game'
import type { BattleInfo, GameEvent } from '@/stores/game'
import { battleTrend, battleForceShare } from '@/utils/battleTrend'
import {
  geoToScreen,
  calculateCentroid,
  setScreenSize,
  registerLocations,
  registerAlias,
  resolveLocationXY,
} from '@/utils/locationResolver'
import type { Point } from '@/utils/locationResolver'
import GameButton from '@/components/ui/GameButton.vue'
import GameContextMenu from '@/components/ui/GameContextMenu.vue'
import GameModal from '@/components/ui/GameModal.vue'
import PlayerAiPanel from '@/components/PlayerAiPanel.vue'
import AdvisorPanel from '@/components/AdvisorPanel.vue'
import DiplomacyPanel from '@/components/DiplomacyPanel.vue'
import TurnSummaryModal from '@/components/TurnSummaryModal.vue'
import PlayerStatusPanel from '@/components/PlayerStatusPanel.vue'
import ChroniclePanel from '@/components/ChroniclePanel.vue'
import FactionDebugPanel from '@/components/FactionDebugPanel.vue'
import InfoTable from '@/components/ui/InfoTable.vue'
import LegendPanel from '@/components/ui/LegendPanel.vue'
import PaperTexture from '@/components/ui/PaperTexture.vue'
import MapCompass from '@/components/ui/MapCompass.vue'
import type { Component } from 'vue'
import IconStack2 from '~icons/tabler/stack-2'
import IconFlag from '~icons/tabler/flag'
import IconTag from '~icons/tabler/tag'
import IconWorld from '~icons/tabler/world'
import IconMap from '~icons/tabler/map'
import IconBug from '~icons/tabler/bug'
import IconSword from '~icons/tabler/sword'
import IconEye from '~icons/tabler/eye'
import IconCrosshair from '~icons/tabler/crosshair'
import IconList from '~icons/tabler/list'
import IconCircleX from '~icons/tabler/circle-x'
import IconX from '~icons/tabler/x'
import IconBrain from '~icons/tabler/brain'
import IconUser from '~icons/tabler/user'
import IconMail from '~icons/tabler/mail'
import IconCloud from '~icons/tabler/cloud'
import IconClipboardText from '~icons/tabler/clipboard-text'
import IconDeviceFloppy from '~icons/tabler/device-floppy'
import IconFolderOpen from '~icons/tabler/folder-open'
import IconChevronDown from '~icons/tabler/chevron-down'
import IconChevronUp from '~icons/tabler/chevron-up'
import IconRefresh from '~icons/tabler/refresh'
import IconAffiliate from '~icons/tabler/affiliate'
import IconTimeline from '~icons/tabler/timeline'
import IconCopy from '~icons/tabler/copy'
import IconBuildingCastle from '~icons/tabler/building-castle'
import IconTexture from '~icons/tabler/texture'
import AiDebugPanel from '@/components/AiDebugPanel.vue'
import EventLogPanel from '@/components/EventLogPanel.vue'
import SaveSelectorModal from '@/components/SaveSelectorModal.vue'
import GameDateDisplay from '@/components/ui/GameDateDisplay.vue'
import { playCloudTransition, disposeCloudTransition } from '@/utils/cloudTransition'
import { judgeRetreat, negotiatePeace, type PeaceResult } from '@/utils/ai'
import { useSaveGame } from '@/composables/useSaveGame'
import { useToast } from '@/composables/useToast'
import { useDiplomacyBus } from '@/composables/useDiplomacyBus'
import { useAgentKernel } from '@/composables/useAgentKernel'

/** 开发构建标志：AI 调试面板仅在 dev 下挂载，不进生产包。 */
const isDev = import.meta.env.DEV

const { loadGame } = useSaveGame()

const ICONS: Record<string, Component> = {
  'stack-2': IconStack2,
  flag: IconFlag,
  tag: IconTag,
  world: IconWorld,
  map: IconMap,
  bug: IconBug,
  sword: IconSword,
  eye: IconEye,
  crosshair: IconCrosshair,
  list: IconList,
  'circle-x': IconCircleX,
  x: IconX,
  brain: IconBrain,
  user: IconUser,
  mail: IconMail,
  cloud: IconCloud,
  'clipboard-text': IconClipboardText,
  'device-floppy': IconDeviceFloppy,
  'folder-open': IconFolderOpen,
  'chevron-down': IconChevronDown,
  'chevron-up': IconChevronUp,
  refresh: IconRefresh,
  affiliate: IconAffiliate,
  timeline: IconTimeline,
  copy: IconCopy,
  'building-castle': IconBuildingCastle,
  texture: IconTexture,
}

// ─── 类型定义 ───

interface LayerConfig {
  file: string
  label: string
  color: number
  fillColor: number
}

interface LayerStyle {
  color: number
  fillColor: number
  /** 边界线宽（默认 0.5；本国陆地用舆图墨线宽） */
  borderWidth?: number
}

interface HitResult {
  layer: 'china' | 'world'
  feature: GeoJSON.Feature
}

/** PixiJS Text 扩展：自定义属性用于地图标签变换 */
interface LabelText extends Text {
  _geoX: number
  _geoY: number
}

type TerrainKey = keyof typeof TERRAIN_NAMES
type CountryTypeKey = keyof typeof COUNTRY_TYPE_NAMES

// ─── 常量 ───

const GEO_BOUNDS = {
  minLng: 73,
  maxLng: 135,
  minLat: 18,
  maxLat: 54,
} as const

const TERRAIN_NAMES: Record<string, string> = {
  PLAIN: '平原',
  HILL: '丘陵',
  MOUNTAIN: '山地',
  FOREST: '森林',
  CITY: '城市',
}

const LEVEL_NAMES = ['', '县城/小城', '普通城市', '区域中心', '全国重要城市', '超级城市']

// 外交态势不再以国土填色表达（旧深海军蓝色块已废）——
// 世界背景统一为冷灰纸，态势信息归右键「查看信息」与电报渠道。

const COUNTRY_TYPE_NAMES: Record<string, string> = {
  EMPIRE: '帝国',
  REPUBLIC: '共和国',
  UNION: '联盟',
  COLONY: '殖民地',
  KINGDOM: '王国',
  SPLIT: '分裂',
}

const DIPLOMACY_NAMES: Record<string, string> = {
  ALLIED: '同盟',
  FRIENDLY: '友好',
  NEUTRAL: '中立',
  HOSTILE: '敌对',
  WAR: '交战中',
}

/** 格式化人口（存储单位：千人）→ 中文万/亿 */
function formatPopulation(n: number | undefined | null): string {
  if (n == null || n < 0) return '—'
  if (n >= 100000) return `${(n / 100000).toFixed(1)} 亿`
  if (n >= 10000) return `${(n / 10).toFixed(0)} 万`
  return `${n} 千`
}

/**
 * ── 舆图调色板（民国军用地图 · 整屏同纸色）──
 * 画布底色 = 羊皮纸（与 --paper #e2d4b6 同族），海域陆地一张纸；
 * 陆地靠「墨线 + 暖纸罩染」与海区分，世界背景为冷灰纸的异邦国土。
 */
const MAP_PALETTE = {
  /** 画布底色：整屏同纸 */
  canvas: 0xe2d4b6,
  /** 未着色陆地填色（暖纸微亮，罩染 0.5 后比画布略浅一档） */
  landFill: 0xeadfc6,
  /** 陆地边界：墨线（--ink 同源） */
  landBorder: 0x5c4426,
  /** 陆地边界宽度 */
  landBorderWidth: 0.8,
  /** 海域水色罩染（冷灰褐，极淡，区分海陆又不割裂纸面） */
  seaTint: 0x7c8577,
  seaAlpha: 0.1,
  /** 世界背景国土：按外交态势着冷灰纸色，与本国暖纸形成冷暖对照 */
  worldFill: 0xc7bba0,
  worldFillAlpha: 0.42,
  worldBorder: 0x84735a,
  worldBorderWidth: 0.5,
} as const

// ─── 领土文字水印 ───
// 水印不再是盖在某点的一枚方章，而是把势力名做成文字带、铺满整个疆域，
// 像票据/图纸底纹一样透过国土轮廓透出来。实现上直接借 PixiJS 的图案填充：
// fill({ texture, textureSpace: 'global' }) 会让所有城市多边形共享同一张平铺网格，
// 于是同势力各市之间的市界不会打断文字行，整块疆域看起来是连续的印花字。
// uv 绑定在几何顶点上、只在几何变更时重建，因此图案天然随地图缩放平移，
// 不需要每帧同步，也不遮罩、不平铺精灵。

/**
 * 平铺单元边长（地图局部坐标；随地图一起缩放，故 zoom 越大水印越大）。
 * 单元内横贯两条词带，故取 190 给 5 字长的政权名（如「日本关东军」）留足余量。
 */
const SEAL_TILE = 190
/**
 * 纹理超采样倍数。
 * 图案填充按纹理的**物理**像素归一化，超采样会把周期同比放大，
 * 故绘制时用 matrix 反向缩放 1 / SEAL_TEX_RES 抵消，保证周期仍是 SEAL_TILE。
 * 文字水印字形本就粗大，取 2.5 即可兼顾 ZOOM_MAX(8) 下的清晰度与显存
 * （12 张 475² 纹理，约 11MB）。
 */
const SEAL_TEX_RES = 2.5
/** 水印字号（地图局部坐标） */
const SEAL_TEXT_FS = 24
/** 词带纵向位置（占单元高比例）：三条均分行距，织成连续底纹 */
const SEAL_BAND_YS = [0.2, 0.5, 0.8] as const
/** 相邻词带的横向相位增量（占单元宽比例）：逐行错开 1/3 周期，避免竖缝连成线 */
const SEAL_BAND_X_SHIFT = 1 / 3

const LAYERS: LayerConfig[] = [
  {
    file: '/中国_省.geojson',
    label: '省级',
    color: MAP_PALETTE.landBorder,
    fillColor: MAP_PALETTE.landFill,
  },
  {
    file: '/中国_市.geojson',
    label: '市级',
    color: MAP_PALETTE.landBorder,
    fillColor: MAP_PALETTE.landFill,
  },
]

// ─── 响应式状态 ───

const mapContainer = ref<HTMLElement | null>(null)
const currentLayerIndex = ref(1)
const contextMenuVisible = ref(false)
const contextMenuPos = ref<Point>({ x: 0, y: 0 })
const infoModalVisible = ref(false)
/** 当前查看的城市 gb 编码（响应式断链修复：computed 从 store 实时读，不再缓存 stale ref） */
const infoCityGb = ref<string | null>(null)
const infoCityData = computed<CityData | null>(() => {
  if (!infoCityGb.value) return null
  const store = useGameStore()
  return (store.cities as Record<string, CityData>)[infoCityGb.value] ?? null
})
const infoCountryData = ref<CountryData | Record<string, unknown> | null>(null)
const testPanelVisible = ref(false)
const aiPanelVisible = ref(false)
const factionDebugVisible = ref(false)
/** 领土总览弹窗是否打开 */
const overviewVisible = ref(false)
/** 指挥面板弹窗是否打开 */
const commandVisible = ref(false)
/** 战略顾问弹窗是否打开 */
const advisorVisible = ref(false)
const diplomacyVisible = ref(false)
const battleListVisible = ref(false)
const eventLogPanelVisible = ref(false)
/** 战纪（成长轨迹）面板是否打开 */
const chronicleVisible = ref(false)
const saveModalVisible = ref(false)
const loadModalVisible = ref(false)
const battleList = computed(() => useGameStore().battles)

/** 按守方城市分组的战斗列表（同一守方城市的多场攻方合并为一张卡片） */
interface BattleGroup {
  key: string        // `${defender}_${toGb}` 唯一键
  toGb: string       // 守方城市 id
  toName: string     // 守方城市名
  defender: Owner    // 守方势力
  battles: BattleInfo[]
}
const groupedBattles = computed<BattleGroup[]>(() => {
  const map = new Map<string, BattleGroup>()
  for (const b of battleList.value) {
    const k = `${b.defender}_${b.to}`
    let g = map.get(k)
    if (!g) {
      g = { key: k, toGb: b.to, toName: b.toName, defender: b.defender, battles: [] }
      map.set(k, g)
    }
    g.battles.push(b)
  }
  return [...map.values()]
})

const unreadCount = computed(() => useGameStore().unreadCount)
const diplomacyBus = useDiplomacyBus()
const hasDiplomatPending = computed(() => {
  const s = diplomacyBus.currentSession.value
  return s && s.status === 'negotiating'
})
const disclaimerVisible = ref(false)
const ownerColorEnabled = ref(true)
const labelsVisible = ref(true)
const baseMapVisible = ref(true)
/** 领土文字水印开关（仅市级图层有城市几何可铺） */
const sealWatermarkEnabled = ref(true)
/** 水印浓度：调试面板可实时调，调到满意后固化回常量 */
const sealWatermarkAlpha = ref(0.26)

// ─── PixiJS 实例 ───

let app: Application
let worldContainer: Container
let fxContainer: Container
let labelContainer: Container
let selectionHighlightGfx: Graphics
let baseContainer: Container
let baseHighlightGraphics: Graphics

// ─── 数据缓存 ───

let currentData: GeoJSON.FeatureCollection | null = null
let selectedFeature: GeoJSON.Feature | null = null
let selectedWorldFeature: GeoJSON.Feature | null = null
const geoJsonCache = new Map<string, GeoJSON.FeatureCollection>()
let worldData: GeoJSON.FeatureCollection | null = null
const worldDataMap = new Map<string, CountryData>()

/** 各势力的印章平铺纹理（按势力分色，单字印文） */
const sealTextures = new Map<Owner, Texture>()
/** 当前水印图形：纹理重建前必须先销毁它，否则会有一帧采样到已销毁的纹理 */
let sealWatermarkGfx: Graphics | null = null

// ─── 地图状态 ───

let mapScale = 1
let mapX = 0
let mapY = 0
let isDragging = false
let lastPointer: Point = { x: 0, y: 0 }
let pointerDownPos: Point = { x: 0, y: 0 }

// ─── 缩放软边界（橡皮筋，Apple §9）──
const ZOOM_MIN = 0.5
const ZOOM_MAX = 8
/** 越界后渐进阻力：越超越多增量越小，绝不硬冻住，但仍可轻微越界表示"还活着" */
function rubberbandClamp(v: number, min: number, max: number): number {
  if (v >= min && v <= max) return v
  if (v > max) {
    const over = v - max
    return max + over / (1 + over * 2)
  }
  const under = min - v
  return min - under / (1 + under * 2)
}

let zoomRestRaf: number | null = null
/** 停在软边界外时，逐帧轻微回弹归位；被镜头补间或下次滚轮接管即放弃 */
function scheduleZoomRest(): void {
  if (zoomRestRaf !== null) return
  const step = (): void => {
    if (cameraRaf !== null) {
      zoomRestRaf = null
      return
    }
    if (mapScale > ZOOM_MAX) mapScale = ZOOM_MAX + (mapScale - ZOOM_MAX) * 0.25
    else if (mapScale < ZOOM_MIN) mapScale = ZOOM_MIN - (ZOOM_MIN - mapScale) * 0.25
    applyCamera()
    if (Math.abs(mapScale - ZOOM_MAX) < 0.004 || Math.abs(mapScale - ZOOM_MIN) < 0.004) {
      mapScale = mapScale > ZOOM_MAX ? ZOOM_MAX : ZOOM_MIN
      applyCamera()
      zoomRestRaf = null
    } else {
      zoomRestRaf = requestAnimationFrame(step)
    }
  }
  zoomRestRaf = requestAnimationFrame(step)
}

/** 无障碍：用户偏好减少动态时，程序化镜头直接归位、不做补间（Apple §14） */
function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

// ─── 计算属性 ───

const legendItems = computed(() =>
  Object.entries(OWNER_LABELS).map(([key, label]) => ({
    label,
    color: '#' + (OWNER_COLORS as Record<string, number>)[key].toString(16).padStart(6, '0'),
  })),
)

const contextMenuItems = ref([
  { action: 'info', label: '查看信息', icon: 'info-circle' },
  { action: 'investigate', label: '调查', icon: 'search' },
  { action: 'declare-war', label: '宣战', icon: 'flag' },
  { action: 'surprise-attack', label: '奇袭', danger: true, icon: 'bolt' },
])

const infoRows = computed(() => {
  if (!infoCityData.value) return []
  const d = infoCityData.value
  return [
    { label: '政权', value: ((OWNER_LABELS as Record<string, string>)[d.owner!] || d.owner || '—') as string },
    { label: '地形', value: (TERRAIN_NAMES[d.terrain!] || d.terrain || '—') as string },
    { label: '城市规模', value: `${d.cityLevel ?? '—'}（${LEVEL_NAMES[d.cityLevel!] || '—'}）` },
    { label: '工业能力', value: `${d.industry ?? '—'} / 100` },
    { label: '粮食生产', value: `${d.food ?? '—'} / 100` },
    { label: '工事等级', value: `${d.fort ?? '—'} / 100` },
    { label: '驻军', value: `${d.troops ?? 0} k` },
    // 外出兵力（野战军）：出兵后驻军转入 fieldForce，仅在 >0 时展示，让玩家知道兵去了前线
    ...((d.fieldForce ?? 0) > 0
      ? [{ label: '外出兵力', value: `▲ ${d.fieldForce} k（作战中）` }]
      : []),
    { label: '士气', value: `${d.morale ?? 0} / 100` },
  ]
})

const countryInfoRows = computed(() => {
  if (!infoCountryData.value) return []
  const d = infoCountryData.value
  const dc = d as CountryData
  const rows = [
    { label: '国名', value: `${dc.name || '—'}（${dc.iso_a3 || dc.id || '—'}）` },
    { label: '全称', value: dc.full_name || '—' },
    {
      label: '国家类型',
      value: COUNTRY_TYPE_NAMES[dc.countryType as CountryTypeKey] || dc.countryType || '—',
    },
    { label: '人口', value: formatPopulation(dc.population) },
    { label: '军事实力', value: `${dc.military ?? '—'} / 10` },
    { label: '工业能力', value: `${dc.industry ?? '—'} / 100` },
    { label: '驻军', value: `${dc.troops ?? 0} k` },
  ]
  if ((dc.fieldForce ?? 0) > 0) {
    rows.push({ label: '外出兵力', value: `▲ ${dc.fieldForce} k（作战中）` })
  }
  rows.push(
    { label: '对华威胁', value: `${dc.threat ?? '—'} / 10` },
    {
      label: '外交关系',
      value: DIPLOMACY_NAMES[dc.diplomacy as string] || dc.diplomacy || '—',
    },
  )
  return rows
})

const infoTitle = computed(() => {
  if (infoCityData.value) {
    const gb = infoCityData.value.gb
    return getDisplayName(gb) || infoCityData.value.name
  }
  if (infoCountryData.value) {
    const d = infoCountryData.value as CountryData
    return `${d.name}（${d.iso_a3 || d.id || ''}）`
  }
  return ''
})

// ─── 坐标工具 ───

function screenToGeo(
  screenX: number,
  screenY: number,
  width: number,
  height: number,
): { lng: number; lat: number } {
  const lngRange = GEO_BOUNDS.maxLng - GEO_BOUNDS.minLng
  const latRange = GEO_BOUNDS.maxLat - GEO_BOUNDS.minLat
  const scale = Math.min(width / lngRange, height / latRange)
  const lng = screenX / scale + GEO_BOUNDS.minLng
  const lat = GEO_BOUNDS.maxLat - screenY / scale
  return { lng, lat }
}

function pointInPolygon(lng: number, lat: number, coordinates: GeoJSON.Position[]): boolean {
  let inside = false
  for (let i = 0, j = coordinates.length - 1; i < coordinates.length; j = i++) {
    const [xi, yi] = coordinates[i]
    const [xj, yj] = coordinates[j]
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

// ─── 点击测试 ───

function hitTest(
  screenX: number,
  screenY: number,
  data: GeoJSON.FeatureCollection,
  width: number,
  height: number,
): GeoJSON.Feature | null {
  const worldX = (screenX - mapX) / mapScale
  const worldY = (screenY - mapY) / mapScale
  const geo = screenToGeo(worldX, worldY, width, height)

  for (const feature of data.features) {
    const { geometry } = feature
    let hit = false

    if (geometry.type === 'Polygon') {
      hit = pointInPolygon(geo.lng, geo.lat, geometry.coordinates[0] as GeoJSON.Position[])
    } else if (geometry.type === 'MultiPolygon') {
      for (const polygon of geometry.coordinates) {
        if (pointInPolygon(geo.lng, geo.lat, polygon[0] as GeoJSON.Position[])) {
          hit = true
          break
        }
      }
    }

    if (hit) return feature
  }
  return null
}

// ─── 绘图引擎 ───

/** 一个多边形的若干环：首环为外轮廓，其余为洞（内环） */
type PolygonRings = Point[][]

/**
 * 收集 feature 的所有多边形（已换算为屏幕坐标）。
 *
 * 抽出来是为了让同一份几何能被多次着色而不重复做经纬度换算——
 * 领土水印要在底色之上再画一遍同样的轮廓，换算只做一次即可。
 */
function collectFeatureRings(
  feature: GeoJSON.Feature,
  width: number,
  height: number,
): PolygonRings[] {
  const { geometry } = feature
  const polygons: GeoJSON.Position[][][] =
    geometry.type === 'Polygon'
      ? [geometry.coordinates as GeoJSON.Position[][]]
      : geometry.type === 'MultiPolygon'
        ? (geometry.coordinates as GeoJSON.Position[][][])
        : []

  const out: PolygonRings[] = []
  for (const polygon of polygons) {
    const rings: PolygonRings = []
    for (const ring of polygon) {
      if (ring.length < 3) continue
      rings.push(ring.map(([lng, lat]) => geoToScreen(lng, lat, width, height)))
    }
    if (rings.length > 0) out.push(rings)
  }
  return out
}

/**
 * 把多边形写入 graphics，每写完一个多边形回调一次（调用方在里面 fill / stroke）。
 *
 * 必须逐个 polygon 回调而不是最后统一 fill：fill() 会消费当前累积路径，
 * 且只有在同一个 fill 内，后续环才会被当作洞挖掉；统一 fill 会让内环变成实心块。
 */
function fillPolygons(graphics: Graphics, polygons: PolygonRings[], onPolygon: () => void): void {
  for (const rings of polygons) {
    for (const ring of rings) {
      graphics.moveTo(ring[0].x, ring[0].y)
      for (let i = 1; i < ring.length; i++) {
        graphics.lineTo(ring[i].x, ring[i].y)
      }
      graphics.closePath()
    }
    onPolygon()
  }
}

function drawFeature(
  graphics: Graphics,
  feature: GeoJSON.Feature,
  width: number,
  height: number,
  style: LayerStyle,
  alpha = 0.5,
): void {
  const borderWidth = style.borderWidth ?? 0.5
  fillPolygons(graphics, collectFeatureRings(feature, width, height), () => {
    graphics.fill({ color: style.fillColor, alpha })
    if (borderWidth > 0) {
      graphics.stroke({ width: borderWidth, color: style.color, alpha: 1 })
    }
  })
}

function highlightOn(gfx: Graphics, feature: GeoJSON.Feature, color = 0xb04a3a): void {
  const width = app.screen.width
  const height = app.screen.height
  const { geometry } = feature
  const polygons: GeoJSON.Position[][][] =
    geometry.type === 'Polygon'
      ? [geometry.coordinates as GeoJSON.Position[][]]
      : geometry.type === 'MultiPolygon'
        ? (geometry.coordinates as GeoJSON.Position[][][])
        : []

  for (const polygon of polygons) {
    for (const ring of polygon) {
      if (ring.length < 3) continue
      const first = geoToScreen(ring[0][0], ring[0][1], width, height)
      gfx.moveTo(first.x, first.y)
      for (let i = 1; i < ring.length; i++) {
        const p = geoToScreen(ring[i][0], ring[i][1], width, height)
        gfx.lineTo(p.x, p.y)
      }
      gfx.closePath()
    }
    gfx.fill({ color, alpha: 0.4 })
    gfx.stroke({ width: 0.5, color, alpha: 1 })
  }
}

function highlightFeature(feature: GeoJSON.Feature, color = 0xff4444): void {
  highlightOn(selectionHighlightGfx, feature, color)
}

function highlightBaseFeature(feature: GeoJSON.Feature, color = 0xff4444): void {
  highlightOn(baseHighlightGraphics, feature, color)
}

function hitTestAll(screenX: number, screenY: number): HitResult | null {
  const width = app.screen.width
  const height = app.screen.height

  if (currentData) {
    const chinaHit = hitTest(screenX, screenY, currentData, width, height)
    if (chinaHit) return { layer: 'china', feature: chinaHit }
  }

  if (worldData && baseContainer.visible) {
    const worldHit = hitTest(screenX, screenY, worldData, width, height)
    if (worldHit) return { layer: 'world', feature: worldHit }
  }

  return null
}

function clearAllHighlights(): void {
  selectionHighlightGfx.clear()
  baseHighlightGraphics.clear()
  selectedFeature = null
  selectedWorldFeature = null
}

// ─── 世界背景地图 ───

async function renderBaseMap(): Promise<void> {
  if (!worldData) return
  const width = app.screen.width
  const height = app.screen.height

  baseContainer.removeChildren()

  const gfx = new Graphics()
  for (const feature of worldData.features) {
    drawFeature(
      gfx,
      feature,
      width,
      height,
      {
        color: MAP_PALETTE.worldBorder,
        fillColor: MAP_PALETTE.worldFill,
        borderWidth: MAP_PALETTE.worldBorderWidth,
      },
      MAP_PALETTE.worldFillAlpha,
    )
  }
  baseContainer.addChild(gfx)
  baseContainer.addChild(baseHighlightGraphics)
}

function toggleBaseMap(): void {
  baseMapVisible.value = !baseMapVisible.value
  baseContainer.visible = baseMapVisible.value
}

// ─── 交互 ───

function onContextMenu(e: PointerEvent | MouseEvent): void {
  e.preventDefault()

  if (!mapContainer.value) return
  const rect = mapContainer.value.getBoundingClientRect()
  const screenX = e.clientX - rect.left
  const screenY = e.clientY - rect.top
  const result = hitTestAll(screenX, screenY)

  if (!result) return

  clearAllHighlights()

  if (result.layer === 'china') {
    selectedFeature = result.feature
    highlightFeature(result.feature)
    const gb = result.feature.properties?.gb as string | undefined
    const owner = gb ? useGameStore().ownership[gb] : undefined
    const isFriendly = owner !== undefined && owner === useGameStore().currentFaction
    const items = [
      { action: 'info', label: '查看信息', icon: 'info-circle' },
      { action: 'investigate', label: '调查', icon: 'search' },
      { action: 'declare-war', label: '宣战', icon: 'flag' },
      { action: 'surprise-attack', label: '奇袭', danger: true, icon: 'bolt' },
    ]
    if (!isFriendly) {
      items.push({ action: 'telegram', label: '电报', icon: 'mail' })
    }
    contextMenuItems.value = items
  } else {
    selectedWorldFeature = result.feature
    highlightBaseFeature(result.feature)
    contextMenuItems.value = [
      { action: 'info', label: '查看信息', icon: 'info-circle' },
      { action: 'telegram', label: '电报', icon: 'mail' },
    ]
  }

  contextMenuPos.value = { x: screenX, y: screenY }
  contextMenuVisible.value = true
}

function closeContextMenu(): void {
  contextMenuVisible.value = false
}

function closeInfoModal(): void {
  console.log('[LeafletMap] closeInfoModal called, current value:', infoModalVisible.value)
  infoModalVisible.value = false
  console.log('[LeafletMap] closeInfoModal done, new value:', infoModalVisible.value)
}

/** 复制弹窗标题（城市/国家名称）到剪贴板 */
function copyInfoTitle(): void {
  const text = infoTitle.value
  if (!text) return
  navigator.clipboard.writeText(text).then(() => {
    useToast().push({ icon: 'check', tone: 'green', title: '已复制', text })
  }).catch(() => {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    useToast().push({ icon: 'check', tone: 'green', title: '已复制', text })
  })
}

function onMenuAction(action: string): void {
  if (action === 'telegram') {
    if (selectedFeature) {
      const gb = selectedFeature.properties?.gb as string | undefined
      const owner = gb ? useGameStore().ownership[gb] : undefined
      if (!owner || owner === Owner.NEUTRAL) {
        useGameStore().openTelegramTo('world')
      } else {
        useGameStore().openTelegramTo(owner)
      }
    } else if (selectedWorldFeature) {
      const isoA3 = selectedWorldFeature.properties?.iso_a3 as string | undefined
      const gameIso = isoA3 ? (GEO_TO_GAME_ISO[isoA3] ?? isoA3) : ''
      if (gameIso) useGameStore().openTelegramTo(`country:${gameIso}`)
    }
    diplomacyVisible.value = true
    closeContextMenu()
    return
  }

  if (action === 'info') {
    if (selectedFeature) {
      const gb = selectedFeature.properties?.gb as string | undefined
      infoCityGb.value = gb ?? null
      infoCountryData.value = null
      infoModalVisible.value = true
    } else if (selectedWorldFeature) {
      const isoA3 = selectedWorldFeature.properties?.iso_a3 as string | undefined
      infoCountryData.value = isoA3
        ? worldDataMap.get(isoA3) || selectedWorldFeature.properties
        : selectedWorldFeature.properties
      infoCityGb.value = null
      infoModalVisible.value = true
    }
  } else {
    console.log(
      '菜单操作:',
      action,
      selectedFeature?.properties || selectedWorldFeature?.properties,
    )
  }
  closeContextMenu()
}

function openBattleList(): void {
  battleListVisible.value = true
}

/** 调试：播放云雾蒙太奇（盖住 → 停顿 → 揭开），演出期间锁定相机 */
async function playCloudTest(): Promise<void> {
  cameraController.setLocked(true)
  try {
    await playCloudTransition(app)
  } finally {
    cameraController.setLocked(false)
  }
}

/** 调试：占领测试——把宝鸡（gb=156610300）划给川军（SCC） */
async function captureTest(): Promise<void> {
  await executeOrder({ order: 'capture', gb: '156610300', owner: Owner.SCC })
}

/**
 * 调试：广元增兵——用 AI 实际返回的原始 order 直跑 executeOrder，
 * 绕开调度/校验链，直接看 recruit 在哪一步落地或失败。
 * 原始 order（amount 单位 k，1 = 1k 兵）：{ order:'recruit', gb:'广元市', amount:1 }
 */
async function recruitTest(): Promise<void> {
  const store = useGameStore()
  const before = store.cities['156510800']?.troops
  console.log('[广元增兵] 执行前 广元驻军 =', before, 'k')
  const r = await executeOrder({ order: 'recruit', gb: '广元市', amount: 1 })
  const after = store.cities['156510800']?.troops
  console.log('[广元增兵] executeOrder 返回 =', r, '执行后 广元驻军 =', after, 'k')
  useToast().push({
    icon: r.ok ? 'sword' : 'alert-triangle',
    tone: r.ok ? 'cinnabar' : 'error',
    title: r.ok ? '增兵成功' : '增兵失败',
    text: r.ok
      ? `广元驻军 ${before}k → ${after}k`
      : (r as { reason?: string }).reason || '未知原因（见控制台）',
    duration: 4000,
  })
}

/** 玩家是否为攻方（撤退仅攻方玩家可发起）—— 保留兼容战斗管理弹窗 */
function canRetreat(b: BattleInfo): boolean {
  const me = useGameStore().currentFaction
  return me != null && b.attacker === me
}

/** 玩家是否为参战方（攻方或守方均可求和）—— 保留兼容战斗管理弹窗 */
function canPeace(b: BattleInfo): boolean {
  const me = useGameStore().currentFaction
  return me != null && (b.attacker === me || b.defender === me)
}

/** 分组撤退锁定键（替代原 retreatingId，按分组锁定） */
const retreatingGroupId = ref<string | null>(null)
/** 兼容：战斗管理弹窗仍用单 battle 撤退 */
const retreatingId = ref<string | null>(null)

// ── 撤退裁决弹窗 ──
const retreatVerdictVisible = ref(false)
const retreatVerdictText = ref('')
/** 撤退裁决结果（支持多 battle 批量停止） */
const retreatVerdictOrder = ref<{ ids: string[]; retreatLoss: number; narrative: string } | null>(null)

// ── 回合摘要弹窗 ──
const { turnSummary } = useAgentKernel()
const turnSummaryVisible = ref(false)
const turnEvents = ref<GameEvent[]>([])

// 监听回合摘要：AI 跑完后自动弹出
watch(
  () => turnSummary.value,
  (events) => {
    if (events && events.length > 0) {
      turnEvents.value = events
      turnSummaryVisible.value = true
    } else {
      turnSummaryVisible.value = false
    }
  },
)

/** 撤退请求：AI 裁定追击 → 弹窗展示叙事 → 玩家确认后 executeOrder 落地 */
async function requestRetreat(b: BattleInfo): Promise<void> {
  if (retreatingId.value) return
  retreatingId.value = b.id
  try {
    const defDetail = OWNER_DETAILS[b.defender]
    const atkLabel = (OWNER_LABELS as Record<string, string>)[b.attacker] ?? b.attacker
    const outcome = await judgeRetreat({
      defenderTag: (OWNER_LABELS as Record<string, string>)[b.defender] ?? b.defender,
      defenderLeader: defDetail?.leader ?? (OWNER_LABELS as Record<string, string>)[b.defender] ?? b.defender,
      personality: defDetail?.personality ?? '沉稳',
      attackerTag: atkLabel,
      fromName: b.fromName,
      toName: b.toName,
      atkForce: atkForce(b),
      defForce: defForce(b),
      turns: b.turns,
      lastAtkLoss: b.lastAttackerLoss,
      lastDefLoss: b.lastDefenderLoss,
    })
    // 暂存裁决结果，先弹窗让玩家看叙事，关闭后再落地
    retreatVerdictOrder.value = {
      ids: [b.id],
      retreatLoss: outcome.pursuitLoss,
      narrative: outcome.narrative,
    }
    retreatVerdictText.value = outcome.narrative
    retreatVerdictVisible.value = true
  } finally {
    retreatingId.value = null
  }
}

/** 分组撤退请求：聚合所有攻方数据 → AI 裁决 → 批量停战 */
async function requestRetreatGroup(g: BattleGroup): Promise<void> {
  if (retreatingGroupId.value) return
  retreatingGroupId.value = g.key
  try {
    const store = useGameStore()
    const me = store.currentFaction
    if (!me) return
    const defDetail = OWNER_DETAILS[g.defender]
    // 聚合我方攻方数据
    const myBattles = g.battles.filter((b) => b.attacker === me)
    if (!myBattles.length) return
    const totalAtkForce = myBattles.reduce((sum, b) => sum + atkForce(b), 0)
    const defForceVal = defForce(myBattles[0])
    const maxTurnsVal = Math.max(...myBattles.map((b) => b.turns))
    const totalAtkLoss = myBattles.reduce((sum, b) => sum + b.lastAttackerLoss, 0)
    const defLastLoss = myBattles[0].lastDefenderLoss
    const routeNames = myBattles.map((b) => `${b.fromName}→${b.toName}`).join('、')
    const outcome = await judgeRetreat({
      defenderTag: (OWNER_LABELS as Record<string, string>)[g.defender] ?? g.defender,
      defenderLeader: defDetail?.leader ?? (OWNER_LABELS as Record<string, string>)[g.defender] ?? g.defender,
      personality: defDetail?.personality ?? '沉稳',
      attackerTag: (OWNER_LABELS as Record<string, string>)[me] ?? me,
      fromName: routeNames,
      toName: g.toName,
      atkForce: totalAtkForce,
      defForce: defForceVal,
      turns: maxTurnsVal,
      lastAtkLoss: totalAtkLoss,
      lastDefLoss: defLastLoss,
    })
    retreatVerdictOrder.value = {
      ids: myBattles.map((b) => b.id),
      retreatLoss: outcome.pursuitLoss,
      narrative: outcome.narrative,
    }
    retreatVerdictText.value = outcome.narrative
    retreatVerdictVisible.value = true
  } finally {
    retreatingGroupId.value = null
  }
}

/** 撤退弹窗关闭 → 批量执行停战 */
function onRetreatVerdictConfirm(): void {
  const o = retreatVerdictOrder.value
  if (!o) return
  retreatVerdictVisible.value = false
  for (const id of o.ids) {
    executeOrder({
      order: 'stopBattle',
      id,
      reason: 'retreat',
      retreatLoss: o.retreatLoss,
      text: o.narrative,
    })
  }
  retreatVerdictOrder.value = null
}

// ── 求和谈判弹窗（照撤退范式；赔款玩家视角带符号：正=我方付给对方）──
const PEACE_MAX_ROUNDS = 3

interface PeaceState {
  battle: BattleInfo
  battleIds: string[]   // 该分组下所有战斗 id（用于批量停战）
  groupKey: string      // 分组 key
  foe: Owner            // 对方势力
  playerSide: 'attacker' | 'defender'
  round: number
  busy: boolean         // AI 思考中
  outcome: PeaceResult | null
}
const peaceState = ref<PeaceState | null>(null)
const peaceVisible = ref(false)
const counterInput = ref('')

/** 当前谈判对方标签 */
const peaceFoeLabel = computed(() => {
  const s = peaceState.value
  return s ? ((OWNER_LABELS as Record<string, string>)[s.foe] ?? s.foe) : ''
})
/** 当前赔款文本（玩家视角） */
const peaceIndemnityText = computed(() => {
  const o = peaceState.value?.outcome
  if (!o) return ''
  if (o.indemnity > 0) return `我方赔付 ${o.indemnity} 万银`
  if (o.indemnity < 0) return `对方倒贴 ${-o.indemnity} 万银`
  return '互不赔款'
})
/** 是否还能还价（未到上限、非最终报价、非 AI 思考中） */
const canCounter = computed(() => {
  const s = peaceState.value
  return !!s && s.round < PEACE_MAX_ROUNDS && !!s.outcome && !s.outcome.final && !s.busy
})

/** 求和开局：调 AI 定首轮回应，弹窗展示 */
async function requestPeace(b: BattleInfo): Promise<void> {
  const store = useGameStore()
  const me = store.currentFaction
  if (!me || (b.attacker !== me && b.defender !== me)) return
  const foe = me === b.attacker ? b.defender : b.attacker
  const side: 'attacker' | 'defender' = me === b.attacker ? 'attacker' : 'defender'
  const myForce = side === 'attacker' ? atkForce(b) : defForce(b)
  const foeForce = side === 'attacker' ? defForce(b) : atkForce(b)
  const foeDetail = OWNER_DETAILS[foe]
  peaceState.value = { battle: b, battleIds: [b.id], groupKey: '', foe, playerSide: side, round: 1, busy: true, outcome: null }
  peaceVisible.value = true
  counterInput.value = ''
  try {
    const outcome = await negotiatePeace({
      foeTag: (OWNER_LABELS as Record<string, string>)[foe] ?? foe,
      foeLeader: foeDetail?.leader ?? ((OWNER_LABELS as Record<string, string>)[foe] ?? foe),
      personality: foeDetail?.personality ?? '沉稳',
      playerTag: (OWNER_LABELS as Record<string, string>)[me] ?? me,
      playerSide: side,
      fromName: b.fromName,
      toName: b.toName,
      myForce,
      foeForce,
      turns: b.turns,
      myLastLoss: side === 'attacker' ? b.lastAttackerLoss : b.lastDefenderLoss,
      foeLastLoss: side === 'attacker' ? b.lastDefenderLoss : b.lastAttackerLoss,
      myTreasury: store.getTreasury(me),
      foeTreasury: store.getTreasury(foe),
      round: 1,
    })
    // AI 返回时战斗可能已结束，丢弃结果
    if (!peaceState.value || peaceState.value.battle.id !== b.id) return
    peaceState.value.outcome = outcome
    peaceState.value.busy = false
  } catch {
    if (peaceState.value) {
      peaceState.value.outcome = { accept: false, indemnity: 0, narrative: '和议未成。', final: false }
      peaceState.value.busy = false
    }
  }
}

/** 分组求和请求：聚合我方数据 → AI 谈判 → 批量停战 */
async function requestPeaceGroup(g: BattleGroup): Promise<void> {
  const store = useGameStore()
  const me = store.currentFaction
  if (!me) return
  // 确定我方在该分组中的角色和对应战斗
  const isDefender = g.defender === me
  const myBattles = isDefender
    ? g.battles  // 守方：所有攻方打我方，全部算我方参战
    : g.battles.filter((b) => b.attacker === me)
  if (!myBattles.length) return
  const foe = isDefender ? g.defender : g.battles.find((b) => b.attacker === me)?.defender ?? g.defender
  // 若守方是我方，敌方是攻方（可能多个势力），取第一个攻方势力作为谈判对手
  const foeFaction = isDefender
    ? (g.battles.find((b) => b.attacker !== me)?.attacker ?? g.battles[0].attacker)
    : foe
  const side: 'attacker' | 'defender' = isDefender ? 'defender' : 'attacker'
  // 聚合我方兵力/损耗
  const myTotalForce = myBattles.reduce((sum, b) => sum + (side === 'attacker' ? atkForce(b) : defForce(b)), 0)
  const foeTotalForce = isDefender
    ? myBattles.reduce((sum, b) => sum + atkForce(b), 0)
    : defForce(myBattles[0])
  const maxTurnsVal = Math.max(...myBattles.map((b) => b.turns))
  const myTotalLoss = myBattles.reduce((sum, b) => sum + (side === 'attacker' ? b.lastAttackerLoss : b.lastDefenderLoss), 0)
  const foeTotalLoss = isDefender
    ? myBattles.reduce((sum, b) => sum + b.lastAttackerLoss, 0)
    : myBattles[0].lastDefenderLoss
  const routeNames = myBattles.map((b) => `${b.fromName}→${b.toName}`).join('、')
  const foeDetail = OWNER_DETAILS[foeFaction]
  peaceState.value = {
    battle: myBattles[0],
    battleIds: myBattles.map((b) => b.id),
    groupKey: g.key,
    foe: foeFaction,
    playerSide: side,
    round: 1,
    busy: true,
    outcome: null,
  }
  peaceVisible.value = true
  counterInput.value = ''
  try {
    const outcome = await negotiatePeace({
      foeTag: (OWNER_LABELS as Record<string, string>)[foeFaction] ?? foeFaction,
      foeLeader: foeDetail?.leader ?? ((OWNER_LABELS as Record<string, string>)[foeFaction] ?? foeFaction),
      personality: foeDetail?.personality ?? '沉稳',
      playerTag: (OWNER_LABELS as Record<string, string>)[me] ?? me,
      playerSide: side,
      fromName: routeNames,
      toName: g.toName,
      myForce: myTotalForce,
      foeForce: foeTotalForce,
      turns: maxTurnsVal,
      myLastLoss: myTotalLoss,
      foeLastLoss: foeTotalLoss,
      myTreasury: store.getTreasury(me),
      foeTreasury: store.getTreasury(foeFaction),
      round: 1,
    })
    if (!peaceState.value || peaceState.value.groupKey !== g.key) return
    peaceState.value.outcome = outcome
    peaceState.value.busy = false
  } catch {
    if (peaceState.value) {
      peaceState.value.outcome = { accept: false, indemnity: 0, narrative: '和议未成。', final: false }
      peaceState.value.busy = false
    }
  }
}

/** 还价：带上玩家期望额度再调一轮 AI */
async function onPeaceCounter(): Promise<void> {
  const s = peaceState.value
  const store = useGameStore()
  const me = store.currentFaction
  if (!s || !me || s.busy || s.round >= PEACE_MAX_ROUNDS) return
  const counter = Number(counterInput.value)
  if (!Number.isFinite(counter)) {
    useToast().push({ icon: 'alert-triangle', tone: 'error', title: '还价', text: '请输入一个数字（万银）' })
    return
  }
  const b = s.battle
  const myForce = s.playerSide === 'attacker' ? atkForce(b) : defForce(b)
  const foeForce = s.playerSide === 'attacker' ? defForce(b) : atkForce(b)
  const foeDetail = OWNER_DETAILS[s.foe]
  const round = s.round + 1
  s.round = round
  s.busy = true
  s.outcome = null
  counterInput.value = ''
  try {
    const outcome = await negotiatePeace({
      foeTag: (OWNER_LABELS as Record<string, string>)[s.foe] ?? s.foe,
      foeLeader: foeDetail?.leader ?? ((OWNER_LABELS as Record<string, string>)[s.foe] ?? s.foe),
      personality: foeDetail?.personality ?? '沉稳',
      playerTag: (OWNER_LABELS as Record<string, string>)[me] ?? me,
      playerSide: s.playerSide,
      fromName: b.fromName,
      toName: b.toName,
      myForce,
      foeForce,
      turns: b.turns,
      myLastLoss: s.playerSide === 'attacker' ? b.lastAttackerLoss : b.lastDefenderLoss,
      foeLastLoss: s.playerSide === 'attacker' ? b.lastDefenderLoss : b.lastAttackerLoss,
      myTreasury: store.getTreasury(me),
      foeTreasury: store.getTreasury(s.foe),
      round,
      playerCounter: Math.round(counter),
    })
    if (!peaceState.value || peaceState.value.battle.id !== b.id) return
    peaceState.value.outcome = outcome
    peaceState.value.busy = false
  } catch {
    if (peaceState.value) {
      peaceState.value.outcome = { accept: false, indemnity: 0, narrative: '来使语塞，谈判僵持。', final: false }
      peaceState.value.busy = false
    }
  }
}

/** 接受当前条件：转移赔款 + 批量停战 */
function onPeaceAccept(): void {
  const s = peaceState.value
  const store = useGameStore()
  const me = store.currentFaction
  if (!s || !s.outcome || !me) return
  const ind = s.outcome.indemnity
  // 赔款双向转移（正=玩家付出；扣成负数由经济系统欠饷机制承接，不阻断议和）
  if (ind !== 0) {
    store.applyEvent({ type: 'treasuryChange', faction: me, delta: -ind, reason: '议和赔款' })
    store.applyEvent({ type: 'treasuryChange', faction: s.foe, delta: ind, reason: '议和受款' })
  }
  peaceVisible.value = false
  for (const id of s.battleIds) {
    executeOrder({ order: 'stopBattle', id, reason: 'peace', text: s.outcome.narrative })
  }
  peaceState.value = null
}

/** 拒绝 / 谈判破裂：关弹窗，战斗继续 */
function onPeaceReject(): void {
  peaceVisible.value = false
  useToast().push({ icon: 'affiliate', tone: 'neutral', title: '议和破裂', text: '和谈未成，战事继续' })
  peaceState.value = null
}

/** 读取存档：代理到 useSaveGame.loadGame（含地图重绘收尾） */
function onLoadGame(slot: string): void {
  loadGame(slot)
  loadModalVisible.value = false
  // 读档后恢复进行中的外交协商 session（若存在）
  const bus = useDiplomacyBus()
  bus.recoverSession()
}

// ─── 战况面板辅助（实时读取 store 城市态，随每回合结算自动刷新）───

function ownerLabel(o: Owner | undefined): string {
  if (!o) return '—'
  return (OWNER_LABELS as Record<string, string>)[o] || o
}
/** 攻方投入战场的野战兵力 = 来源城 fieldForce */
function atkForce(b: BattleInfo): number {
  return (useGameStore().cities as Record<string, CityData>)[b.from]?.fieldForce ?? 0
}
/** 守方兵力 = 目标城驻军 */
function defForce(b: BattleInfo): number {
  return (useGameStore().cities as Record<string, CityData>)[b.to]?.troops ?? 0
}
/** 攻方野战兵力占双方合计的百分比（兵力条），委托共享 util */
function forceShare(b: BattleInfo): number {
  return battleForceShare(atkForce(b), defForce(b))
}
/** 走势：按上回合双方损耗判定，委托共享 util */
function trend(b: BattleInfo): { label: string; cls: string } {
  return battleTrend(b, 'lastTurn')
}

// ─── 分组战斗卡片辅助函数 ───
/** 分组内最大回合数（折叠态标题显示） */
function maxTurns(g: BattleGroup): number {
  return Math.max(...g.battles.map((b) => b.turns), 0)
}

/** 分组内最近一场有叙事的战报 */
function latestNarrative(g: BattleGroup): string {
  for (const b of g.battles) {
    if (b.lastNarrative) return b.lastNarrative
  }
  return ''
}

/** 玩家是否为该分组参战方（攻方或守方均可求和） */
function canPeaceGroup(g: BattleGroup): boolean {
  const me = useGameStore().currentFaction
  if (!me) return false
  // 守方是我方，或任意攻方是我方
  if (g.defender === me) return true
  return g.battles.some((b) => b.attacker === me)
}

/** 玩家是否为该分组攻方（撤退仅攻方可发起） */
function canRetreatGroup(g: BattleGroup): boolean {
  const me = useGameStore().currentFaction
  if (!me) return false
  return g.battles.some((b) => b.attacker === me)
}

// ─── 战况浮层（DOM 卡片锚定守方城，跟随相机）───
/** 每场战斗卡片的屏幕 transform（缺省即出屏/隐藏） */
const battleCardPos = ref<Record<string, string>>({})
/** 卡片展开状态（默认折叠，节省屏占） */
const battleCardExpanded = ref<Record<string, boolean>>({})

function toggleBattleCard(id: string): void {
  battleCardExpanded.value[id] = !battleCardExpanded.value[id]
}

/**
 * 按守方城市分组投影卡片屏幕坐标。
 * 由 applyCamera() 每帧调用，天然跟手。
 * 锚点出屏则不生成条目 → v-show 隐藏。
 */
function syncBattleCards(): void {
  const w = mapContainer.value?.clientWidth ?? 0
  const h = mapContainer.value?.clientHeight ?? 0
  const next: Record<string, string> = {}
  for (const g of groupedBattles.value) {
    // 有任意一场 active 即显示卡片
    if (!g.battles.some((b) => b.active)) continue
    const local = resolveLocationXY(g.toGb)
    if (!local) continue
    const sx = local.x * mapScale + mapX
    const sy = local.y * mapScale + mapY
    // 锚点出屏 → 隐藏
    if (sx < -40 || sx > w + 40 || sy < 140 || sy > h + 40) continue
    // 卡片浮在城池上方：锚点再抬 26px，translate(-50%,-100%) 使尖角指向城
    next[g.key] = `translate3d(${sx}px, ${sy - 26}px, 0) translate(-50%, -100%)`
  }
  battleCardPos.value = next
}

// 战斗新增/结束 → 重算卡片。battles 原地 push/filter（引用不变），须 deep 才能捕获
watch(battleList, syncBattleCards, { deep: true })

function onGlobalMouseDown(e: MouseEvent): void {
  if (!contextMenuVisible.value) return
  const menu = document.querySelector('.context-menu')
  if (menu && menu.contains(e.target as Node)) return
  closeContextMenu()
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    cameraController.cancel()
    if (infoModalVisible.value) {
      closeInfoModal()
    } else {
      closeContextMenu()
    }
  }
}

// ─── 面板 → 地图 联动（聚焦请求）───
watch(
  () => useGameStore().focusTarget,
  (target) => {
    if (!target) return
    if (target.type === 'city') {
      focusCity(target.id)
    } else if (target.type === 'battle') {
      focusBattle(target.id)
    }
  },
)

function findCityFeature(gb: string): GeoJSON.Feature | null {
  const cityJson = geoJsonCache.get(LAYERS[1].file)
  if (!cityJson) return null
  return cityJson.features.find((f) => (f.properties?.gb as string | undefined) === gb) ?? null
}

function focusCity(gb: string): void {
  cameraController.focusOn(gb)
  const feat = findCityFeature(gb)
  if (feat) {
    clearAllHighlights()
    highlightFeature(feat, 0xb04a3a)
  }
}

function focusBattle(id: string): void {
  const b = useGameStore().battles.find((x) => x.id === id)
  if (!b) return
  if (b.to) cameraController.focusOn(b.to)
  clearAllHighlights()
  const fTo = b.to ? findCityFeature(b.to) : null
  const fFrom = b.from ? findCityFeature(b.from) : null
  if (fTo) highlightFeature(fTo, 0xb04a3a)
  if (fFrom) highlightFeature(fFrom, 0x5f7fa6)
}

// ─── 标签图层 ───

function getLabelStyle(layerIndex: number): TextStyle {
  const sizes = [16, 13, 11]
  // 舆图注记：墨色汇文明朝体，罩一层极淡的纸色光晕保证色块上的可读性
  // （不是黑描边——白字黑边是 GIS 的味道，此处要的是"手写注记"）
  return new TextStyle({
    fontSize: sizes[layerIndex],
    fill: 0x3b2a18, // --ink
    fontFamily: '"HuiWen Ming", serif',
    letterSpacing: 2,
    stroke: {
      color: 0xefe6cf, // --paper-hi 同族，极淡纸晕
      width: 2.5,
    },
  })
}

function renderLabels(
  data: GeoJSON.FeatureCollection,
  width: number,
  height: number,
  layerIndex: number,
): void {
  labelContainer.removeChildren()
  const style = getLabelStyle(layerIndex)

  for (const feature of data.features) {
    const geoName = feature.properties?.name as string | undefined
    if (!geoName) continue

    const gb = feature.properties?.gb as string | undefined
    const displayName = (gb && getDisplayName(gb)) || geoName

    const centroid = calculateCentroid(feature.geometry)
    if (!centroid) continue

    const screenPos = geoToScreen(centroid.lng, centroid.lat, width, height)
    const text = new Text({
      text: displayName,
      style,
    }) as LabelText
    text.anchor.set(0.5)
    text._geoX = screenPos.x
    text._geoY = screenPos.y
    text.x = screenPos.x
    text.y = screenPos.y
    labelContainer.addChild(text)
  }
}

function updateLabels(): void {
  if (!labelContainer) return
  for (const child of labelContainer.children) {
    const label = child as LabelText
    label.x = label._geoX * mapScale + mapX
    label.y = label._geoY * mapScale + mapY
  }
}

// ─── 领土文字水印（满铺）───
//
// 把政权名织成平铺纹理铺满疆域，用势力色、低透明度，回答"这块地是谁的"。
// 曾有一枚"首府朱砂实印"作锚点，现已移除——文字水印本身已表达归属，无需方章。

/** 水印字体：与地图注记同族，明朝体 */
const SEAL_FONT = '"HuiWen Ming", serif'

/** 图案填充矩阵：抵消纹理超采样带来的周期放大（fill 只读取不持有，可安全复用） */
const SEAL_PATTERN_MATRIX = new Matrix().scale(1 / SEAL_TEX_RES, 1 / SEAL_TEX_RES)

/**
 * 生成某势力的平铺文字水印纹理。
 *
 * 单元内放三条**横贯的势力名词带**（词 + 全角空格循环成流，长于单元本身），
 * 每行横向相位递增 1/3 周期——矩形 repeat 下三行词流错落如砖墙，
 * 观感是整片疆域上连绵不断的政权名水印，而不是呆板的单格点阵。
 * 词流首尾以空格收束，单元边界多切在空隙处，不劈断单字。
 */
function buildSealTexture(owner: Owner): Texture {
  // OWNER_COLORS 覆盖全部 Owner，兜底色仅为防御
  const color = (OWNER_COLORS as Record<string, number>)[owner] ?? 0x5f7fa6
  const label = (OWNER_LABELS as Record<string, string>)[owner] ?? owner
  const tile = new Container()

  // 词流：词 + 两枚全角空格 循环若干遍 + 长空格收尾，保证比单元宽多出一截，
  // 于是任意单元窗内都是连续的"词·隙·词"段落，右缘裁切多落在收尾空隙上。
  const gap = '\u3000\u3000'
  let stream = ''
  const cycles = Math.max(2, Math.ceil(SEAL_TILE / ((label.length + 2) * SEAL_TEXT_FS)) + 1)
  for (let i = 0; i < cycles; i++) stream += label + gap
  stream += label + '\u3000\u3000\u3000\u3000\u3000\u3000'

  SEAL_BAND_YS.forEach((fy, i) => {
    const text = new Text({
      text: stream,
      style: new TextStyle({
        fontFamily: SEAL_FONT,
        fontSize: SEAL_TEXT_FS,
        fill: color,
      }),
    })
    text.anchor.set(0, 0.5)
    // 横向相位逐行递增，纵向按 fy 均分：三行词流交错，铺开无竖缝
    text.x = 8 + ((i * SEAL_BAND_X_SHIFT) % 1) * SEAL_TILE
    text.y = fy * SEAL_TILE
    tile.addChild(text)
  })

  const texture = app.renderer.generateTexture({
    target: tile,
    // 显式 frame：让平铺网格严格对齐 SEAL_TILE，不受文字 bounds 影响
    frame: new Rectangle(0, 0, SEAL_TILE, SEAL_TILE),
    resolution: SEAL_TEX_RES,
    antialias: true,
  })
  tile.destroy({ children: true })
  return texture
}

/** 重建全部势力纹理（字体就绪后需重来一次，否则字形会固化成 fallback） */
function buildSealTextures(): void {
  if (!app?.renderer) return
  disposeSealTextures()
  for (const owner of Object.values(Owner)) {
    if (owner === Owner.NEUTRAL) continue
    sealTextures.set(owner, buildSealTexture(owner))
  }
}

/** 摘掉并销毁当前水印图形，切断对旧纹理的引用 */
function disposeSealWatermark(): void {
  if (!sealWatermarkGfx) return
  sealWatermarkGfx.removeFromParent()
  sealWatermarkGfx.destroy()
  sealWatermarkGfx = null
}

function disposeSealTextures(): void {
  disposeSealWatermark()
  for (const texture of sealTextures.values()) texture.destroy(true)
  sealTextures.clear()
}

/**
 * 把某势力的领土轮廓用印章纹理铺满。
 *
 * textureSpace: 'global' 是关键——所有多边形共享同一张平铺网格，
 * 于是同势力各市之间的市界不会切断花纹，整块疆域看起来是一片连续印花。
 */
function fillSealWatermark(gfx: Graphics, polygons: PolygonRings[], owner: Owner): void {
  const texture = sealTextures.get(owner)
  if (!texture) return
  fillPolygons(gfx, polygons, () => {
    gfx.fill({
      texture,
      textureSpace: 'global',
      matrix: SEAL_PATTERN_MATRIX,
      alpha: sealWatermarkAlpha.value,
    })
  })
}

// ─── 图层切换 ───

async function switchLayer(index: number): Promise<void> {
  if (currentLayerIndex.value === index) return
  currentLayerIndex.value = index
  await loadLayer(index)
}

async function toggleOwnerColor(): Promise<void> {
  ownerColorEnabled.value = !ownerColorEnabled.value
  await loadLayer(currentLayerIndex.value)
}

function toggleLabels(): void {
  labelsVisible.value = !labelsVisible.value
  labelContainer.visible = labelsVisible.value
}

async function toggleSealWatermark(): Promise<void> {
  sealWatermarkEnabled.value = !sealWatermarkEnabled.value
  await loadLayer(currentLayerIndex.value)
}

/** 调试滑条改动浓度后重铺水印（纹理不变，只需重画几何） */
async function redrawSealWatermark(): Promise<void> {
  await loadLayer(currentLayerIndex.value)
}

async function loadLayer(index: number): Promise<void> {
  if (!app?.renderer) return // 防御：HMR 或销毁后 app 可能无效
  const config = LAYERS[index]
  if (!geoJsonCache.has(config.file)) {
    const res = await fetch(config.file)
    geoJsonCache.set(config.file, await res.json())
  }

  currentData = geoJsonCache.get(config.file) ?? null
  const width = app.screen.width
  const height = app.screen.height

  worldContainer.removeChildren()
  labelContainer.removeChildren()
  // removeChildren 只解父子关系，水印图形需显式销毁以释放 GPU 资源
  disposeSealWatermark()

  // 海域罩染：先铺一层极淡的冷色，让本国疆域内的海与纸面微微区分，
  // 又不割裂「整屏一张纸」的氛围（罩染在陆地图层之下）
  if (currentData) {
    const seaGfx = new Graphics()
    for (const feature of currentData.features) {
      drawFeature(
        seaGfx,
        feature,
        width,
        height,
        { color: MAP_PALETTE.seaTint, fillColor: MAP_PALETTE.seaTint, borderWidth: 0 },
        MAP_PALETTE.seaAlpha,
      )
    }
    worldContainer.addChild(seaGfx)
  }

  const graphics = new Graphics()
  /**
   * 按势力归集的领土轮廓。
   * 水印要在底色之上再铺一遍同样的几何，这里顺手存下来，
   * 免得把几十万次经纬度换算做第二遍。
   */
  const ringsByOwner = new Map<Owner, PolygonRings[]>()
  if (currentData) {
    const ownership = useGameStore().ownership
    for (const feature of currentData.features) {
      let fillColor = config.fillColor
      // 归属判定与「政权着色」开关解耦：关掉着色只是不填色，水印照样能表达归属
      let owner: Owner | null = null
      const gb = feature.properties?.gb as string | undefined
      if (index === 1 && gb) {
        owner = (ownership[gb] ?? null) as Owner | null
        if (owner && ownerColorEnabled.value) {
          fillColor = (OWNER_COLORS as Record<string, number>)[owner] ?? config.fillColor
        }
      }
      const polygons = collectFeatureRings(feature, width, height)
      fillPolygons(graphics, polygons, () => {
        graphics.fill({ color: fillColor, alpha: 0.5 })
        graphics.stroke({
          width: MAP_PALETTE.landBorderWidth,
          color: config.color,
          alpha: 1,
        })
      })
      if (owner && polygons.length > 0) {
        const bucket = ringsByOwner.get(owner)
        if (bucket) bucket.push(...polygons)
        else ringsByOwner.set(owner, [...polygons])
      }
    }
  }
  worldContainer.addChild(graphics)

  // 领土文字水印：铺在底色之上、选中高亮之下。
  // 只有市级图层（index 1）带 gb 归属，省级图层无城市几何可铺，直接跳过。
  if (sealWatermarkEnabled.value && index === 1 && sealTextures.size > 0) {
    const watermark = new Graphics()
    for (const [owner, polygons] of ringsByOwner) {
      if (owner === Owner.NEUTRAL) continue
      fillSealWatermark(watermark, polygons, owner)
    }
    sealWatermarkGfx = watermark
    worldContainer.addChild(watermark)
  }
  worldContainer.addChild(selectionHighlightGfx)
  selectedFeature = null

  if (currentData) {
    renderLabels(currentData, width, height, index)
  }
  labelContainer.visible = labelsVisible.value
  updateLabels()
}

// ─── 相机控制（镜头演出）───
let cameraLocked = false
let cameraRaf: number | null = null
let cameraInterrupt = false
let cameraResolve: (() => void) | null = null
const FOCUS_SCALE = 2.8
const cameraEase = (t: number): number => 1 - Math.pow(1 - t, 3) // easeOutCubic

/** 将当前相机状态应用到所有容器（抽出给镜头补间复用，替代各 handler 里的重复 transform） */
function applyCamera(): void {
  worldContainer.scale.set(mapScale)
  worldContainer.position.set(mapX, mapY)
  baseContainer.scale.set(mapScale)
  baseContainer.position.set(mapX, mapY)
  fxContainer.scale.set(mapScale)
  fxContainer.position.set(mapX, mapY)
  updateLabels()
  syncBattleCards()
}

/** 将相机平滑补间到目标 {scale, x, y} */
function animateCameraTo(target: CameraTarget, duration: number): Promise<void> {
  return new Promise((resolve) => {
    // 减少动态偏好：跳过补间，直接归位
    if (prefersReducedMotion()) {
      mapScale = target.scale
      mapX = target.x
      mapY = target.y
      applyCamera()
      resolve()
      return
    }
    if (cameraRaf) cancelAnimationFrame(cameraRaf)
    cameraInterrupt = false
    cameraResolve = resolve
    const start: CameraTarget = { scale: mapScale, x: mapX, y: mapY }
    const startTime = performance.now()
    const step = (now: number): void => {
      if (cameraInterrupt) {
        cameraRaf = null
        cameraResolve = null
        resolve()
        return
      }
      const p = Math.min((now - startTime) / duration, 1)
      const e = cameraEase(p)
      mapScale = start.scale + (target.scale - start.scale) * e
      mapX = start.x + (target.x - start.x) * e
      mapY = start.y + (target.y - start.y) * e
      applyCamera()
      if (p < 1) {
        cameraRaf = requestAnimationFrame(step)
      } else {
        cameraRaf = null
        cameraResolve = null
        resolve()
      }
    }
    cameraRaf = requestAnimationFrame(step)
  })
}

/** 计算「把某地点居中并缩放」的相机目标（用世界坐标，与动画库 resolveLocationXY 一致） */
function cameraTargetFor(id: string, scale: number): CameraTarget | null {
  const local = resolveLocationXY(id)
  if (!local) return null
  return {
    scale,
    x: app.screen.width / 2 - local.x * scale,
    y: app.screen.height / 2 - local.y * scale,
  }
}

/** 暴露给 gameOrders 的相机控制接口（依赖注入，避免把相机状态迁到 composable） */
const cameraController = {
  snapshot(): CameraTarget {
    return { scale: mapScale, x: mapX, y: mapY }
  },
  setLocked(v: boolean): void {
    cameraLocked = v
  },
  /** 放大并居中某地点 */
  focusOn(id: string, duration = 600): Promise<void> {
    const scale = Math.max(mapScale, FOCUS_SCALE)
    const target = cameraTargetFor(id, scale)
    if (!target) return Promise.resolve()
    return animateCameraTo(target, duration)
  },
  /** 保持当前缩放，平移到某地点（镜头跟随行军） */
  followTo(id: string, duration: number): Promise<void> {
    const scale = Math.max(mapScale, FOCUS_SCALE)
    const target = cameraTargetFor(id, scale)
    if (!target) return Promise.resolve()
    return animateCameraTo(target, duration)
  },
  /** 还原到指定相机状态（演出结束归位） */
  reset(target: CameraTarget, duration = 500): Promise<void> {
    return animateCameraTo(target, duration)
  },
  /** 取消进行中的镜头补间并解锁（ESC 中断演出） */
  cancel(): void {
    cameraInterrupt = true
    if (cameraRaf) {
      cancelAnimationFrame(cameraRaf)
      cameraRaf = null
    }
    if (cameraResolve) {
      cameraResolve()
      cameraResolve = null
    }
    cameraLocked = false
  },
}

// ─── 平移/缩放 ───

function onWheel(e: WheelEvent): void {
  e.preventDefault()

  if (!mapContainer.value) return
  const rect = mapContainer.value.getBoundingClientRect()
  const mouseX = e.clientX - rect.left
  const mouseY = e.clientY - rect.top

  if (cameraLocked) return

  const delta = e.deltaY > 0 ? 0.9 : 1.1
  const newScale = rubberbandClamp(mapScale * delta, ZOOM_MIN, ZOOM_MAX)

  const scaleRatio = newScale / mapScale
  mapX = mouseX - (mouseX - mapX) * scaleRatio
  mapY = mouseY - (mouseY - mapY) * scaleRatio
  mapScale = newScale

  applyCamera()
  // 停在软边界外时轻微回弹归位（可被下一次滚轮 / 镜头补间打断）
  if (mapScale < ZOOM_MIN || mapScale > ZOOM_MAX) scheduleZoomRest()
}

function onPointerDown(e: PointerEvent): void {
  if (cameraLocked) return
  isDragging = true
  lastPointer.x = e.clientX
  lastPointer.y = e.clientY
  pointerDownPos.x = e.clientX
  pointerDownPos.y = e.clientY
  app.canvas.style.cursor = 'grabbing'
}

function onPointerMove(e: PointerEvent): void {
  if (!isDragging) return
  mapX += e.clientX - lastPointer.x
  mapY += e.clientY - lastPointer.y
  lastPointer.x = e.clientX
  lastPointer.y = e.clientY
  applyCamera()
}

function onPointerUp(): void {
  isDragging = false
  app.canvas.style.cursor = 'grab'
}

function onClick(e: MouseEvent): void {
  const dx = e.clientX - pointerDownPos.x
  const dy = e.clientY - pointerDownPos.y
  if (Math.sqrt(dx * dx + dy * dy) > 5) return

  if (!mapContainer.value) return
  const rect = mapContainer.value.getBoundingClientRect()
  const screenX = e.clientX - rect.left
  const screenY = e.clientY - rect.top

  const result = hitTestAll(screenX, screenY)
  if (!result) {
    clearAllHighlights()
    return
  }

  clearAllHighlights()

  if (result.layer === 'china') {
    console.log('点击区域:', result.feature.properties)
    selectedFeature = result.feature
    highlightFeature(result.feature)
  } else {
    console.log('点击国家:', result.feature.properties)
    selectedWorldFeature = result.feature
    highlightBaseFeature(result.feature)
  }
}

/** 全量重绘：清空所有渲染层并按当前状态重新绘制（相机位置保持不变）。 */
async function fullRerender(): Promise<void> {
  setScreenSize(app.screen.width, app.screen.height)
  disposeCloudTransition()
  clearAllHighlights()
  await loadLayer(currentLayerIndex.value)
  if (baseMapVisible.value) {
    await renderBaseMap()
  }
  resetBattleRuntime()
  restoreActiveAnimations()
  applyCamera()
}

function onResize(): void {
  requestAnimationFrame(async () => {
    const width = app.screen.width
    const height = app.screen.height
    setScreenSize(width, height)

    const center = geoToScreen(104, 36, width, height)
    mapX = width / 2 - center.x
    mapY = height / 2 - center.y
    applyCamera()

    await loadLayer(currentLayerIndex.value)
    if (baseMapVisible.value) {
      await renderBaseMap()
    }
    // fxContainer 不被 loadLayer 清除，但光束坐标在 startBattleAnimation 创建时
    // 烘焙（p0/p1/p2 闭包），resize 后 geoToScreen 的 scale 变了而光束不更新。
    // 销毁旧动画并按 store 的 ACTIVE 战斗重建（新动画用新 screenSize 算坐标）。
    resetBattleRuntime()
    restoreActiveAnimations()
  })
}

// ─── 生命周期 ───

onMounted(async () => {
  app = new Application()
  await app.init({
    resizeTo: mapContainer.value!,
    backgroundColor: MAP_PALETTE.canvas,
    antialias: true,
  })
  mapContainer.value!.appendChild(app.canvas)

  baseContainer = new Container()
  worldContainer = new Container()
  fxContainer = new Container()
  labelContainer = new Container()
  selectionHighlightGfx = new Graphics()
  baseHighlightGraphics = new Graphics()
  app.stage.addChild(baseContainer)
  app.stage.addChild(worldContainer)
  app.stage.addChild(fxContainer)
  app.stage.addChild(labelContainer)
  worldContainer.addChild(selectionHighlightGfx)

  const width = app.screen.width
  const height = app.screen.height
  setScreenSize(width, height)
  initGameOrders(fxContainer, cameraController, app)
  const center = geoToScreen(104, 36, width, height)
  mapX = width / 2 - center.x
  mapY = height / 2 - center.y
  worldContainer.position.set(mapX, mapY)
  baseContainer.position.set(mapX, mapY)
  fxContainer.position.set(mapX, mapY)

  app.canvas.style.cursor = 'grab'
  app.canvas.addEventListener('wheel', onWheel, { passive: false })
  app.canvas.addEventListener('pointerdown', onPointerDown)
  app.canvas.addEventListener('click', onClick)
  app.canvas.addEventListener('contextmenu', onContextMenu)
  window.addEventListener('resize', onResize)
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('mousedown', onGlobalMouseDown)
  window.addEventListener('keydown', onKeyDown)
  // 监听顾问面板发送指令事件，自动打开指挥面板
  window.addEventListener('open-command-panel', () => {
    commandVisible.value = true
  })

  useGameStore().initWorld()
  console.log('城市态加载完成:', Object.keys(useGameStore().cities).length, '个市')

  // 印章纹理必须在首次 loadLayer 之前就绪，否则第一帧没有水印
  buildSealTextures()

  for (const c of worldCountries) {
    if (c.iso_a3) worldDataMap.set(c.iso_a3, c)
  }
  for (const [geoIso, gameIso] of Object.entries(GEO_TO_GAME_ISO)) {
    const data = worldDataMap.get(gameIso)
    if (data) worldDataMap.set(geoIso, data)
  }
  console.log('世界国家数据加载完成:', worldCountries.length, '个')

  try {
    const res = await fetch('/世界.geojson')
    worldData = await res.json()
    console.log('世界地图加载完成:', worldData!.features.length, '个国家')
    await renderBaseMap()
    registerLocations(worldData!.features, 'iso_a3')
    for (const [geoIso, gameIso] of Object.entries(GEO_TO_GAME_ISO)) {
      registerAlias(geoIso, gameIso)
    }
  } catch (e) {
    console.error('世界地图加载失败:', e)
  }

  await loadLayer(currentLayerIndex.value)

  // 汇文明朝体异步加载：首帧 Pixi Text 纹理可能已用 fallback 字体生成，
  // 字体就绪后重绘一次标签与文字水印，否则字形永远停留在系统衬线上。
  document.fonts?.ready.then(async () => {
    if (!currentData) return
    buildSealTextures()
    await loadLayer(currentLayerIndex.value)
    labelContainer.visible = labelsVisible.value
    updateLabels()
  })

  const cityJson = geoJsonCache.get(LAYERS[1].file)
  if (cityJson) registerLocations(cityJson.features, 'gb')

  // 归属变化时实时重绘当前图层，确保占领/易主后政权着色立即更新
  // 读档期间跳过（isReplaying），由 requestMapReload 触发重绘
  watch(
    () => useGameStore().ownership,
    () => {
      if (useGameStore().isReplaying) return
      loadLayer(currentLayerIndex.value)
    },
  )

  // 读档收尾：store.load() 只重建状态并保持 isReplaying=true，真正的地图重绘 +
  // 战斗动画重建 + 复位 isReplaying 在此完成（那三步的能力只在本组件里）。
  // 存档选择器/useSaveGame 读档后调 requestMapReload() ++token 触发。
  watch(
    () => useGameStore().reloadToken,
    async () => {
      await loadLayer(currentLayerIndex.value)
      restoreActiveAnimations()
      useGameStore().isReplaying = false // 动画恢复完成后才解锁 ownership watcher
    },
  )
})

onUnmounted(() => {
  app?.canvas?.removeEventListener('wheel', onWheel)
  app?.canvas?.removeEventListener('pointerdown', onPointerDown)
  app?.canvas?.removeEventListener('click', onClick)
  app?.canvas?.removeEventListener('contextmenu', onContextMenu)
  window.removeEventListener('resize', onResize)
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('mousedown', onGlobalMouseDown)
  window.removeEventListener('keydown', onKeyDown)
  disposeCloudTransition()
  disposeSealTextures()
  app?.destroy(true)
})
</script>

<style scoped>
/* 弹窗标题旁的复制按钮 */
.title-copy-btn {
  display: inline-flex;
  align-items: center;
  padding: 2px 4px;
  background: none;
  border: 1px solid transparent;
  border-radius: 3px;
  cursor: pointer;
  color: var(--ink-muted, #888);
  transition: all 0.15s ease;
}

.title-copy-btn:hover {
  color: var(--ink-strong, #333);
  border-color: rgba(138, 109, 75, 0.3);
  background: rgba(138, 109, 75, 0.08);
}

.tg-nav-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 16px;
  height: 16px;
  border-radius: 99px;
  background: var(--cinnabar, #b04a3a);
  color: #fff;
  font-size: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 3px;
  line-height: 1;
}

.map-shell {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}

.map-container {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
}

.test-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 20px 18px;
}

/* 水印浓度滑条：调参用，调到满意后把默认值固化回 sealWatermarkAlpha */
.seal-alpha-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: var(--font-kai);
  font-size: 14px;
  letter-spacing: 1px;
  color: var(--ink);
}

.seal-alpha-row input[type='range'] {
  flex: 1;
  accent-color: var(--cinnabar, #b04a3a);
}

.seal-alpha-val {
  min-width: 34px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--ink-muted, #888);
}

.layer-switcher {
  position: absolute;
  top: 16px;
  left: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 1000;
}

.layer-switcher button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border: 1px solid rgba(138, 109, 75, 0.35);
  border-radius: var(--radius-sm);
  background: linear-gradient(to bottom, var(--paper-input), var(--paper-darker));
  color: var(--ink);
  font-family: var(--font-kai);
  letter-spacing: 1px;
  font-size: 14px;
  cursor: pointer;
  /* 只过渡可加速属性，渐变背景不进过渡（Apple §11） */
  transition:
    transform 0.15s ease,
    box-shadow 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;
  box-shadow: 0 1px 2px rgba(90, 60, 20, 0.06);
}

.layer-switcher button:hover {
  background: linear-gradient(to bottom, var(--paper-hi), var(--paper-hi2));
  border-color: rgba(138, 109, 75, 0.55);
  color: var(--ink-strong);
}

/* 按下即时缩放反馈（Apple §1） */
.layer-switcher button:active {
  transform: scale(0.96);
  transition: transform 80ms ease-out;
}

.layer-switcher button.active {
  background: linear-gradient(to bottom, var(--paper-dark), var(--paper-darkest));
  border-color: var(--cinnabar);
  color: var(--cinnabar-ink);
  box-shadow: 0 0 0 1px var(--cinnabar-ring) inset;
}

.owner-toggle {
  margin-top: 8px;
  border-top: 1px solid rgba(138, 109, 75, 0.2);
  padding-top: 8px;
}

.switcher-divider {
  height: 1px;
  background: rgba(138, 109, 75, 0.3);
  margin: 4px 0;
}

.disclaimer-bar {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 500;
  background: var(--paper-panel);
  color: var(--ink-mute);
  font-size: 11px;
  font-family: var(--font-kai);
  letter-spacing: 1px;
  text-align: center;
  padding: 7px 12px;
  cursor: pointer;
  border-top: 1px solid rgba(138, 109, 75, 0.4);
  box-shadow: 0 -2px 8px rgba(60, 40, 15, 0.12);
  transition: background 0.2s;
  user-select: none;
}

.disclaimer-bar:hover {
  background: var(--paper-head2);
  color: var(--ink-mid);
}

.disclaimer-content p {
  margin: 0 0 10px;
  line-height: 1.7;
  color: var(--ink);
  font-size: 14px;
  font-family: var(--font-kai);
}

.disclaimer-content .disclaimer-sources {
  margin-top: 12px;
  margin-bottom: 4px;
  font-weight: bold;
  color: var(--ink-strong);
}

.disclaimer-content ul {
  margin: 0;
  padding-left: 18px;
  color: var(--ink-deep);
  font-size: 13px;
  line-height: 1.8;
}

.disclaimer-content a {
  color: var(--cinnabar);
  text-decoration: none;
}

/* 战斗管理面板内容区 padding（parchment 变体 modal-body padding=0，需自行补） */
.battle-list-body {
  padding: 16px 20px 18px;
}

.battle-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px 11px;
  margin-bottom: 10px;
  background: var(--paper-panel);
  border: 1px solid rgba(138, 109, 75, 0.35);
  border-left: 3px solid var(--cinnabar);
  border-radius: var(--radius-sm);
  color: var(--ink);
  font-family: var(--font-kai);
  box-shadow: 0 1px 3px rgba(90, 60, 20, 0.08);
  transition: box-shadow 0.25s ease, transform 0.25s ease;
}

.battle-item:hover {
  box-shadow: 0 3px 12px rgba(90, 60, 20, 0.18);
  transform: translateY(-1px);
}

.battle-item:last-child {
  margin-bottom: 0;
}

.battle-stale {
  opacity: 0.55;
  border-left-color: var(--brown);
}

.battle-main {
  flex: 1;
  min-width: 0;
}

.battle-title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

/* 交战中的呼吸红点 */
.battle-live {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--cinnabar);
  animation: battle-pulse 1.6s ease-out infinite;
}

@keyframes battle-pulse {
  0% { box-shadow: 0 0 0 0 rgba(176, 74, 58, 0.45); }
  70% { box-shadow: 0 0 0 7px rgba(176, 74, 58, 0); }
  100% { box-shadow: 0 0 0 0 rgba(176, 74, 58, 0); }
}

.battle-route {
  font-size: 15px;
  font-weight: 700;
  color: var(--ink-strong);
  letter-spacing: 0.5px;
}

.battle-arrow {
  margin: 0 6px;
  color: var(--cinnabar);
  font-weight: 700;
}

.battle-turns {
  font-size: 11px;
  color: var(--ink-muted);
  border: 1px solid rgba(138, 109, 75, 0.4);
  border-radius: 3px;
  padding: 1px 5px;
}

.battle-vs {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.battle-side {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.side-def {
  flex-direction: row-reverse;
}

.side-tag {
  flex: none;
  width: 18px;
  height: 18px;
  line-height: 18px;
  text-align: center;
  font-size: 11px;
  font-weight: 700;
  color: #fff8ee;
  background: var(--cinnabar);
  border-radius: 3px;
}

.tag-def {
  background: var(--brown);
}

.side-faction {
  font-size: 12px;
  color: var(--ink-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.side-troops {
  font-size: 17px;
  font-weight: 700;
  color: var(--ink-strong);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.side-troops.warn {
  color: var(--cinnabar);
}

.side-sub {
  font-size: 10px;
  font-weight: 400;
  color: var(--ink-muted);
  margin-left: 2px;
}

.vs-mark {
  flex: none;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 2px;
  color: var(--cinnabar);
}

/* 兵力对比条：朱砂=攻方野战，赭褐=守方驻军 */
.force-bar {
  display: flex;
  height: 5px;
  margin-top: 8px;
  border-radius: 3px;
  overflow: hidden;
  background: rgba(138, 109, 75, 0.18);
}

.force-seg {
  transition: width 0.6s cubic-bezier(0.22, 1, 0.36, 1);
}

.seg-atk {
  background: linear-gradient(90deg, var(--cinnabar), #c9664f);
}

.seg-def {
  background: linear-gradient(90deg, #a8895e, var(--brown));
}

.battle-stats {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 7px;
  font-size: 12px;
  color: var(--ink-muted);
}

.stat b {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.loss-atk { color: var(--cinnabar); }
.loss-def { color: var(--brown); }

.trend {
  margin-left: auto;
  font-size: 12px;
  font-weight: 700;
}

.trend-atk { color: var(--cinnabar); }
.trend-def { color: #6d5a37; }
.trend-even { color: var(--ink-muted); }

.battle-end-btn {
  flex: none;
  margin-top: 2px;
}

.inactive {
  color: var(--ink-muted);
  font-size: 12px;
  margin-left: 6px;
}

.empty-hint {
  color: var(--ink-muted);
  font-size: 13px;
  font-family: var(--font-kai);
  text-align: center;
  padding: 20px 0;
}

.disclaimer-content a:hover {
  text-decoration: underline;
}

/* 弹窗内按钮统一为羊皮纸变体 */
.test-panel :deep(.game-btn),
.battle-item :deep(.game-btn) {
  border: 1px solid rgba(138, 109, 75, 0.35);
  background: linear-gradient(to bottom, var(--paper-input), var(--paper-darker));
  color: var(--ink);
  font-family: var(--font-kai);
  letter-spacing: 1px;
  backdrop-filter: none;
  box-shadow: 0 1px 2px rgba(90, 60, 20, 0.06);
}

.test-panel :deep(.game-btn:hover),
.battle-item :deep(.game-btn:hover) {
  background: linear-gradient(to bottom, var(--paper-hi), var(--paper-hi2));
  border-color: rgba(138, 109, 75, 0.55);
  color: var(--ink-strong);
}

.test-panel :deep(.game-btn.active),
.battle-item :deep(.game-btn.active) {
  background: linear-gradient(to bottom, var(--paper-dark), var(--paper-darkest));
  border-color: var(--cinnabar);
  color: var(--cinnabar-ink);
  box-shadow: 0 0 0 1px var(--cinnabar-ring) inset;
}

.test-panel :deep(.game-btn.danger),
.battle-item :deep(.game-btn.danger) {
  border-color: rgba(176, 74, 58, 0.5);
  color: var(--cinnabar);
}

.test-panel :deep(.game-btn.danger:hover),
.battle-item :deep(.game-btn.danger:hover) {
  background: linear-gradient(to bottom, var(--danger-bg), var(--danger-bg2));
  border-color: var(--cinnabar);
  color: var(--danger-ink);
}

/* ─── 战况浮层：锚定守方城的可折叠战斗卡片 ─── */
.battle-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none; /* 空白处不挡地图操作，卡片自身再开启 */
  z-index: 900;
}

/* 云雾蒙太奇期间与 .map-ui 面板一起淡出；卡片显式开过 pointer-events，需单独收掉防误触 */
body.cloud-active .battle-card {
  pointer-events: none;
}

.battle-card {
  position: absolute;
  top: 0;
  left: 0;
  width: 240px;
  pointer-events: auto;
  font-family: var(--font-kai);
  background: linear-gradient(to bottom, var(--paper-panel), var(--paper-darker));
  border: 1px solid rgba(138, 109, 75, 0.42);
  border-top: 2px solid var(--cinnabar);
  border-radius: var(--radius-sm);
  box-shadow: 0 6px 20px rgba(60, 40, 15, 0.28), 0 1px 3px rgba(60, 40, 15, 0.18);
  color: var(--ink);
  cursor: default;
  transition: box-shadow 0.2s ease;
}

.battle-card:hover {
  box-shadow: 0 8px 26px rgba(60, 40, 15, 0.38), 0 1px 3px rgba(60, 40, 15, 0.18);
}

/* 折叠态标题条（整条可点，切换展开） */
.bc-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  cursor: pointer;
  user-select: none;
}

.bc-live {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--cinnabar);
  animation: battle-pulse 1.6s ease-out infinite;
}

.bc-route {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 700;
  color: var(--ink-strong);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bc-turns {
  flex: none;
  font-size: 10px;
  color: var(--ink-muted);
  border: 1px solid rgba(138, 109, 75, 0.4);
  border-radius: 3px;
  padding: 0 4px;
}

.bc-toggle {
  flex: none;
  color: var(--ink-muted);
  transition: color 0.15s ease;
}

.bc-head:hover .bc-toggle {
  color: var(--cinnabar);
}

/* 展开主体 */
.bc-body {
  padding: 2px 9px 8px;
  border-top: 1px dashed rgba(138, 109, 75, 0.3);
}

.bc-vs {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 4px;
  margin-top: 6px;
}

.bc-side {
  font-size: 13px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.bc-atk { color: var(--cinnabar); }
.bc-def { color: #6d5a37; }

.bc-vs-mark {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1px;
  color: var(--ink-muted);
}

.bc-force {
  height: 5px;
  margin-top: 6px;
  border-radius: 3px;
  overflow: hidden;
  background: linear-gradient(90deg, #a8895e, var(--brown));
}

.bc-force-atk {
  height: 100%;
  background: linear-gradient(90deg, var(--cinnabar), #c9664f);
  transition: width 0.6s cubic-bezier(0.22, 1, 0.36, 1);
}

.bc-loss {
  margin-top: 6px;
  font-size: 11px;
  color: var(--ink-muted);
  font-variant-numeric: tabular-nums;
}

.bc-trend {
  margin-left: 6px;
  font-weight: 700;
}

/* AI 战报叙事 */
.bc-report {
  margin-top: 7px;
  padding: 5px 7px;
  font-size: 11.5px;
  line-height: 1.55;
  color: var(--ink-mid);
  background: rgba(176, 74, 58, 0.06);
  border-left: 2px solid rgba(176, 74, 58, 0.5);
  border-radius: 2px;
}

.bc-actions {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}

.bc-btn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 4px 6px;
  font-family: var(--font-kai);
  font-size: 12px;
  letter-spacing: 0.5px;
  color: var(--ink);
  background: linear-gradient(to bottom, var(--paper-input), var(--paper-darker));
  border: 1px solid rgba(138, 109, 75, 0.35);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

.bc-btn:hover {
  background: linear-gradient(to bottom, var(--paper-hi), var(--paper-hi2));
  color: var(--ink-strong);
  border-color: rgba(138, 109, 75, 0.55);
}

.bc-btn-danger:hover {
  background: linear-gradient(to bottom, var(--danger-bg), var(--danger-bg2));
  color: var(--danger-ink);
  border-color: var(--cinnabar);
}

/* 分组卡片内各攻方路线行 */
.bc-route-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 4px 0;
  border-bottom: 1px dashed rgba(138, 109, 75, 0.2);
}

.bc-route-row:last-child {
  border-bottom: none;
}

.bc-route-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-strong);
  white-space: nowrap;
}

.bc-route-vs {
  display: flex;
  align-items: baseline;
  gap: 3px;
  font-size: 11px;
}

/* 守方驻军汇总行 */
.bc-def-total {
  margin-top: 6px;
  padding-top: 5px;
  border-top: 1px solid rgba(138, 109, 75, 0.25);
  font-size: 11px;
  color: var(--ink-muted);
  text-align: center;
}

/* ── 战斗管理弹窗分组样式 ── */
.battle-group {
  margin-bottom: 12px;
  border: 1px solid rgba(138, 109, 75, 0.2);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(138, 109, 75, 0.08);
  border-bottom: 1px solid rgba(138, 109, 75, 0.2);
  font-family: var(--font-song);
}

.group-city {
  font-size: 15px;
  font-weight: 700;
  color: var(--ink-strong);
}

.group-defender {
  font-size: 12px;
  color: var(--ink-muted);
  margin-left: auto;
}

.group-turns {
  font-size: 11px;
  color: var(--ink-muted);
  border: 1px solid rgba(138, 109, 75, 0.3);
  border-radius: 3px;
  padding: 1px 6px;
}

/* 指向守方城的锚点尖角（卡片底部居中） */
.bc-anchor {
  position: absolute;
  left: 50%;
  bottom: -6px;
  width: 10px;
  height: 10px;
  background: var(--paper-darker);
  border-right: 1px solid rgba(138, 109, 75, 0.42);
  border-bottom: 1px solid rgba(138, 109, 75, 0.42);
  transform: translateX(-50%) rotate(45deg);
}

/* ── 撤退裁决弹窗 ── */
.retreat-verdict {
  padding: 20px 20px 16px;
}

.verdict-text {
  color: var(--ink-darkest);
  font-family: var(--font-song);
  font-size: 17px;
  line-height: 1.9;
  letter-spacing: 1px;
  margin: 0 0 16px;
  text-align: justify;
}

.verdict-loss {
  color: var(--cinnabar);
  font-family: var(--font-song);
  font-size: 14px;
  letter-spacing: 2px;
  text-align: right;
  margin-bottom: 16px;
}

.verdict-btn {
  display: block;
  width: 100%;
  padding: 10px 0;
  background: linear-gradient(to bottom, var(--paper-head), var(--paper-head2));
  border: 1px solid var(--brown-line);
  border-radius: var(--radius-xs);
  color: var(--ink-panel);
  font-family: var(--font-song);
  font-size: 15px;
  letter-spacing: 4px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.verdict-btn:hover {
  background: linear-gradient(to bottom, var(--paper-darker), var(--paper-deep));
  color: var(--ink-darkest);
  border-color: var(--brown-deep);
}

/* ── 求和谈判弹窗 ── */
.peace-dlg {
  padding: 18px 20px 16px;
}

.peace-round {
  font-size: 12px;
  color: var(--ink-muted);
  letter-spacing: 1px;
  text-align: center;
  margin-bottom: 14px;
  font-variant-numeric: tabular-nums;
}

.peace-text {
  color: var(--ink-darkest);
  font-family: var(--font-song);
  font-size: 16px;
  line-height: 1.9;
  letter-spacing: 1px;
  margin: 0 0 14px;
  text-align: justify;
}

.peace-indemnity {
  font-family: var(--font-song);
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 2px;
  text-align: center;
  padding: 8px 0;
  margin-bottom: 10px;
  border-top: 1px dashed rgba(138, 109, 75, 0.35);
  border-bottom: 1px dashed rgba(138, 109, 75, 0.35);
}

.peace-pay { color: var(--cinnabar); }
.peace-gain { color: #5a7a3a; }

.peace-final-hint {
  font-size: 12px;
  color: var(--cinnabar);
  text-align: center;
  letter-spacing: 1px;
  margin-bottom: 12px;
}

.peace-counter {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
}

.peace-input {
  flex: 1;
  min-width: 0;
  padding: 7px 10px;
  border: 1px solid rgba(138, 109, 75, 0.4);
  border-radius: var(--radius-sm);
  background: var(--paper-input);
  color: var(--ink-strong);
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}

.peace-input::placeholder {
  color: var(--ink-muted);
  font-size: 13px;
}

.peace-actions {
  display: flex;
  gap: 10px;
}

.peace-actions .game-btn {
  flex: 1;
}

.peace-thinking {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 22px 0;
}

.peace-thinking-text {
  margin-left: 8px;
  color: var(--ink-soft);
  font-size: 14px;
  letter-spacing: 1px;
}

.peace-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--cinnabar);
  animation: peace-blink 1.2s ease-in-out infinite;
}

.peace-dot:nth-child(2) { animation-delay: 0.2s; }
.peace-dot:nth-child(3) { animation-delay: 0.4s; }

@keyframes peace-blink {
  0%, 80%, 100% { opacity: 0.25; transform: scale(0.8); }
  40% { opacity: 1; transform: scale(1); }
}
</style>
