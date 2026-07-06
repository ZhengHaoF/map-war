<template>
  <div ref="mapContainer" class="map-container">
    <div class="layer-switcher">
      <button
        v-for="(layer, index) in LAYERS"
        :key="layer.file"
        :class="{ active: currentLayerIndex === index }"
        @click="switchLayer(index)"
      >
        {{ layer.label }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js'

const mapContainer = ref()
let app
let worldContainer
let labelContainer
let currentLayerIndex = ref(0)
let currentData = null

const LAYERS = [
  { file: '/中国_省.geojson', label: '省级', color: 0x555555, fillColor: 0xdddddd },
  { file: '/中国_市.geojson', label: '市级', color: 0x444444, fillColor: 0xcccccc },
  { file: '/中国_县.geojson', label: '县级', color: 0x333333, fillColor: 0xbbbbbb },
]

const geoJsonCache = new Map()
let isDragging = false
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
  const lng = (screenX / scale) + GEO_BOUNDS.minLng
  const lat = GEO_BOUNDS.maxLat - (screenY / scale)
  return { lng, lat }
}

function pointInPolygon(lng, lat, coordinates) {
  let inside = false
  for (let i = 0, j = coordinates.length - 1; i < coordinates.length; j = i++) {
    const [xi, yi] = coordinates[i]
    const [xj, yj] = coordinates[j]
    if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
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
    graphics.fill({ color: style.fillColor, alpha: 0.5 })
    graphics.stroke({ width: 1.5, color: style.color, alpha: 1 })
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
    drawFeature(
      graphics,
      feature,
      width,
      height,
      {
        color: config.color,
        fillColor: config.fillColor,
      },
      mapScale,
    )
  }
  worldContainer.addChild(graphics)

  renderLabels(currentData, width, height, index)
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
  app.stage.addChild(worldContainer)
  app.stage.addChild(labelContainer)

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
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)

  await loadLayer(0)
})

onUnmounted(() => {
  app?.canvas?.removeEventListener('wheel', onWheel)
  app?.canvas?.removeEventListener('pointerdown', onPointerDown)
  app?.canvas?.removeEventListener('click', onClick)
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  app?.destroy(true)
})
</script>

<style scoped>
.map-container {
  width: 100vw;
  height: 100vh;
  overflow: hidden;
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
</style>
