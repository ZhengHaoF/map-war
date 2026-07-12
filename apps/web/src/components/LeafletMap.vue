<template>
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
      <GameButton :active="baseMapVisible" @click="toggleBaseMap">
        <component :is="ICONS['world']" :size="16" />
        世界背景
      </GameButton>
      <div class="switcher-divider"></div>
      <GameButton @click="testPanelVisible = !testPanelVisible">
        <component :is="ICONS['bug']" :size="16" />
        调试
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
              executeOrder({ order: 'attack', from: '156500000', to: '156450200', text: '出兵！' })
          "
          ><component :is="ICONS['sword']" :size="16" />派兵测试</GameButton
        >
        <GameButton
          @click="() => executeOrder({ order: 'scout', from: '156500000', text: '侦察！' })"
          ><component :is="ICONS['eye']" :size="16" />探察测试</GameButton
        >
        <GameButton
          @click="
            () =>
              executeOrder({
                order: 'declareWar',
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
        <GameButton danger @click="() => executeOrder({ order: 'stopBattles' })"
          ><component :is="ICONS['circle-x']" :size="16" />结束战斗</GameButton
        >
        <GameButton @click="aiPanelVisible = true"
          ><component :is="ICONS.brain" :size="16" />AI 调试</GameButton
        >
        <GameButton @click="playCloudTest"
          ><component :is="ICONS.cloud" :size="16" />云雾切换测试</GameButton
        >
        <GameButton @click="captureTest"
          ><component :is="ICONS['tag']" :size="16" />占领测试</GameButton
        >
        <GameButton @click="saveTest"
          ><component :is="ICONS['player-stop']" :size="16" />存档测试</GameButton
        >
        <GameButton @click="loadTest"
          ><component :is="ICONS['stack-2']" :size="16" />读档测试</GameButton
        >
        <GameButton @click="eventLogPanelVisible = true"
          ><component :is="ICONS['clipboard-text']" :size="16" />事件日志</GameButton
        >
      </div>
    </GameModal>
    <GameModal class="map-ui"
      :visible="aiPanelVisible"
      title="AI 调试"
      :z-index="4100"
      width="600px"
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
    <GameModal class="map-ui"
      :visible="battleListVisible"
      title="战斗管理"
      :z-index="3500"
      variant="parchment"
      @close="battleListVisible = false"
    >
      <div v-if="battleList.length === 0" class="empty-hint">当前没有进行中的战斗</div>
      <div v-for="b in battleList" :key="b.id" class="battle-item">
        <span class="battle-info">
          {{ b.fromName }} → {{ b.toName }}
          <span v-if="!b.active" class="inactive">(已停止)</span>
        </span>
        <GameButton danger size="small" @click="endBattle(b.id)">
          <component :is="ICONS['x']" :size="14" />
          结束
        </GameButton>
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
    <LegendPanel v-if="ownerColorEnabled" class="map-ui" :items="legendItems" />
    <div class="disclaimer-bar map-ui" @click="disclaimerVisible = true">
      ⚠
      免责声明：本地图数据来源于网络公开数据源，仅供娱乐参考。游戏中的政权划分、边界线等均为虚构设定，不代表任何个人或组织的政治立场，亦不代表对现实世界领土归属的任何主张，不对应、不代表当下世界各国法定领土国界。本人始终坚持遵循以中华人民共和国自然资源部（原国家测绘地理信息局）发布的标准地图。
      点击查看详情
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js'
import { OWNER_COLORS, OWNER_LABELS, Owner } from '@/data/owners'
import type { CityData } from '@/data/chinaCities'
import type { CountryData } from '@/data/worldCountries'
import { worldCountries, GEO_TO_GAME_ISO } from '@/data/worldCountries'
import { init as initGameOrders, executeOrder, stopBattle, capture, restoreActiveAnimations } from '@/utils/gameOrders'
import type { GameOrder } from '@/utils/gameOrders'
import { useGameStore } from '@/stores/game'
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
import InfoTable from '@/components/ui/InfoTable.vue'
import LegendPanel from '@/components/ui/LegendPanel.vue'
import type { Component } from 'vue'
import IconStack2 from '~icons/tabler/stack-2'
import IconFlag from '~icons/tabler/flag'
import IconTag from '~icons/tabler/tag'
import IconWorld from '~icons/tabler/world'
import IconBug from '~icons/tabler/bug'
import IconSword from '~icons/tabler/sword'
import IconEye from '~icons/tabler/eye'
import IconCrosshair from '~icons/tabler/crosshair'
import IconPlayerStop from '~icons/tabler/player-stop'
import IconList from '~icons/tabler/list'
import IconCircleX from '~icons/tabler/circle-x'
import IconX from '~icons/tabler/x'
import IconBrain from '~icons/tabler/brain'
import IconCloud from '~icons/tabler/cloud'
import IconClipboardText from '~icons/tabler/clipboard-text'
import AiDebugPanel from '@/components/AiDebugPanel.vue'
import EventLogPanel from '@/components/EventLogPanel.vue'
import GameDateDisplay from '@/components/ui/GameDateDisplay.vue'
import { playCloudTransition, disposeCloudTransition } from '@/utils/cloudTransition'

const ICONS: Record<string, Component> = {
  'stack-2': IconStack2,
  flag: IconFlag,
  tag: IconTag,
  world: IconWorld,
  bug: IconBug,
  sword: IconSword,
  eye: IconEye,
  crosshair: IconCrosshair,
  'player-stop': IconPlayerStop,
  list: IconList,
  'circle-x': IconCircleX,
  x: IconX,
  brain: IconBrain,
  cloud: IconCloud,
  'clipboard-text': IconClipboardText,
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
type DiplomacyKey = keyof typeof DIPLOMACY_COLORS
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

const DIPLOMACY_COLORS: Record<string, number> = {
  HOSTILE: 0x6b2020,
  WAR: 0x4b0000,
  NEUTRAL: 0x2d3a2e,
  FRIENDLY: 0x2a3a5e,
  ALLIED: 0x1a3a7e,
}

const DIPLOMACY_BORDER_COLORS: Record<string, number> = {
  HOSTILE: 0x8b3030,
  WAR: 0x6b1010,
  NEUTRAL: 0x3d4a3e,
  FRIENDLY: 0x3a5a7e,
  ALLIED: 0x2a5a9e,
}

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

const LAYERS: LayerConfig[] = [
  { file: '/中国_省.geojson', label: '省级', color: 0x555555, fillColor: 0xdddddd },
  { file: '/中国_市.geojson', label: '市级', color: 0x444444, fillColor: 0xcccccc },
]

// ─── 响应式状态 ───

const mapContainer = ref<HTMLElement | null>(null)
const currentLayerIndex = ref(1)
const contextMenuVisible = ref(false)
const contextMenuPos = ref<Point>({ x: 0, y: 0 })
const infoModalVisible = ref(false)
const infoCityData = ref<CityData | null>(null)
const infoCountryData = ref<CountryData | Record<string, unknown> | null>(null)
const testPanelVisible = ref(false)
const aiPanelVisible = ref(false)
const battleListVisible = ref(false)
const eventLogPanelVisible = ref(false)
const battleList = computed(() => useGameStore().battles)
const disclaimerVisible = ref(false)
const ownerColorEnabled = ref(true)
const labelsVisible = ref(false)
const baseMapVisible = ref(true)

// ─── PixiJS 实例 ───

let app: Application
let worldContainer: Container
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

// ─── 地图状态 ───

let mapScale = 1
let mapX = 0
let mapY = 0
let isDragging = false
let lastPointer: Point = { x: 0, y: 0 }
let pointerDownPos: Point = { x: 0, y: 0 }

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
    { label: '工业能力', value: `${d.industry ?? '—'} / 10` },
    { label: '粮食生产', value: `${d.food ?? '—'} / 10` },
    { label: '工事等级', value: `${d.fort ?? '—'} / 5` },
    { label: '驻军', value: `${d.troops ?? 0} k` },
    { label: '士气', value: `${d.morale ?? 0} / 100` },
  ]
})

const countryInfoRows = computed(() => {
  if (!infoCountryData.value) return []
  const d = infoCountryData.value
  const dc = d as CountryData
  return [
    { label: '国名', value: `${dc.name || '—'}（${dc.iso_a3 || dc.id || '—'}）` },
    { label: '全称', value: dc.full_name || '—' },
    {
      label: '国家类型',
      value: COUNTRY_TYPE_NAMES[dc.countryType as CountryTypeKey] || dc.countryType || '—',
    },
    { label: '军事实力', value: `${dc.military ?? '—'} / 10` },
    { label: '工业能力', value: `${dc.industry ?? '—'} / 10` },
    { label: '人口/资源', value: `${dc.population ?? '—'} / 10` },
    { label: '对华威胁', value: `${dc.threat ?? '—'} / 10` },
    {
      label: '外交关系',
      value: DIPLOMACY_NAMES[dc.diplomacy as DiplomacyKey] || dc.diplomacy || '—',
    },
  ]
})

const infoTitle = computed(() => {
  if (infoCityData.value) return infoCityData.value.name
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

function drawFeature(
  graphics: Graphics,
  feature: GeoJSON.Feature,
  width: number,
  height: number,
  style: LayerStyle,
): void {
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
      graphics.moveTo(first.x, first.y)
      for (let i = 1; i < ring.length; i++) {
        const p = geoToScreen(ring[i][0], ring[i][1], width, height)
        graphics.lineTo(p.x, p.y)
      }
      graphics.closePath()
    }
    graphics.fill({ color: style.fillColor, alpha: 0.5 })
    graphics.stroke({ width: 0.5, color: style.color, alpha: 1 })
  }
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
    const isoA3 = feature.properties?.iso_a3 as string | undefined
    const countryData = isoA3 ? worldDataMap.get(isoA3) : undefined
    const diplomacy = (countryData?.diplomacy || 'NEUTRAL') as DiplomacyKey
    const fillColor = DIPLOMACY_COLORS[diplomacy] || DIPLOMACY_COLORS.NEUTRAL
    const borderColor = DIPLOMACY_BORDER_COLORS[diplomacy] || DIPLOMACY_BORDER_COLORS.NEUTRAL
    drawFeature(gfx, feature, width, height, {
      color: borderColor,
      fillColor,
    })
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
    contextMenuItems.value = [
      { action: 'info', label: '查看信息', icon: 'info-circle' },
      { action: 'investigate', label: '调查', icon: 'search' },
      { action: 'declare-war', label: '宣战', icon: 'flag' },
      { action: 'surprise-attack', label: '奇袭', danger: true, icon: 'bolt' },
    ]
  } else {
    selectedWorldFeature = result.feature
    highlightBaseFeature(result.feature)
    contextMenuItems.value = [{ action: 'info', label: '查看信息', icon: 'info-circle' }]
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

function onMenuAction(action: string): void {
  if (action === 'info') {
    if (selectedFeature) {
      const gb = selectedFeature.properties?.gb as string | undefined
      infoCityData.value = gb ? (useGameStore().cities[gb] ?? null) : null
      infoCountryData.value = null
      infoModalVisible.value = true
    } else if (selectedWorldFeature) {
      const isoA3 = selectedWorldFeature.properties?.iso_a3 as string | undefined
      infoCountryData.value = isoA3
        ? worldDataMap.get(isoA3) || selectedWorldFeature.properties
        : selectedWorldFeature.properties
      infoCityData.value = null
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
  await capture('156610300', Owner.SCC)
}

/** 调试：存档测试——当前世界态序列化到 test 槽 */
function saveTest(): void {
  const ok = useGameStore().save('test', { label: `调试存档 ${useGameStore().currentDate}` })
  if (ok) {
    const m = useGameStore().listSaves()['test']
    // eslint-disable-next-line no-console
    console.log(`[saveTest] 已存档 → slot=test, 事件数=${m?.eventCount}, 日期=${m?.currentDate}`)
  }
}

/** 调试：读档测试——从 test 槽恢复世界态 */
async function loadTest(): Promise<void> {
  const ok = useGameStore().load('test')
  // eslint-disable-next-line no-console
  console.log('[loadTest] load 返回, ok=', ok, 'battles=', useGameStore().battles.length)
  if (!ok) return
  // watcher 在 isReplaying 期间被跳过，手动重绘地图
  await loadLayer(currentLayerIndex.value)
  restoreActiveAnimations()
  useGameStore().isReplaying = false // 动画恢复完成后才解锁 watcher
  // eslint-disable-next-line no-console
  console.log(`[loadTest] 已读档 → slot=test, 日期=${useGameStore().currentDate}`)
}

function endBattle(id: string): void {
  stopBattle(id)
}

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
  if (fFrom) highlightFeature(fFrom, 0x3b82f6)
}

// ─── 标签图层 ───

function getLabelStyle(layerIndex: number): TextStyle {
  const sizes = [16, 13, 11]
  return new TextStyle({
    fontSize: sizes[layerIndex],
    fill: 0xffffff,
    fontFamily: 'Arial, sans-serif',
    fontWeight: 'bold',
    stroke: {
      color: 0x000000,
      width: 2,
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
    const name = feature.properties?.name as string | undefined
    if (!name) continue

    const centroid = calculateCentroid(feature.geometry)
    if (!centroid) continue

    const screenPos = geoToScreen(centroid.lng, centroid.lat, width, height)
    const text = new Text({
      text: name,
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

  const graphics = new Graphics()
  if (currentData) {
    for (const feature of currentData.features) {
      let fillColor = config.fillColor
      if (ownerColorEnabled.value && index === 1 && feature.properties?.gb) {
        const gb = feature.properties.gb as string
        const owner = useGameStore().ownership[gb]
        if (owner) {
          fillColor = (OWNER_COLORS as Record<string, number>)[owner] ?? config.fillColor
        }
      }
      drawFeature(graphics, feature, width, height, { color: config.color, fillColor })
    }
  }
  worldContainer.addChild(graphics)
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

interface CameraTarget {
  scale: number
  x: number
  y: number
}

/** 将当前相机状态应用到所有容器（抽出给镜头补间复用，替代各 handler 里的重复 transform） */
function applyCamera(): void {
  worldContainer.scale.set(mapScale)
  worldContainer.position.set(mapX, mapY)
  baseContainer.scale.set(mapScale)
  baseContainer.position.set(mapX, mapY)
  updateLabels()
}

/** 将相机平滑补间到目标 {scale, x, y} */
function animateCameraTo(target: CameraTarget, duration: number): Promise<void> {
  return new Promise((resolve) => {
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
  /** 取消进行中的镜头补间并解锁（ESC / 快进跳过） */
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
  const newScale = Math.max(0.5, Math.min(8, mapScale * delta))

  const scaleRatio = newScale / mapScale
  mapX = mouseX - (mouseX - mapX) * scaleRatio
  mapY = mouseY - (mouseY - mapY) * scaleRatio
  mapScale = newScale

  applyCamera()
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

function onResize(): void {
  requestAnimationFrame(() => {
    const width = app.screen.width
    const height = app.screen.height
    setScreenSize(width, height)

    const center = geoToScreen(104, 36, width, height)
    mapX = width / 2 - center.x
    mapY = height / 2 - center.y
    applyCamera()

    loadLayer(currentLayerIndex.value)
    if (baseMapVisible.value) {
      renderBaseMap()
    }
  })
}

// ─── 生命周期 ───

onMounted(async () => {
  app = new Application()
  await app.init({
    resizeTo: mapContainer.value!,
    backgroundColor: 0x1a1a2e,
    antialias: true,
  })
  mapContainer.value!.appendChild(app.canvas)

  baseContainer = new Container()
  worldContainer = new Container()
  labelContainer = new Container()
  selectionHighlightGfx = new Graphics()
  baseHighlightGraphics = new Graphics()
  app.stage.addChild(baseContainer)
  app.stage.addChild(worldContainer)
  app.stage.addChild(labelContainer)
  worldContainer.addChild(selectionHighlightGfx)

  const width = app.screen.width
  const height = app.screen.height
  setScreenSize(width, height)
  initGameOrders(worldContainer, cameraController, app)
  const center = geoToScreen(104, 36, width, height)
  mapX = width / 2 - center.x
  mapY = height / 2 - center.y
  worldContainer.position.set(mapX, mapY)
  baseContainer.position.set(mapX, mapY)

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

  useGameStore().initWorld()
  console.log('城市态加载完成:', Object.keys(useGameStore().cities).length, '个市')

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

  const cityJson = geoJsonCache.get(LAYERS[1].file)
  if (cityJson) registerLocations(cityJson.features, 'gb')

  // 归属变化时实时重绘当前图层，确保占领/易主后政权着色立即更新
  // 读档期间跳过（isReplaying），由 loadTest 手动调 loadLayer
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
  app?.destroy(true)
})
</script>

<style scoped>
.map-container {
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}

.test-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
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
  border-radius: 3px;
  background: linear-gradient(to bottom, var(--paper-input), var(--paper-darker));
  color: var(--ink);
  font-family: var(--font-kai);
  letter-spacing: 1px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 1px 2px rgba(90, 60, 20, 0.06);
}

.layer-switcher button:hover {
  background: linear-gradient(to bottom, var(--paper-hi), var(--paper-hi2));
  border-color: rgba(138, 109, 75, 0.55);
  color: var(--ink-strong);
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

.battle-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 14px;
  margin-bottom: 8px;
  background: var(--paper-panel);
  border: 1px solid rgba(138, 109, 75, 0.35);
  border-radius: 3px;
  color: var(--ink);
  font-size: 14px;
  font-family: var(--font-kai);
  box-shadow: 0 1px 3px rgba(90, 60, 20, 0.06);
}

.battle-item:last-child {
  margin-bottom: 0;
}

.battle-info {
  flex: 1;
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
</style>
