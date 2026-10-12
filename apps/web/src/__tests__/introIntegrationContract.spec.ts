/**
 * LeafletMap 依赖真实 WebGL / 4MB geojson，jsdom 下无法整体挂载；
 * 这里对其开场接入做源码级契约检查（运行时行为由 introDirector / cameraTween / newGameIntro 单测覆盖，
 * 浏览器内行为由父代理 QA 覆盖）。
 */
import { describe, expect, it } from 'vitest'
import map from '@/components/LeafletMap.vue?raw'
import intro from '@/components/EpicIntro.vue?raw'
import onboarding from '@/views/OnboardingView.vue?raw'

const script = map.slice(map.indexOf('<script setup'), map.indexOf('</script>'))
const onMountedBody = script.slice(script.indexOf('onMounted(async () => {'), script.indexOf('onUnmounted(() => {'))
const onUnmountedBody = script.slice(script.indexOf('onUnmounted(() => {'))

describe('intro integration contract', () => {
  it('reuses the single Pixi Application (no second instance / snapshot)', () => {
    expect(script.match(/new Application\(/g)).toHaveLength(1)
    expect(intro).not.toMatch(/pixi\.js/)
    expect(intro).not.toMatch(/new Application/)
  })

  it('seeds world idempotently before any await in onMounted (slow map keeps the selection)', () => {
    const firstAwait = onMountedBody.search(/^\s+(const \w+ = )?await /m)
    const ensure = onMountedBody.indexOf('useGameStore().ensureWorld()')
    expect(firstAwait).toBeGreaterThan(-1)
    expect(ensure).toBeGreaterThan(-1)
    expect(ensure).toBeLessThan(firstAwait)
    expect(onMountedBody).not.toMatch(/\.initWorld\(\)/)
  })

  it('intro is triggered only by the one-shot request, never by watching currentFaction', () => {
    expect(script).toMatch(/watch\(\(\) => pendingNewGameIntro\.value\?\.nonce, tryStartIntro\)/)
    // currentFaction 的 watch 只用于取消，不启动开场
    const cancelWatch = script.slice(script.indexOf('watch(\n  [\n    () => useGameStore().reloadToken'))
    expect(cancelWatch.slice(0, 400)).toMatch(/cancelIntroForWorldChange\(\)/)
    expect(cancelWatch.slice(0, 400)).not.toMatch(/tryStartIntro/)
    expect(onboarding).toMatch(/requestNewGameIntro\(faction, gameStore\.reloadToken\)/)
  })

  it('every await in onMounted after app.init is followed by a disposed guard', () => {
    const afterInit = onMountedBody.slice(onMountedBody.indexOf('appReady = true'))
    const lines = afterInit.split('\n')
    lines.forEach((line, i) => {
      if (!/^\s{2,4}(const \w+ = )?await /.test(line)) return
      const next = lines.slice(i + 1, i + 3).join('\n')
      if (/await res\.json\(\)|await fetch\('/.test(line)) return // 由紧随其后的 res.json / 守卫覆盖
      expect(next, `missing mapDisposed guard after: ${line.trim()}`).toMatch(/mapDisposed/)
    })
    expect(onMountedBody).toMatch(/if \(mapDisposed \|\| !mapContainer\.value\)/)
    expect(onMountedBody).not.toMatch(/throw e/)
  })

  it('unmount clears font timer, late watches, intro layer/lock, tween, and destroys app once', () => {
    expect(onUnmountedBody).toMatch(/mapDisposed = true/)
    expect(onUnmountedBody).toMatch(/clearTimeout\(fontReadyTimer\)/)
    expect(onUnmountedBody).toMatch(/lateWatchStops/)
    expect(onUnmountedBody).toMatch(/introDestroyLayer\(\)/)
    expect(onUnmountedBody).toMatch(/introLockCount = 0/)
    expect(onUnmountedBody).toMatch(/cameraTween\.cancel\(\)/)
    expect(onUnmountedBody).toMatch(/if \(appReady\) \{\s*appReady = false\s*app\.destroy\(true\)/)
  })

  it('input handlers respect the intro lock; keyboard yields to the intro overlay', () => {
    expect(script).toMatch(/function inputLocked\(\): boolean \{\s*return cameraLocked \|\| introLockCount > 0/)
    expect(script).not.toMatch(/if \(cameraLocked\) return/)
    expect(script).toMatch(/if \(introLockCount > 0 \|\| introSession\.value\) return/)
  })

  it('animateCameraTo keeps its old signature and delegates to the promise-safe tweener', () => {
    expect(script).toMatch(/function animateCameraTo\(\s*target: CameraTarget,\s*duration: number,\s*opts\?: CameraTweenOptions,?\s*\): Promise<void>/)
    expect(script).toMatch(/return cameraTween\.tweenTo\(target, duration, opts\)/)
  })

  it('DEV text hook exposes intro / ready / locks only under isDev', () => {
    const i = script.indexOf('render_game_to_text: () =>')
    expect(script.slice(Math.max(0, i - 80), i)).toMatch(/if \(isDev\)/)
    expect(script).toMatch(/mapReady: mapReadyState\.value/)
    expect(script).toMatch(/locks: \{ cameraLocked, introLock: introLockCount/)
  })

  it('existing place-name layer is hidden only while the intro lock is held (preference untouched)', () => {
    expect(script).toMatch(/labelContainer\.visible = labelsVisible\.value && introLockCount === 0/)
    // 唯一写入点：其它地方不再直接写 labelContainer.visible
    expect(script.match(/labelContainer\.visible =/g)).toHaveLength(1)
    const lock = script.slice(script.indexOf('acquireLock(): () => void {'), script.indexOf('worldToken: introWorldToken'))
    expect(lock.match(/syncLabelVisibility\(\)/g)).toHaveLength(2)
    expect(lock).not.toMatch(/labelsVisible\.value =/)
  })

  it('player name is rendered by text interpolation only', () => {
    expect(intro).not.toMatch(/v-html/)
    expect(intro).toMatch(/\{\{ cast\.playerName \}\}/)
  })

  it('does not cache failed/invalid map responses and clears core cache before retry', () => {
    const layer = script.slice(script.indexOf('async function loadLayer('), script.indexOf('// ─── 相机控制'))
    const cacheWrite = layer.indexOf('geoJsonCache.set(config.file, data)')
    expect(cacheWrite).toBeGreaterThan(-1)
    const statusCheck = layer.indexOf('if (!res.ok) throw')
    const shapeCheck = layer.indexOf("data?.type !== 'FeatureCollection'")
    expect(statusCheck).toBeGreaterThan(-1)
    expect(shapeCheck).toBeGreaterThan(-1)
    expect(statusCheck).toBeLessThan(cacheWrite)
    expect(shapeCheck).toBeLessThan(cacheWrite)
    const retry = script.slice(script.indexOf('async function introRetryLoad('), script.indexOf('const introPort:'))
    const clearCore = retry.indexOf('geoJsonCache.delete(LAYERS[1].file)')
    expect(clearCore).toBeGreaterThan(-1)
    expect(clearCore).toBeLessThan(retry.indexOf('await loadCoreCityLayer()'))
  })
})
