<template>
  <div ref="mapContainer" class="map-container" @click.self="closeContextMenu">
    <div class="layer-switcher">
      <GameButton v-for="(layer, index) in LAYERS" :key="layer.file" :active="currentLayerIndex === index"
        @click="switchLayer(index)">
        {{ layer.label }}
      </GameButton>
      <div class="switcher-divider"></div>
      <GameButton :active="ownerColorEnabled" @click="toggleOwnerColor">
        政权着色
      </GameButton>
      <GameButton :active="labelsVisible" @click="toggleLabels">
        显示地名
      </GameButton>
      <GameButton :active="baseMapVisible" @click="toggleBaseMap">
        世界背景
      </GameButton>
      <div class="switcher-divider"></div>
      <GameButton @click="testPanelVisible = !testPanelVisible">
        调试
      </GameButton>
    </div>
    <LegendPanel v-if="ownerColorEnabled" :items="legendItems" />
    <GameContextMenu :visible="contextMenuVisible" :position="contextMenuPos" :items="contextMenuItems"
      @select="onMenuAction" />
    <GameModal :visible="infoModalVisible" :title="infoTitle" @close="infoModalVisible = false">
      <InfoTable v-if="infoCityData" :rows="infoRows" />
      <InfoTable v-else-if="infoCountryData" :rows="countryInfoRows" />
    </GameModal>
    <GameModal :visible="testPanelVisible" title="调试" :draggable="true" :overlay="false" :init-x="160" :init-y="160"
      @close="testPanelVisible = false">
      <div class="test-panel">
        <GameButton @click="() => executeOrder({order:'attack', from:'156500000', to:'156450200', text:'出兵！'})">派兵测试</GameButton>
        <GameButton @click="() => executeOrder({order:'scout', from:'156500000', text:'侦察！'})">探察测试</GameButton>
        <GameButton @click="() => executeOrder({order:'declareWar', from:'156500000', to:'156450200', text:'宣战！'})">宣战测试</GameButton>
        <GameButton @click="() => executeOrder({order:'battle', from:'156500000', to:'156450200'})">战斗测试1</GameButton>
        <GameButton @click="() => executeOrder({order:'battle', from:'156500000', to:'156451000'})">战斗测试2</GameButton>
        <GameButton danger @click="() => executeOrder({order:'stopBattles'})">停止战斗</GameButton>
        <GameButton @click="() => { const list = listBattles(); console.log('当前战斗:', JSON.stringify(list, null, 2)) }">查看战斗</GameButton>
        <GameButton danger @click="openBattleList">结束战斗</GameButton>
      </div>
    </GameModal>
    <GameModal :visible="battleListVisible" title="战斗管理" @close="battleListVisible = false">
      <div v-if="battleList.length === 0" class="empty-hint">当前没有进行中的战斗</div>
      <div v-for="b in battleList" :key="b.id" class="battle-item">
        <span class="battle-info">
          {{ b.fromName }} → {{ b.toName }}
          <span v-if="!b.active" class="inactive">(已停止)</span>
        </span>
        <GameButton danger size="small" @click="endBattle(b.id)">结束</GameButton>
      </div>
    </GameModal>
    <GameModal :visible="disclaimerVisible" title="免责声明" @close="disclaimerVisible = false">
      <div class="disclaimer-content">
        <p>本游戏地图数据来源于网络公开数据源，仅用于游戏娱乐目的，可能存在边界线、地名标注等方面的偏差或不准确之处。</p>
        <p>其中国家边界线划分来自于ECharts网站中的数据，中国地图市划分来自于天地图数据</p>
        <p>游戏中的政权划分、势力范围、外交关系等均为虚构游戏设定，不代表任何个人或组织的政治立场，亦不代表对现实世界领土归属的任何主张。地图边界不对应、不代表当下世界各国法定领土国界。</p>
        <p>本人始终坚持遵循以中华人民共和国自然资源部（原国家测绘地理信息局）发布的标准地图。</p>
        <p class="disclaimer-sources">数据来源：</p>
        <ul>
          <li>Natural Earth — <a href="https://www.naturalearthdata.com/" target="_blank"
              rel="noopener">https://www.naturalearthdata.com/</a></li>
          <li>Apache ECharts — <a href="https://echarts.apache.org/" target="_blank"
              rel="noopener">https://echarts.apache.org/</a></li>
          <li>天地图 — <a href="https://cloudcenter.tianditu.gov.cn/" target="_blank"
              rel="noopener">https://cloudcenter.tianditu.gov.cn/</a></li>
        </ul>
      </div>
    </GameModal>
    <div class="disclaimer-bar" @click="disclaimerVisible = true">
      ⚠
      免责声明：本地图数据来源于网络公开数据源，仅供娱乐参考。游戏中的政权划分、边界线等均为虚构设定，不代表任何个人或组织的政治立场，亦不代表对现实世界领土归属的任何主张，不对应、不代表当下世界各国法定领土国界。本人始终坚持遵循以中华人民共和国自然资源部（原国家测绘地理信息局）发布的标准地图。
      点击查看详情
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js'
import { OWNER_COLORS, OWNER_LABELS } from '@/data/ownerColors'
import { chinaCities } from '@/data/chinaCities'
import { worldCountries, GEO_TO_GAME_ISO } from '@/data/worldCountries'
import { playArcAnimation, playScoutAnimation, startBattleAnimation } from '@/utils/troopAnimation'
import { init as initGameOrders, executeOrder, listBattles, stopBattle } from '@/utils/gameOrders'
import {
  GEO_BOUNDS,
  geoToScreen,
  calculateCentroid,
  setScreenSize,
  registerLocations,
  registerAlias,
} from '@/utils/locationResolver'
import GameButton from '@/components/ui/GameButton.vue'
import GameContextMenu from '@/components/ui/GameContextMenu.vue'
import GameModal from '@/components/ui/GameModal.vue'
import InfoTable from '@/components/ui/InfoTable.vue'
import LegendPanel from '@/components/ui/LegendPanel.vue'

const mapContainer = ref()
let app
let worldContainer
let labelContainer
let selectionHighlightGfx
let currentLayerIndex = ref(1)
let currentData = null
let selectedFeature = null
const contextMenuVisible = ref(false)
const contextMenuPos = ref({ x: 0, y: 0 })

const LAYERS = [
  { file: '/中国_省.geojson', label: '省级', color: 0x555555, fillColor: 0xdddddd },
  { file: '/中国_市.geojson', label: '市级', color: 0x444444, fillColor: 0xcccccc },
]

const geoJsonCache = new Map()
let cityList = []
let cityDataMap = new Map()
let isDragging = false

const OWNER_NAMES = {
  KMT: '国民政府', CCP: '中共苏区', JPN: '日本关东军', NEA: '东北军',
  SHX: '晋系', GXC: '桂系', SCC: '川军', MA: '马家军', XJ: '新疆', TIB: '西藏',
}
const TERRAIN_NAMES = {
  PLAIN: '平原', HILL: '丘陵', MOUNTAIN: '山地', FOREST: '森林', CITY: '城市',
}
const LEVEL_NAMES = ['', '县城/小城', '普通城市', '区域中心', '全国重要城市', '超级城市']

const infoModalVisible = ref(false)
const infoCityData = ref(null)
const infoCountryData = ref(null)
const testPanelVisible = ref(false)
const battleListVisible = ref(false)
const battleList = ref([])
const disclaimerVisible = ref(false)
const ownerColorEnabled = ref(true)
const labelsVisible = ref(false)
const baseMapVisible = ref(true)

// 世界地图
let worldData = null
let worldDataMap = new Map()
let baseContainer
let baseHighlightGraphics
let selectedWorldFeature = null

const DIPLOMACY_COLORS = {
  HOSTILE: 0x6b2020,
  WAR: 0x4b0000,
  NEUTRAL: 0x2d3a2e,
  FRIENDLY: 0x2a3a5e,
  ALLIED: 0x1a3a7e,
}
const DIPLOMACY_BORDER_COLORS = {
  HOSTILE: 0x8b3030,
  WAR: 0x6b1010,
  NEUTRAL: 0x3d4a3e,
  FRIENDLY: 0x3a5a7e,
  ALLIED: 0x2a5a9e,
}
const COUNTRY_TYPE_NAMES = {
  EMPIRE: '帝国', REPUBLIC: '共和国', UNION: '联盟',
  COLONY: '殖民地', KINGDOM: '王国', SPLIT: '分裂',
}
const DIPLOMACY_NAMES = {
  ALLIED: '同盟', FRIENDLY: '友好', NEUTRAL: '中立',
  HOSTILE: '敌对', WAR: '交战中',
}

const legendItems = computed(() =>
  Object.entries(OWNER_LABELS).map(([key, label]) => ({
    label,
    color: '#' + OWNER_COLORS[key].toString(16).padStart(6, '0'),
  }))
)

const contextMenuItems = ref([
  { action: 'info', label: '查看信息' },
  { action: 'investigate', label: '调查' },
  { action: 'declare-war', label: '宣战' },
  { action: 'surprise-attack', label: '奇袭', danger: true },
])

const infoRows = computed(() => {
  if (!infoCityData.value) return []
  const d = infoCityData.value
  return [
    { label: '政权', value: OWNER_NAMES[d.owner] || d.owner },
    { label: '地形', value: TERRAIN_NAMES[d.terrain] || d.terrain },
    { label: '城市规模', value: `${d.cityLevel}（${LEVEL_NAMES[d.cityLevel]}）` },
    { label: '工业能力', value: `${d.industry} / 10` },
    { label: '粮食生产', value: `${d.food} / 10` },
    { label: '工事等级', value: `${d.fort} / 5` },
  ]
})

const countryInfoRows = computed(() => {
  if (!infoCountryData.value) return []
  const d = infoCountryData.value
  return [
    { label: '国名', value: `${d.name}（${d.iso_a3 || d.id || '—'}）` },
    { label: '全称', value: d.full_name || '—' },
    { label: '国家类型', value: COUNTRY_TYPE_NAMES[d.countryType] || d.countryType || '—' },
    { label: '军事实力', value: `${d.military ?? '—'} / 10` },
    { label: '工业能力', value: `${d.industry ?? '—'} / 10` },
    { label: '人口/资源', value: `${d.population ?? '—'} / 10` },
    { label: '对华威胁', value: `${d.threat ?? '—'} / 10` },
    { label: '外交关系', value: DIPLOMACY_NAMES[d.diplomacy] || d.diplomacy || '—' },
  ]
})

const infoTitle = computed(() => {
  if (infoCityData.value) return infoCityData.value.name
  if (infoCountryData.value) {
    const d = infoCountryData.value
    return `${d.name}（${d.iso_a3 || d.id || ''}）`
  }
  return ''
})

let lastPointer = { x: 0, y: 0 }
let pointerDownPos = { x: 0, y: 0 }

// 地图状态
let mapScale = 1
let mapX = 0
let mapY = 0

function screenToGeo(screenX, screenY, width, height) {
  const lngRange = GEO_BOUNDS.maxLng - GEO_BOUNDS.minLng
  const latRange = GEO_BOUNDS.maxLat - GEO_BOUNDS.minLat
  const scale = Math.min(width / lngRange, height / latRange)
  const lng = screenX / scale + GEO_BOUNDS.minLng
  const lat = GEO_BOUNDS.maxLat - screenY / scale
  return { lng, lat }
}

function pointInPolygon(lng, lat, coordinates) {
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

function hitTest(screenX, screenY, data, width, height) {
  // 屏幕坐标 → 世界坐标（考虑地图偏移和缩放）
  const worldX = (screenX - mapX) / mapScale
  const worldY = (screenY - mapY) / mapScale

  // 世界坐标 → 经纬度
  const geo = screenToGeo(worldX, worldY, width, height)

  for (const feature of data.features) {
    const { geometry } = feature
    let hit = false

    if (geometry.type === 'Polygon') {
      hit = pointInPolygon(geo.lng, geo.lat, geometry.coordinates[0])
    } else if (geometry.type === 'MultiPolygon') {
      for (const polygon of geometry.coordinates) {
        if (pointInPolygon(geo.lng, geo.lat, polygon[0])) {
          hit = true
          break
        }
      }
    }

    if (hit) return feature
  }
  return null
}

function drawFeature(graphics, feature, width, height, style, scale) {
  const { geometry } = feature
  const polygons =
    geometry.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry.type === 'MultiPolygon'
        ? geometry.coordinates
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

function highlightFeature(feature, color = 0xff4444) {
  highlightOn(selectionHighlightGfx, feature, color)
}

function highlightOn(gfx, feature, color = 0xff4444) {
  const width = app.screen.width
  const height = app.screen.height
  const { geometry } = feature
  const polygons =
    geometry.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry.type === 'MultiPolygon'
        ? geometry.coordinates
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

function highlightBaseFeature(feature, color = 0xff4444) {
  const width = app.screen.width
  const height = app.screen.height
  const { geometry } = feature
  const polygons =
    geometry.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry.type === 'MultiPolygon'
        ? geometry.coordinates
        : []

  for (const polygon of polygons) {
    for (const ring of polygon) {
      if (ring.length < 3) continue
      const first = geoToScreen(ring[0][0], ring[0][1], width, height)
      baseHighlightGraphics.moveTo(first.x, first.y)
      for (let i = 1; i < ring.length; i++) {
        const p = geoToScreen(ring[i][0], ring[i][1], width, height)
        baseHighlightGraphics.lineTo(p.x, p.y)
      }
      baseHighlightGraphics.closePath()
    }
    baseHighlightGraphics.fill({ color, alpha: 0.4 })
    baseHighlightGraphics.stroke({ width: 0.5, color, alpha: 1 })
  }
}

function hitTestAll(screenX, screenY) {
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

function clearAllHighlights() {
  selectionHighlightGfx.clear()
  baseHighlightGraphics.clear()
  selectedFeature = null
  selectedWorldFeature = null
}

async function renderBaseMap() {
  const width = app.screen.width
  const height = app.screen.height

  baseContainer.removeChildren()

  const gfx = new Graphics()
  for (const feature of worldData.features) {
    const countryData = worldDataMap.get(feature.properties?.iso_a3)
    const diplomacy = countryData?.diplomacy || 'NEUTRAL'
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

function toggleBaseMap() {
  baseMapVisible.value = !baseMapVisible.value
  baseContainer.visible = baseMapVisible.value
}

function onContextMenu(e) {
  e.preventDefault()

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
      { action: 'info', label: '查看信息' },
      { action: 'investigate', label: '调查' },
      { action: 'declare-war', label: '宣战' },
      { action: 'surprise-attack', label: '奇袭', danger: true },
    ]
  } else {
    selectedWorldFeature = result.feature
    highlightBaseFeature(result.feature)
    contextMenuItems.value = [
      { action: 'info', label: '查看信息' },
    ]
  }

  contextMenuPos.value = { x: screenX, y: screenY }
  contextMenuVisible.value = true
}

function closeContextMenu() {
  contextMenuVisible.value = false
}

function onMenuAction(action) {
  if (action === 'info') {
    if (selectedFeature) {
      const gb = selectedFeature.properties.gb
      infoCityData.value = cityDataMap.get(gb) || null
      infoCountryData.value = null
      infoModalVisible.value = true
    } else if (selectedWorldFeature) {
      const iso_a3 = selectedWorldFeature.properties.iso_a3
      infoCountryData.value = worldDataMap.get(iso_a3) || selectedWorldFeature.properties
      infoCityData.value = null
      infoModalVisible.value = true
    }
  } else {
    console.log('菜单操作:', action, selectedFeature?.properties || selectedWorldFeature?.properties)
  }
  closeContextMenu()
}

function openBattleList() {
  battleList.value = listBattles()
  battleListVisible.value = true
}

function endBattle(id) {
  stopBattle(id)
  battleList.value = listBattles()
}

function onGlobalMouseDown(e) {
  if (!contextMenuVisible.value) return
  const menu = document.querySelector('.context-menu')
  if (menu && menu.contains(e.target)) return
  closeContextMenu()
}

function onKeyDown(e) {
  if (e.key === 'Escape') {
    if (infoModalVisible.value) {
      infoModalVisible.value = false
    } else {
      closeContextMenu()
    }
  }
}

function getLabelStyle(layerIndex) {
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
    resolution: 2,
  })
}

function renderLabels(data, width, height, layerIndex) {
  labelContainer.removeChildren()
  const style = getLabelStyle(layerIndex)

  for (const feature of data.features) {
    const name = feature.properties?.name
    if (!name) continue

    const centroid = calculateCentroid(feature.geometry)
    if (!centroid) continue

    const screenPos = geoToScreen(centroid.lng, centroid.lat, width, height)
    const text = new Text({
      text: name,
      style,
      resolution: 2,
    })
    text.anchor.set(0.5)
    text._geoX = screenPos.x
    text._geoY = screenPos.y
    text.x = screenPos.x
    text.y = screenPos.y
    labelContainer.addChild(text)
  }
}

function updateLabels() {
  if (!labelContainer) return
  for (const child of labelContainer.children) {
    child.x = child._geoX * mapScale + mapX
    child.y = child._geoY * mapScale + mapY
  }
}

async function switchLayer(index) {
  if (currentLayerIndex.value === index) return
  currentLayerIndex.value = index
  await loadLayer(index)
}

async function toggleOwnerColor() {
  ownerColorEnabled.value = !ownerColorEnabled.value
  await loadLayer(currentLayerIndex.value)
}

function toggleLabels() {
  labelsVisible.value = !labelsVisible.value
  labelContainer.visible = labelsVisible.value
}

async function loadLayer(index) {
  const config = LAYERS[index]
  if (!geoJsonCache.has(config.file)) {
    const res = await fetch(config.file)
    geoJsonCache.set(config.file, await res.json())
  }

  currentData = geoJsonCache.get(config.file)
  const width = app.screen.width
  const height = app.screen.height

  worldContainer.removeChildren()
  labelContainer.removeChildren()

  const graphics = new Graphics()
  for (const feature of currentData.features) {
    let fillColor = config.fillColor
    if (ownerColorEnabled.value && index === 1 && feature.properties?.gb) {
      const cityData = cityDataMap.get(feature.properties.gb)
      if (cityData?.owner) {
        fillColor = OWNER_COLORS[cityData.owner] ?? config.fillColor
      }
    }
    drawFeature(
      graphics,
      feature,
      width,
      height,
      {
        color: config.color,
        fillColor,
      },
      mapScale,
    )
  }
  worldContainer.addChild(graphics)
  worldContainer.addChild(selectionHighlightGfx)
  selectedFeature = null

  renderLabels(currentData, width, height, index)
  labelContainer.visible = labelsVisible.value
  updateLabels()
}

function onWheel(e) {
  e.preventDefault()

  const rect = mapContainer.value.getBoundingClientRect()
  const mouseX = e.clientX - rect.left
  const mouseY = e.clientY - rect.top

  const delta = e.deltaY > 0 ? 0.9 : 1.1
  const newScale = Math.max(0.5, Math.min(8, mapScale * delta))

  const scaleRatio = newScale / mapScale
  mapX = mouseX - (mouseX - mapX) * scaleRatio
  mapY = mouseY - (mouseY - mapY) * scaleRatio
  mapScale = newScale

  worldContainer.scale.set(mapScale)
  worldContainer.position.set(mapX, mapY)
  baseContainer.scale.set(mapScale)
  baseContainer.position.set(mapX, mapY)
  updateLabels()
}

function onPointerDown(e) {
  isDragging = true
  lastPointer.x = e.clientX
  lastPointer.y = e.clientY
  pointerDownPos.x = e.clientX
  pointerDownPos.y = e.clientY
  app.canvas.style.cursor = 'grabbing'
}

function onPointerMove(e) {
  if (!isDragging) return
  mapX += e.clientX - lastPointer.x
  mapY += e.clientY - lastPointer.y
  lastPointer.x = e.clientX
  lastPointer.y = e.clientY
  worldContainer.position.set(mapX, mapY)
  baseContainer.position.set(mapX, mapY)
  updateLabels()
}

function onPointerUp() {
  isDragging = false
  app.canvas.style.cursor = 'grab'
}

function onClick(e) {
  const dx = e.clientX - pointerDownPos.x
  const dy = e.clientY - pointerDownPos.y
  if (Math.sqrt(dx * dx + dy * dy) > 5) return

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

function onResize() {
  requestAnimationFrame(() => {
    const width = app.screen.width
    const height = app.screen.height
    setScreenSize(width, height)

    // 保持地图居中（以 104°E, 36°N 为中心）
    const center = geoToScreen(104, 36, width, height)
    mapX = width / 2 - center.x
    mapY = height / 2 - center.y
    worldContainer.position.set(mapX, mapY)
    baseContainer.position.set(mapX, mapY)

    // 用新的尺寸重绘两层地图
    loadLayer(currentLayerIndex.value)
    if (baseMapVisible.value) {
      renderBaseMap()
    }
  })
}

onMounted(async () => {
  app = new Application()
  await app.init({
    resizeTo: mapContainer.value,
    backgroundColor: 0x1a1a2e,
    antialias: true,
  })
  mapContainer.value.appendChild(app.canvas)

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
  initGameOrders(worldContainer)
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

  // 加载市列表
  cityList = chinaCities
  for (const c of cityList) {
    if (c.gb) cityDataMap.set(c.gb, c)
  }
  console.log('市列表加载完成:', cityList.length, '个市')

  // 加载世界国家数据（同时注册 GeoJSON iso_a3 的映射，解决现代代码与 1931 代码不一致的问题）
  for (const c of worldCountries) {
    if (c.iso_a3) worldDataMap.set(c.iso_a3, c)
  }
  for (const [geoIso, gameIso] of Object.entries(GEO_TO_GAME_ISO)) {
    const data = worldDataMap.get(gameIso)
    if (data) worldDataMap.set(geoIso, data)
  }
  console.log('世界国家数据加载完成:', worldCountries.length, '个')

  // 加载世界地图
  try {
    const res = await fetch('/世界.geojson')
    worldData = await res.json()
    console.log('世界地图加载完成:', worldData.features.length, '个国家')
    await renderBaseMap()
    // 注册国家地点（iso_a3 作为唯一 id），并处理现代码→游戏码别名
    registerLocations(worldData.features, 'iso_a3')
    for (const [geoIso, gameIso] of Object.entries(GEO_TO_GAME_ISO)) {
      registerAlias(geoIso, gameIso)
    }
  } catch (e) {
    console.error('世界地图加载失败:', e)
  }

  await loadLayer(currentLayerIndex.value)

  // 注册城市地点（gb 作为唯一 id）
  const cityJson = geoJsonCache.get(LAYERS[1].file)
  if (cityJson) registerLocations(cityJson.features, 'gb')
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
  right: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 1000;
}

.layer-switcher button {
  padding: 8px 16px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
  backdrop-filter: blur(4px);
}

.layer-switcher button:hover {
  background: rgba(0, 0, 0, 0.8);
  border-color: rgba(255, 255, 255, 0.5);
}

.layer-switcher button.active {
  background: rgba(59, 130, 246, 0.8);
  border-color: rgba(59, 130, 246, 1);
}

.owner-toggle {
  margin-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.2);
  padding-top: 8px;
}

.switcher-divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.15);
  margin: 4px 0;
}

.disclaimer-bar {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 500;
  background: rgba(0, 0, 0, 0.72);
  color: #ccc;
  font-size: 11px;
  text-align: center;
  padding: 7px 12px;
  cursor: pointer;
  backdrop-filter: blur(6px);
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  transition: background 0.2s;
  user-select: none;
}

.disclaimer-bar:hover {
  background: rgba(0, 0, 0, 0.88);
  color: #fff;
}

.disclaimer-content p {
  margin: 0 0 10px;
  line-height: 1.6;
  color: #ddd;
  font-size: 14px;
}

.disclaimer-content .disclaimer-sources {
  margin-top: 12px;
  margin-bottom: 4px;
  font-weight: bold;
  color: #fff;
}

.disclaimer-content ul {
  margin: 0;
  padding-left: 18px;
  color: #ccc;
  font-size: 13px;
  line-height: 1.8;
}

.disclaimer-content a {
  color: #7eb8ff;
  text-decoration: none;
}

.battle-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  margin-bottom: 8px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: #fff;
  font-size: 14px;
}

.battle-item:last-child {
  margin-bottom: 0;
}

.battle-info {
  flex: 1;
}

.inactive {
  color: #888;
  font-size: 12px;
  margin-left: 6px;
}

.empty-hint {
  color: #aaa;
  font-size: 13px;
  text-align: center;
  padding: 20px 0;
}

.disclaimer-content a:hover {
  text-decoration: underline;
}
</style>
