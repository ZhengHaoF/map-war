<template>
  <div ref="mapContainer" class="map-container" @click.self="closeContextMenu">
    <div class="layer-switcher">
      <GameButton
        v-for="(layer, index) in LAYERS"
        :key="layer.file"
        :active="currentLayerIndex === index"
        @click="switchLayer(index)"
      >
        {{ layer.label }}
      </GameButton>
      <GameButton class="owner-toggle" :active="ownerColorEnabled" @click="toggleOwnerColor">
        政权着色
      </GameButton>
      <GameButton :active="labelsVisible" @click="toggleLabels">
        显示地名
      </GameButton>
      <GameButton @click="testPanelVisible = !testPanelVisible">
        调试
      </GameButton>
    </div>
    <LegendPanel v-if="ownerColorEnabled" :items="legendItems" />
    <GameContextMenu
      :visible="contextMenuVisible"
      :position="contextMenuPos"
      :items="contextMenuItems"
      @select="onMenuAction"
    />
    <GameModal
      :visible="infoModalVisible"
      :title="infoCityData?.name || ''"
      @close="infoModalVisible = false"
    >
      <InfoTable v-if="infoCityData" :rows="infoRows" />
    </GameModal>
    <GameModal
      :visible="testPanelVisible"
      title="调试"
      :draggable="true"
      :overlay="false"
      :init-x="160"
      :init-y="160"
      @close="testPanelVisible = false"
    >
      <div class="test-panel">
        <GameButton @click="testTroopMove">派兵测试</GameButton>
        <GameButton @click="testScout">探察测试</GameButton>
        <GameButton @click="testDeclareWar">宣战测试</GameButton>
        <GameButton @click="testBattle">战斗测试</GameButton>
        <GameButton danger @click="stopAllBattles">停止战斗</GameButton>
      </div>
    </GameModal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js'
import { OWNER_COLORS, OWNER_LABELS } from '@/data/ownerColors'
import { Owner } from '@/data/owners'
import { playArcAnimation, playScoutAnimation, startBattleAnimation } from '@/utils/troopAnimation'
import GameButton from '@/components/ui/GameButton.vue'
import GameContextMenu from '@/components/ui/GameContextMenu.vue'
import GameModal from '@/components/ui/GameModal.vue'
import InfoTable from '@/components/ui/InfoTable.vue'
import LegendPanel from '@/components/ui/LegendPanel.vue'

const mapContainer = ref()
let app
let worldContainer
let labelContainer
let highlightGraphics
let currentLayerIndex = ref(1)
let currentData = null
let selectedFeature = null
const contextMenuVisible = ref(false)
const contextMenuPos = ref({ x: 0, y: 0 })

const LAYERS = [
  { file: '/中国_省.geojson', label: '省级', color: 0x555555, fillColor: 0xdddddd },
  { file: '/中国_市.geojson', label: '市级', color: 0x444444, fillColor: 0xcccccc },
  { file: '/中国_县.geojson', label: '县级', color: 0x333333, fillColor: 0xbbbbbb },
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
const testPanelVisible = ref(false)
const ownerColorEnabled = ref(true)
const labelsVisible = ref(false)

const legendItems = computed(() =>
  Object.entries(OWNER_LABELS).map(([key, label]) => ({
    label,
    color: '#' + OWNER_COLORS[key].toString(16).padStart(6, '0'),
  }))
)

const contextMenuItems = [
  { action: 'info', label: '查看信息' },
  { action: 'investigate', label: '调查' },
  { action: 'declare-war', label: '宣战' },
  { action: 'surprise-attack', label: '奇袭', danger: true },
]

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

let lastPointer = { x: 0, y: 0 }
let pointerDownPos = { x: 0, y: 0 }

// 地图状态
let mapScale = 1
let mapX = 0
let mapY = 0

const GEO_BOUNDS = {
  minLng: 73,
  maxLng: 135,
  minLat: 18,
  maxLat: 54,
}

function geoToScreen(lng, lat, width, height) {
  const lngRange = GEO_BOUNDS.maxLng - GEO_BOUNDS.minLng
  const latRange = GEO_BOUNDS.maxLat - GEO_BOUNDS.minLat
  const scale = Math.min(width / lngRange, height / latRange)
  const x = (lng - GEO_BOUNDS.minLng) * scale
  const y = (GEO_BOUNDS.maxLat - lat) * scale
  return { x, y }
}

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

function calculateCentroid(geometry) {
  const polygons = []
  if (geometry.type === 'Polygon') {
    polygons.push(geometry.coordinates[0])
  } else if (geometry.type === 'MultiPolygon') {
    for (const polygon of geometry.coordinates) {
      polygons.push(polygon[0])
    }
  }

  if (polygons.length === 0) return null

  function ringCentroid(ring) {
    let area = 0
    let cx = 0
    let cy = 0
    for (let i = 0; i < ring.length - 1; i++) {
      const [x0, y0] = ring[i]
      const [x1, y1] = ring[i + 1]
      const cross = x0 * y1 - x1 * y0
      area += cross
      cx += (x0 + x1) * cross
      cy += (y0 + y1) * cross
    }
    area /= 2
    const absArea = Math.abs(area)
    if (absArea === 0) return null
    cx /= 6 * area
    cy /= 6 * area
    return { lng: cx, lat: cy, area: absArea }
  }

  let totalArea = 0
  let totalLng = 0
  let totalLat = 0

  for (const ring of polygons) {
    const c = ringCentroid(ring)
    if (!c) continue
    totalArea += c.area
    totalLng += c.lng * c.area
    totalLat += c.lat * c.area
  }

  if (totalArea === 0) return null
  return { lng: totalLng / totalArea, lat: totalLat / totalArea }
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
      highlightGraphics.moveTo(first.x, first.y)
      for (let i = 1; i < ring.length; i++) {
        const p = geoToScreen(ring[i][0], ring[i][1], width, height)
        highlightGraphics.lineTo(p.x, p.y)
      }
      highlightGraphics.closePath()
    }
    highlightGraphics.fill({ color, alpha: 0.4 })
    highlightGraphics.stroke({ width: 0.5, color, alpha: 1 })
  }
}

// 派兵动画
let troopAnimRunning = false

function getFeatureCentroid(feature) {
  const centroid = calculateCentroid(feature.geometry)
  if (!centroid) return null
  const width = app.screen.width
  const height = app.screen.height
  return geoToScreen(centroid.lng, centroid.lat, width, height)
}

async function testTroopMove() {
  if (troopAnimRunning || !currentData) return

  const fromGB = '156500000' // 重庆
  const toGB = '156450200'   // 柳州

  const fromFeature = currentData.features.find(f => f.properties?.gb === fromGB)
  const toFeature = currentData.features.find(f => f.properties?.gb === toGB)

  if (!fromFeature || !toFeature) {
    console.warn('未找到城市，请切换到市级图层')
    return
  }

  const from = getFeatureCentroid(fromFeature)
  const to = getFeatureCentroid(toFeature)
  if (!from || !to) return

  troopAnimRunning = true

  await playArcAnimation({
    from,
    to,
    container: worldContainer,
    mode: 'dots',
    text: '出兵！',
    highlightGfx: highlightGraphics,
    fromFeature,
    toFeature,
    onHighlight: highlightFeature,
    color: 0xffcc00,
    dots: 5,
    duration: 2000,
  })

  troopAnimRunning = false
}

// 探察测试
let scoutAnimRunning = false

async function testScout() {
  if (scoutAnimRunning || !currentData) return

  const fromGB = '156500000' // 重庆
  const fromFeature = currentData.features.find(f => f.properties?.gb === fromGB)
  if (!fromFeature) return

  const from = getFeatureCentroid(fromFeature)
  if (!from) return

  scoutAnimRunning = true

  await playScoutAnimation({
    from,
    container: worldContainer,
    color: 0x22c55e,
    rings: 3,
    duration: 1500,
    text: '侦察！',
  })

  scoutAnimRunning = false
}

// 宣战测试
let declareWarAnimRunning = false

async function testDeclareWar() {
  if (declareWarAnimRunning || !currentData) return

  const fromGB = '156500000' // 重庆
  const toGB = '156450200'   // 柳州

  const fromFeature = currentData.features.find(f => f.properties?.gb === fromGB)
  const toFeature = currentData.features.find(f => f.properties?.gb === toGB)
  if (!fromFeature || !toFeature) return

  const from = getFeatureCentroid(fromFeature)
  const to = getFeatureCentroid(toFeature)
  if (!from || !to) return

  declareWarAnimRunning = true

  await playArcAnimation({
    from,
    to,
    container: worldContainer,
    mode: 'orb',
    explosion: true,
    shockwaves: 3,
    text: '宣战！',
    highlightGfx: highlightGraphics,
    toFeature,
    onHighlight: highlightFeature,
    color: 0xff4444,
    duration: 1200,
    explosionDuration: 800,
  })

  declareWarAnimRunning = false
}

// 战斗测试（持续动画）
const activeBattles = []

function testBattle() {
  if (!currentData) return

  const fromGB = '156500000' // 重庆
  const battleTargets = [
    { toGB: '156450200', colorB: 0xef4444 }, // 柳州（红色）
    { toGB: '156451000', colorB: 0x22c55e }, // 百色（绿色）
  ]

  const fromFeature = currentData.features.find(f => f.properties?.gb === fromGB)
  if (!fromFeature) return

  const from = getFeatureCentroid(fromFeature)
  if (!from) return

  // 先清除高亮
  highlightGraphics.clear()

  for (const target of battleTargets) {
    const toFeature = currentData.features.find(f => f.properties?.gb === target.toGB)
    if (!toFeature) continue

    const to = getFeatureCentroid(toFeature)
    if (!to) continue

    const battle = startBattleAnimation({
      from,
      to,
      container: worldContainer,
      highlightGfx: highlightGraphics,
      fromFeature,
      toFeature,
      onHighlight: highlightFeature,
      colorA: 0x3b82f6, // 重庆（蓝色）
      colorB: target.colorB,
    })

    activeBattles.push(battle)
  }
}

function stopAllBattles() {
  for (const battle of activeBattles) {
    battle.stop()
  }
  activeBattles.length = 0
}

function onContextMenu(e) {
  e.preventDefault()
  if (!currentData) return

  const rect = mapContainer.value.getBoundingClientRect()
  const screenX = e.clientX - rect.left
  const screenY = e.clientY - rect.top
  const feature = hitTest(screenX, screenY, currentData, app.screen.width, app.screen.height)

  if (feature) {
    selectedFeature = feature
    highlightFeature(feature)
    contextMenuPos.value = { x: screenX, y: screenY }
    contextMenuVisible.value = true
  }
}

function closeContextMenu() {
  contextMenuVisible.value = false
}

function onMenuAction(action) {
  if (action === 'info' && selectedFeature) {
    const gb = selectedFeature.properties.gb
    infoCityData.value = cityDataMap.get(gb) || null
    infoModalVisible.value = true
  } else {
    console.log('菜单操作:', action, selectedFeature?.properties)
  }
  closeContextMenu()
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
  worldContainer.addChild(highlightGraphics)
  highlightGraphics.clear()
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
  updateLabels()
}

function onPointerUp() {
  isDragging = false
  app.canvas.style.cursor = 'grab'
}

function onClick(e) {
  if (!currentData) return

  const dx = e.clientX - pointerDownPos.x
  const dy = e.clientY - pointerDownPos.y
  if (Math.sqrt(dx * dx + dy * dy) > 5) return

  const rect = mapContainer.value.getBoundingClientRect()
  const screenX = e.clientX - rect.left
  const screenY = e.clientY - rect.top
  const width = app.screen.width
  const height = app.screen.height

  const feature = hitTest(screenX, screenY, currentData, width, height)
  if (feature) {
    console.log('点击区域:', feature.properties)
    const cityInfo = cityList.find((c) => c.gb === feature.properties.gb)
    if (cityInfo) {
      console.log('市列表匹配:', cityInfo)
    }
    selectedFeature = feature
    highlightFeature(feature)
  } else {
    selectedFeature = null
    highlightGraphics.clear()
  }
}

onMounted(async () => {
  app = new Application()
  await app.init({
    resizeTo: mapContainer.value,
    backgroundColor: 0x1a1a2e,
    antialias: true,
  })
  mapContainer.value.appendChild(app.canvas)

  worldContainer = new Container()
  labelContainer = new Container()
  highlightGraphics = new Graphics()
  app.stage.addChild(worldContainer)
  app.stage.addChild(labelContainer)
  worldContainer.addChild(highlightGraphics)

  const width = app.screen.width
  const height = app.screen.height
  const center = geoToScreen(104, 36, width, height)
  mapX = width / 2 - center.x
  mapY = height / 2 - center.y
  worldContainer.position.set(mapX, mapY)

  app.canvas.style.cursor = 'grab'
  app.canvas.addEventListener('wheel', onWheel, { passive: false })
  app.canvas.addEventListener('pointerdown', onPointerDown)
  app.canvas.addEventListener('click', onClick)
  app.canvas.addEventListener('contextmenu', onContextMenu)
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('mousedown', onGlobalMouseDown)
  window.addEventListener('keydown', onKeyDown)

  // 加载市列表
  try {
    const res = await fetch('/wold_1931.json')
    cityList = await res.json()
    for (const c of cityList) {
      if (c.gb) cityDataMap.set(c.gb, c)
    }
    console.log('市列表加载完成:', cityList.length, '个市')
  } catch (e) {
    console.error('市列表加载失败:', e)
  }

  await loadLayer(currentLayerIndex.value)
})

onUnmounted(() => {
  app?.canvas?.removeEventListener('wheel', onWheel)
  app?.canvas?.removeEventListener('pointerdown', onPointerDown)
  app?.canvas?.removeEventListener('click', onClick)
  app?.canvas?.removeEventListener('contextmenu', onContextMenu)
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
</style>
