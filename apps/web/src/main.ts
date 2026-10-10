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
  const store = useGameStore()
  ;(window as Window & { render_game_to_text?: () => string }).render_game_to_text = () => JSON.stringify({
    mode: store.currentFaction ? 'playing' : 'onboarding',
    faction: store.currentFaction, date: store.currentDate, turn: store.turnCount,
    cityCount: Object.keys(store.cities).length,
    actionPoints: store.currentFaction ? store.getActionPoints(store.currentFaction) : 0,
    treasury: store.currentFaction ? store.getTreasury(store.currentFaction) : 0,
    granary: store.currentFaction ? store.getGranary(store.currentFaction) : 0,
    battles: store.battles.map(b => ({ id: b.id, from: b.fromName, to: b.toName, active: b.active, route: b.route, marchDistanceKm: b.marchDistanceKm, routeHasSea: b.routeHasSea })),
    coordinates: 'map longitude/latitude; UI origin top-left, x right, y down',
  })
}
