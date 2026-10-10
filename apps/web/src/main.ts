import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { useGameStore } from './stores/game'

const app = createApp(App)

app.use(createPinia())
app.use(router)

app.mount('#app')

// Read-only development hook for browser gameplay regression checks.
if (import.meta.env.DEV) {
  const hud = document.createElement('output')
  hud.setAttribute('aria-label', '开发性能')
  hud.style.cssText = 'position:fixed;right:12px;top:12px;z-index:10000;padding:4px 8px;background:var(--paper,#f5ecd9);color:var(--ink,#4a3928);font:11px monospace;pointer-events:none;border:1px solid #b39a70'
  document.body.append(hud)
  let frames = 0, last = performance.now(), raf = 0
  const frame = (now: number) => {
    frames++
    if (now - last >= 1000) {
      hud.textContent = `DEV RAF ${Math.round(frames * 1000 / (now - last))} FPS`
      frames = 0
      last = now
    }
    raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)
  import.meta.hot?.dispose(() => { cancelAnimationFrame(raf); hud.remove() })
  const store = useGameStore()
  ;(window as Window & { render_game_to_text?: () => string }).render_game_to_text = () => JSON.stringify({
    mode: store.currentFaction ? 'playing' : 'onboarding',
    faction: store.currentFaction, date: store.currentDate, turn: store.turnCount,
    cityCount: Object.keys(store.cities).length,
    actionPoints: store.currentFaction ? store.getActionPoints(store.currentFaction) : 0,
    treasury: store.currentFaction ? store.getTreasury(store.currentFaction) : 0,
    granary: store.currentFaction ? store.getGranary(store.currentFaction) : 0,
    scenario: store.scenarioStatus ? { goal: store.scenarioStatus.goal, holdTurns: store.scenarioStatus.holdTurns, completed: store.scenarioStatus.completed, remaining: store.scenarioStatus.remaining } : null,
    fastWorldDomestic: store.fastWorldDomestic,
    battles: store.battles.map(b => ({ id: b.id, from: b.fromName, to: b.toName, active: b.active, route: b.route, marchDistanceKm: b.marchDistanceKm, routeHasSea: b.routeHasSea })),
    coordinates: 'map longitude/latitude; UI origin top-left, x right, y down',
  })
}
