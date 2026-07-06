<template>
  <div ref="mapContainer" class="map-container"></div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { Application, Container, Graphics } from 'pixi.js'

const mapContainer = ref()
let app
let worldContainer

const LAYERS = [
  { file: '/中国_省.geojson', minZoom: 0, maxZoom: 7, color: 0x555555, fillColor: 0xdddddd },
  { file: '/中国_市.geojson', minZoom: 7.5, maxZoom: 12, color: 0x444444, fillColor: 0xcccccc },
  { file: '/中国_县.geojson', minZoom: 12.5, maxZoom: 20, color: 0x333333, fillColor: 0xbbbbbb },
]

const geoJsonCache = new Map()
let currentLayerIndex = -1
let isDragging = false
let lastPointer = { x: 0, y: 0 }

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
  const lngRange = GEO_BOUNDS.maxLng - GEO_BOUNDS.minLng // 62
  const latRange = GEO_BOUNDS.maxLat - GEO_BOUNDS.minLat // 36
  const scale = Math.min(width / lngRange, height / latRange)
  const x = (lng - GEO_BOUNDS.minLng) * scale
  const y = (GEO_BOUNDS.maxLat - lat) * scale
  return { x, y }
}

function drawFeature(graphics, feature, width, height, style, scale) {
  const { geometry } = feature
  const polygons =
    geometry.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry.type === 'MultiPolygon'
        ? geometry.coordinates
        : []
  const lineWidth = 1.5 / scale

  for (const polygon of polygons) {
    graphics.fill({ color: style.fillColor, alpha: 0.5 })
    graphics.stroke({ width: lineWidth, color: style.color, alpha: 1 })
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

async function loadLayer(index) {
  if (index === currentLayerIndex) return
  currentLayerIndex = index

  const config = LAYERS[index]
  if (!geoJsonCache.has(config.file)) {
    const res = await fetch(config.file)
    geoJsonCache.set(config.file, await res.json())
  }

  const data = geoJsonCache.get(config.file)
  const width = app.screen.width
  const height = app.screen.height

  worldContainer.removeChildren()
  const graphics = new Graphics()
  for (const feature of data.features) {
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
}

function getZoomFromScale() {
  return Math.log2(mapScale) + 5
}

function checkLayer() {
  const zoom = getZoomFromScale()
  for (let i = 0; i < LAYERS.length; i++) {
    if (zoom >= LAYERS[i].minZoom && zoom <= LAYERS[i].maxZoom) {
      loadLayer(i)
      return
    }
  }
}

function onWheel(e) {
  e.preventDefault()

  const rect = mapContainer.value.getBoundingClientRect()
  const mouseX = e.clientX - rect.left
  const mouseY = e.clientY - rect.top

  const delta = e.deltaY > 0 ? 0.9 : 1.1
  const newScale = Math.max(0.5, Math.min(8, mapScale * delta))

  // 以鼠标位置为中心缩放
  const scaleRatio = newScale / mapScale
  mapX = mouseX - (mouseX - mapX) * scaleRatio
  mapY = mouseY - (mouseY - mapY) * scaleRatio
  mapScale = newScale

  worldContainer.scale.set(mapScale)
  worldContainer.position.set(mapX, mapY)
  checkLayer()
}

function onPointerDown(e) {
  isDragging = true
  lastPointer.x = e.clientX
  lastPointer.y = e.clientY
  app.canvas.style.cursor = 'grabbing'
}

function onPointerMove(e) {
  if (!isDragging) return
  mapX += e.clientX - lastPointer.x
  mapY += e.clientY - lastPointer.y
  lastPointer.x = e.clientX
  lastPointer.y = e.clientY
  worldContainer.position.set(mapX, mapY)
}

function onPointerUp() {
  isDragging = false
  app.canvas.style.cursor = 'grab'
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
  app.stage.addChild(worldContainer)

  // 初始居中：中国中心约 (104, 36)
  const width = app.screen.width
  const height = app.screen.height
  const center = geoToScreen(104, 36, width, height)
  mapX = width / 2 - center.x
  mapY = height / 2 - center.y
  worldContainer.position.set(mapX, mapY)

  app.canvas.style.cursor = 'grab'
  app.canvas.addEventListener('wheel', onWheel, { passive: false })
  app.canvas.addEventListener('pointerdown', onPointerDown)
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)

  await loadLayer(0)
})

onUnmounted(() => {
  app?.canvas?.removeEventListener('wheel', onWheel)
  app?.canvas?.removeEventListener('pointerdown', onPointerDown)
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
</style>
