<script setup lang="ts">
/**
 * 新局史诗开场（正式游戏版）。
 *
 * DOM 层只做宣纸、墨晕、题年、群雄名录、本方字幕卡与受命落印；地图本身是 LeafletMap 现有的
 * Pixi 实例，经 IntroMapPort 推镜与绘制入场专用层。所有样式由导演主时钟逐帧写入，不走响应式。
 * 组件卸载即取消：停 RAF、清定时器、停音频、销毁入场层、释放输入锁、移除 body.intro-active。
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { IntroDirector, type IntroMapPort, type IntroOutcome, type IntroStatus } from '@/utils/intro/introDirector'
import { actAt, clamp01, easeInCubic, easeOutCubic, formatCnDate, type IntroFrame } from '@/utils/intro/introTimeline'
import type { IntroCast } from '@/utils/intro/introPlan'
import { IntroAudio } from '@/utils/intro/introAudio'
import { drawInkBlot } from '@/utils/intro/introInk'
import { GAME_START_DATE } from '@/utils/chronicle'

const props = defineProps<{
  port: IntroMapPort
  cast: IntroCast
  reduced: boolean
  theme: 'paper' | 'night'
  /** 地图闸门等待上限（毫秒），缺省用导演默认值 */
  readyTimeoutMs?: number
}>()

const emit = defineEmits<{
  done: [outcome: IntroOutcome]
}>()

/** “开战”连击保护：开始后这段时间内 Enter / Space / 点击不算跳过（Esc 与跳过按钮随时有效） */
const SKIP_GUARD_S = 0.5

const status = ref<IntroStatus>('playing')
const errorText = ref('')
const muted = ref(true)
const skippable = ref(false)
const actLabel = ref('')
const dateText = formatCnDate(GAME_START_DATE)
const yearChars = Array.from(dateText.year).slice(0, 4)
const neighborList = computed(() => props.cast.neighbors)

const rootEl = ref<HTMLElement | null>(null)
const stageEl = ref<HTMLElement | null>(null)
const coverEl = ref<HTMLElement | null>(null)
const coverL = ref<HTMLElement | null>(null)
const coverR = ref<HTMLElement | null>(null)
const blotEl = ref<HTMLCanvasElement | null>(null)
const washEl = ref<HTMLElement | null>(null)
const titleEl = ref<HTMLElement | null>(null)
const charEls: (HTMLElement | null)[] = []
const dateEl = ref<HTMLElement | null>(null)
const smallSealEl = ref<HTMLElement | null>(null)
const vignetteEl = ref<HTMLElement | null>(null)
const rosterEl = ref<HTMLElement | null>(null)
const rosterSealEls: (HTMLElement | null)[] = []
const qxEl = ref<HTMLElement | null>(null)
const cardEl = ref<HTMLElement | null>(null)
const neighborEls: (HTMLElement | null)[] = []
const lockupEl = ref<HTMLElement | null>(null)
const stampEl = ref<HTMLElement | null>(null)
const ringEl = ref<HTMLElement | null>(null)
const decreeEl = ref<HTMLElement | null>(null)

const audio = new IntroAudio()
const director = shallowRef<IntroDirector | null>(null)
let lockupSize = { w: 0, h: 0 }
let disposed = false

function setStyle(el: HTMLElement | null | undefined, prop: string, val: string): void {
  if (!el) return
  const style = el.style as unknown as Record<string, string>
  if (style[prop] !== val) style[prop] = val
}

function applyDom(t: number, f: IntroFrame): void {
  if (!skippable.value && t >= SKIP_GUARD_S) skippable.value = true
  const act = actAt(t, props.reduced)
  const label = `${act.no} · ${act.label}`
  if (actLabel.value !== label) actLabel.value = label
  const vw = window.innerWidth
  const vh = window.innerHeight
  setStyle(rootEl.value, 'opacity', f.exit.toFixed(3))
  setStyle(coverEl.value, 'opacity', f.coverOpacity.toFixed(3))
  setStyle(coverEl.value, 'visibility', f.coverOpacity > 0.001 && f.coverOpen < 0.999 ? 'visible' : 'hidden')
  setStyle(coverL.value, 'transform', `translate3d(${(-f.coverOpen * 101).toFixed(2)}%,0,0)`)
  setStyle(coverR.value, 'transform', `translate3d(${(f.coverOpen * 101).toFixed(2)}%,0,0)`)
  for (const r of [coverL.value, coverR.value]) {
    setStyle(r?.querySelector<HTMLElement>('.rod'), 'opacity', f.rodOpacity.toFixed(3))
  }
  setStyle(blotEl.value, 'opacity', f.blotOpacity.toFixed(3))
  setStyle(blotEl.value, 'transform', `translate(-50%,-50%) scale(${f.blotScale.toFixed(4)})`)
  setStyle(washEl.value, 'opacity', f.washOpacity.toFixed(3))
  setStyle(washEl.value, 'transform', `translate(-50%,-50%) scale(${f.washScale.toFixed(4)})`)
  setStyle(titleEl.value, 'opacity', f.titleOpacity.toFixed(3))
  for (let i = 0; i < charEls.length; i++) {
    const p = f.chars[i] ?? 0
    setStyle(charEls[i], 'clipPath', `inset(0 0 ${((1 - p) * 100).toFixed(2)}% 0)`)
    setStyle(charEls[i], 'opacity', (p > 0 ? 0.35 + 0.65 * p : 0).toFixed(3))
    setStyle(charEls[i], 'transform', `translateY(${((1 - p) * -6).toFixed(2)}px)`)
  }
  setStyle(dateEl.value, 'opacity', f.dateOpacity.toFixed(3))
  {
    const p = f.smallSeal
    const fade = f.smallSealFade ?? clamp01(p * 3)
    const s = f.smallSealFade != null ? 1 : 1 + 0.9 * (1 - easeInCubic(p))
    setStyle(smallSealEl.value, 'opacity', (p > 0 ? fade : 0).toFixed(3))
    setStyle(smallSealEl.value, 'transform', `scale(${s.toFixed(4)}) rotate(-4deg)`)
  }
  setStyle(vignetteEl.value, 'opacity', f.vignette.toFixed(3))

  // 群雄名录
  setStyle(rosterEl.value, 'opacity', f.rosterOpacity.toFixed(3))
  setStyle(rosterEl.value, 'visibility', f.rosterOpacity > 0.001 ? 'visible' : 'hidden')
  for (let i = 0; i < rosterSealEls.length; i++) {
    const p = f.seals[i] ?? 0
    setStyle(rosterSealEls[i], 'opacity', clamp01(p * 2).toFixed(3))
    setStyle(rosterSealEls[i], 'transform', `translateY(${((1 - easeOutCubic(p)) * -16).toFixed(2)}px)`)
  }
  setStyle(qxEl.value, 'opacity', f.qxTitle.toFixed(3))
  setStyle(qxEl.value, 'transform', `translate(-50%, ${((1 - f.qxTitle) * -8).toFixed(2)}px)`)

  // 本方字幕卡
  setStyle(cardEl.value, 'opacity', f.card.toFixed(3))
  setStyle(cardEl.value, 'visibility', f.card > 0.001 ? 'visible' : 'hidden')
  setStyle(cardEl.value, 'transform', `translate3d(${((1 - f.card) * 22).toFixed(2)}px,0,0)`)
  for (let i = 0; i < neighborEls.length; i++) setStyle(neighborEls[i], 'opacity', (f.neighbors[i] ?? 0).toFixed(3))

  // 受命：落印 + 字幕 + 收为角标
  const lk = lockupEl.value
  if (lk) {
    const mobile = vw < 640
    const sEnd = mobile ? 0.5 : 0.42
    const pad = mobile ? 14 : 28
    const bottomGap = mobile ? 34 : 40
    if (!lockupSize.w) lockupSize = { w: lk.offsetWidth, h: lk.offsetHeight }
    const tx = pad + (lockupSize.w * sEnd) / 2
    const ty = vh - bottomGap - pad - (lockupSize.h * sEnd) / 2
    const k = f.lockup
    const dx = (tx - vw / 2) * k
    const dy = (ty - vh / 2) * k
    const sc = 1 - (1 - sEnd) * k
    const vis = props.reduced ? (f.stampFade ?? 0) : f.stampDrop > 0 ? 1 : 0
    setStyle(lk, 'visibility', vis > 0.001 ? 'visible' : 'hidden')
    setStyle(lk, 'transform', `translate(-50%,-50%) translate(${dx.toFixed(1)}px,${dy.toFixed(1)}px) scale(${sc.toFixed(4)})`)
  }
  {
    let s = 1
    let o = 1
    if (props.reduced) {
      o = f.stampFade ?? 0
    } else {
      const p = f.stampDrop
      s = 1 + 1.7 * (1 - easeInCubic(p))
      o = clamp01(p * 2.4)
      s *= 1 - 0.035 * f.stampImpact
    }
    setStyle(stampEl.value, 'opacity', o.toFixed(3))
    setStyle(stampEl.value, 'transform', `scale(${s.toFixed(4)}) rotate(-3deg)`)
    const rp = f.stampRing
    setStyle(ringEl.value, 'opacity', (rp > 0 && rp < 1 ? (1 - rp) * 0.55 : 0).toFixed(3))
    setStyle(ringEl.value, 'transform', `translate(-50%,-50%) scale(${(1 + 1.4 * easeOutCubic(rp)).toFixed(4)})`)
  }
  setStyle(decreeEl.value, 'opacity', f.decree.toFixed(3))
  setStyle(decreeEl.value, 'transform', `translateY(${((1 - f.decree) * 10).toFixed(2)}px)`)

  // 落印一“顿”（只动 DOM 舞台，不动地图）
  const im = f.stampImpact
  setStyle(
    stageEl.value,
    'transform',
    im > 0.001
      ? `translate(${(Math.sin(im * Math.PI * 3) * 2.5).toFixed(2)}px, ${(im * 3).toFixed(2)}px) scale(${(1 + 0.006 * im).toFixed(4)})`
      : 'none',
  )
}

// ───────── 控制 ─────────
function skip(): void {
  director.value?.skip()
}
function retry(): void {
  director.value?.retry()
}
function dismiss(): void {
  director.value?.dismiss()
}
function toggleMute(): void {
  if (muted.value) {
    audio.unlock() // 用户手势内解锁
    muted.value = false
    audio.setMuted(false)
  } else {
    muted.value = true
    audio.setMuted(true)
  }
}
function onStageClick(): void {
  if (skippable.value && status.value !== 'error') skip()
}

function onKey(e: KeyboardEvent): void {
  if (e.isComposing) return
  // 入场期间接管键盘：不让 Esc 落到 cameraController.cancel()，也不让 A/M 等快捷键触发地图指令
  const tag = (e.target as HTMLElement | null)?.tagName ?? ''
  const onButton = tag === 'BUTTON'
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    if (status.value === 'error') dismiss()
    else skip()
    return
  }
  if ((e.key === 'Enter' || e.key === ' ') && !onButton) {
    e.preventDefault()
    e.stopPropagation()
    if (skippable.value && status.value !== 'error') skip()
    return
  }
  if (!onButton && e.key !== 'Tab') e.stopPropagation()
}

const isHidden = (): boolean => typeof document !== 'undefined' && document.visibilityState === 'hidden'

function snapshot(): Record<string, unknown> {
  const d = director.value
  return {
    status: d?.status ?? status.value,
    outcome: d?.outcome ?? null,
    act: actLabel.value,
    elapsed: d ? Math.round(d.t * 1000) / 1000 : 0,
    duration: d?.duration ?? null,
    reduced: props.reduced,
    theme: props.theme,
    muted: muted.value,
    audio: audio.state,
    activeVoices: audio.voices.size,
    skippable: skippable.value,
    locked: d?.locked ?? false,
    hasShots: d?.hasShots ?? false,
    rafPending: d?.rafPending ?? false,
    waitingTimer: d?.waiting ?? false,
    error: d?.error || errorText.value || null,
    faction: props.cast.faction,
    factionLabel: props.cast.factionLabel,
    playerName: props.cast.playerName,
    focus: props.cast.focus,
    neighbors: props.cast.neighbors.map((n) => n.id),
    clusterCities: props.cast.clusterGbs.length,
    ownCities: props.cast.ownGbs.length,
  }
}

function onVisibilityChange(): void {
  director.value?.visibilityChanged()
  if (isHidden()) audio.stopAll()
}

function cleanup(): void {
  if (disposed) return
  disposed = true
  window.removeEventListener('keydown', onKey, true)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  document.body.classList.remove('intro-active')
  audio.dispose()
}

onMounted(() => {
  document.body.classList.add('intro-active')
  window.addEventListener('keydown', onKey, true)
  document.addEventListener('visibilitychange', onVisibilityChange)
  if (blotEl.value) drawInkBlot(blotEl.value, props.theme === 'night' ? '#d8cbae' : '#120e0a', 1931)
  const d = new IntroDirector({
    port: props.port,
    cast: props.cast,
    reduced: props.reduced,
    readyTimeoutMs: props.readyTimeoutMs,
    isHidden,
    onFrame: applyDom,
    onCue: (kind) => {
      if (!muted.value) audio.play(kind)
    },
    onStatus: (s, detail) => {
      status.value = s
      errorText.value = detail.error ?? ''
      if (s === 'error' || s === 'done') audio.stopAll()
    },
  })
  director.value = d
  // 焦点按钮：让屏幕阅读器与键盘用户能立即跳过
  rootEl.value?.querySelector<HTMLElement>('[data-testid="intro-skip"]')?.focus({ preventScroll: true })
  void d.start().then((outcome) => {
    cleanup()
    emit('done', outcome)
  })
})

onBeforeUnmount(() => {
  // 卸载 / 切路由 / 读档 / 世界替换：只清理，不写终态镜头
  director.value?.cancel()
  cleanup()
})

defineExpose({
  skip,
  cancel: () => director.value?.cancel(),
  resize: () => director.value?.resize(),
  snapshot,
})
</script>

<template>
  <Teleport to="body">
    <div
      ref="rootEl"
      class="epic-intro"
      :class="['is-' + status, { 'is-reduced': reduced }]"
      :data-theme="theme"
      data-testid="epic-intro"
      role="dialog"
      aria-modal="true"
      aria-label="新局开场"
      @click="onStageClick"
    >
      <div ref="stageEl" class="stage" aria-hidden="true">
        <div ref="vignetteEl" class="vignette"></div>

        <div ref="coverEl" class="cover">
          <div ref="coverL" class="cover-half left"><div class="rod"></div></div>
          <div ref="coverR" class="cover-half right"><div class="rod"></div></div>
          <div ref="washEl" class="wash"></div>
          <canvas ref="blotEl" class="blot"></canvas>
          <div ref="titleEl" class="year-group">
            <div ref="dateEl" class="year-date">{{ dateText.full }}</div>
            <div class="year-col">
              <span v-for="(ch, i) in yearChars" :key="i" :ref="(el) => (charEls[i] = el as HTMLElement | null)" class="year-char">{{ ch }}</span>
            </div>
            <div ref="smallSealEl" class="small-seal">开卷</div>
          </div>
        </div>

        <div ref="qxEl" class="qx-title"><span class="rule"></span>群雄割据<span class="rule"></span></div>
        <div ref="rosterEl" class="roster" data-testid="intro-roster">
          <div
            v-for="(o, i) in cast.roster"
            :key="o.id"
            :ref="(el) => (rosterSealEls[i] = el as HTMLElement | null)"
            class="roster-item"
            :class="{ own: o.id === cast.faction }"
          >
            <span class="seal" :style="{ background: o.color }">{{ o.char }}</span>
            <span class="roster-name">{{ o.label }}</span>
          </div>
        </div>

        <section ref="cardEl" class="card" data-testid="intro-card">
          <div class="card-kicker">本方</div>
          <div class="card-head">
            <span class="seal card-seal" :style="{ background: cast.color }">{{ cast.sealChar }}</span>
            <h2 class="card-label" data-testid="intro-faction-label">{{ cast.factionLabel }}</h2>
          </div>
          <div class="card-full">{{ cast.fullName }}</div>
          <dl class="card-rows">
            <div><dt>统帅</dt><dd>{{ cast.leader }}</dd></div>
            <div><dt>性格</dt><dd>{{ cast.personality }}</dd></div>
            <div v-if="neighborList.length" class="neigh-row">
              <dt>四邻</dt>
              <dd class="neighbors" data-testid="intro-neighbors">
                <span
                  v-for="(n, i) in neighborList"
                  :key="n.id"
                  :ref="(el) => (neighborEls[i] = el as HTMLElement | null)"
                  class="neighbor"
                ><span class="seal tiny" :style="{ background: n.color }">{{ n.char }}</span>{{ n.label }}</span>
              </dd>
            </div>
          </dl>
        </section>

        <div ref="lockupEl" class="lockup" data-testid="intro-lockup">
          <div class="stamp-wrap">
            <div ref="ringEl" class="stamp-ring"></div>
            <div ref="stampEl" class="stamp" data-testid="intro-stamp"><span>{{ cast.sealChar }}</span></div>
          </div>
          <div ref="decreeEl" class="decree" data-testid="intro-decree">
            <div class="decree-sub">{{ cast.factionLabel }}<template v-if="cast.focus"> · {{ cast.focus.name }}</template></div>
            <div class="decree-main"><span class="bracket">〔</span><span class="pname" data-testid="intro-player-name">{{ cast.playerName }}</span><span class="bracket">〕</span>受命</div>
          </div>
        </div>
      </div>

      <div v-if="status === 'waiting'" class="wait-note" data-testid="intro-waiting" aria-live="polite">舆图载入中…</div>

      <div
        v-if="status === 'error'"
        class="error-panel"
        role="alertdialog"
        aria-labelledby="intro-err-title"
        data-testid="intro-error"
        @click.stop
      >
        <div class="error-card">
          <div class="seal error-seal">误</div>
          <h2 id="intro-err-title">舆图未能就绪</h2>
          <p class="error-msg">{{ errorText }}</p>
          <p class="error-hint">可重试载入；或返回舆图，地图将保持当前加载状态。</p>
          <div class="error-actions">
            <button type="button" class="bar-btn strong" data-testid="intro-retry" @click.stop="retry">重试</button>
            <button type="button" class="bar-btn" data-testid="intro-dismiss" @click.stop="dismiss">返回舆图</button>
          </div>
        </div>
      </div>

      <nav class="bar" aria-label="开场控制" @click.stop>
        <span class="bar-act" aria-hidden="true">{{ actLabel }}</span>
        <button
          type="button"
          class="bar-btn"
          data-testid="intro-mute"
          :aria-pressed="!muted"
          :aria-label="muted ? '开启音效' : '关闭音效'"
          @click.stop="toggleMute"
        >{{ muted ? '静音' : '有声' }}</button>
        <button
          v-if="status !== 'error'"
          type="button"
          class="bar-btn"
          data-testid="intro-skip"
          @click.stop="skip"
        >跳过</button>
      </nav>
      <p class="sr-only" aria-live="polite">{{ status === 'error' ? errorText : actLabel }}</p>
    </div>
  </Teleport>
</template>

<style scoped>
.epic-intro {
  --paper: #efe5cf;
  --cover: #eee2c8;
  --ink: #1e160f;
  --ink-2: #4b3b2b;
  --ink-3: #7a6852;
  --cinnabar: #b3362a;
  --on-cinnabar: #f8efdc;
  --on-blot: #f3ead6;
  --blot-wash: rgba(18, 14, 10, 0.5);
  --panel: rgba(241, 232, 212, 0.9);
  --panel-solid: #f1e8d4;
  --line: rgba(43, 33, 24, 0.22);
  --line-strong: rgba(43, 33, 24, 0.55);
  --halo: rgba(243, 234, 214, 0.85);
  --vignette: rgba(92, 68, 40, 0.34);
  --tex-blend: multiply;
  --tex-opacity: 0.9;
  --paper-tex: url('@/assets/intro/paper.webp');
  --font: 'HuiWen Ming', 'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', STSong, serif;
  --yc: min(13vh, 20vw, 128px);
  position: fixed;
  inset: 0;
  z-index: 10050;
  overflow: hidden;
  color: var(--ink);
  font-family: var(--font);
  -webkit-font-smoothing: antialiased;
  cursor: default;
  user-select: none;
}
.epic-intro[data-theme='night'] {
  --paper: #16130f;
  --cover: #1a1712;
  --ink: #ede3cc;
  --ink-2: #c5b698;
  --ink-3: #8f826a;
  --cinnabar: #d1513d;
  --on-cinnabar: #fbf2e0;
  --on-blot: #17120d;
  --blot-wash: rgba(216, 203, 174, 0.28);
  --panel: rgba(26, 23, 18, 0.88);
  --panel-solid: #1c1814;
  --line: rgba(237, 227, 204, 0.18);
  --line-strong: rgba(237, 227, 204, 0.45);
  --halo: rgba(14, 12, 9, 0.85);
  --vignette: rgba(0, 0, 0, 0.6);
  --tex-blend: soft-light;
  --tex-opacity: 0.32;
}
@media (prefers-contrast: more) {
  .epic-intro {
    --ink: #000;
    --ink-2: #2a1f14;
    --ink-3: #4b3b2b;
  }
  .epic-intro[data-theme='night'] {
    --ink: #fff;
    --ink-2: #e6dac0;
    --ink-3: #c5b698;
  }
}
.epic-intro button {
  font: inherit;
  color: inherit;
}
.epic-intro :focus-visible {
  outline: 2px solid var(--cinnabar);
  outline-offset: 2px;
}

.stage {
  position: absolute;
  inset: 0;
  overflow: hidden;
  transform-origin: 50% 50%;
  pointer-events: none;
}
.vignette {
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse 75% 70% at 50% 46%, transparent 55%, var(--vignette) 100%);
}
.cover {
  position: absolute;
  inset: 0;
  opacity: 0;
  visibility: hidden;
}
.cover-half {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 50.5%;
  background-color: var(--cover);
  will-change: transform;
}
.cover-half::after {
  content: '';
  position: absolute;
  inset: 0;
  background-image: var(--paper-tex);
  background-size: 640px auto;
  mix-blend-mode: var(--tex-blend);
  opacity: var(--tex-opacity);
}
.cover-half.left {
  left: 0;
  background-image: linear-gradient(90deg, transparent 70%, rgba(80, 58, 30, 0.1));
}
.cover-half.right {
  right: 0;
  background-image: linear-gradient(270deg, transparent 70%, rgba(80, 58, 30, 0.1));
}
.rod {
  position: absolute;
  top: -2%;
  bottom: -2%;
  width: 16px;
  opacity: 0;
  background: linear-gradient(90deg, #2a1c11, #6b4a2c 35%, #3a2616 70%, #1c120a);
  box-shadow: 0 0 22px rgba(0, 0, 0, 0.35);
  z-index: 1;
}
.left .rod {
  right: -8px;
}
.right .rod {
  left: -8px;
}
.wash {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 120vmax;
  height: 120vmax;
  border-radius: 50%;
  background: radial-gradient(circle, var(--blot-wash) 0%, transparent 62%);
  opacity: 0;
}
.blot {
  position: absolute;
  left: 50%;
  top: 50%;
  width: min(max(110vmin, 76vh), 1000px);
  height: min(max(110vmin, 76vh), 1000px);
  opacity: 0;
  transform: translate(-50%, -50%) scale(0.06);
}
.year-group {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: flex-end;
  gap: calc(var(--yc) * 0.18);
}
.year-col {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.year-char {
  display: block;
  font-size: var(--yc);
  line-height: 1.04;
  color: var(--on-blot);
  opacity: 0;
  clip-path: inset(0 0 100% 0);
}
.year-date {
  writing-mode: vertical-rl;
  font-size: max(13px, calc(var(--yc) * 0.2));
  letter-spacing: 0.32em;
  color: var(--on-blot);
  opacity: 0;
  padding-bottom: calc(var(--yc) * 0.1);
}
.small-seal {
  position: absolute;
  left: calc(var(--yc) * -0.62);
  bottom: calc(var(--yc) * -0.18);
  writing-mode: vertical-rl;
  font-size: max(12px, calc(var(--yc) * 0.17));
  letter-spacing: 0.08em;
  padding: 0.42em 0.3em;
  background: var(--cinnabar);
  color: var(--on-cinnabar);
  border-radius: 3px;
  box-shadow: inset 0 0 0 2px var(--cinnabar), inset 0 0 0 3px rgba(248, 239, 220, 0.55);
  opacity: 0;
}
.seal {
  display: inline-grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 3px;
  color: #fbf4e4;
  font-size: 20px;
  line-height: 1;
  box-shadow: inset 0 0 0 3px rgba(251, 244, 228, 0.55), 1px 2px 0 rgba(0, 0, 0, 0.18);
  flex: none;
}
.seal.tiny {
  width: 20px;
  height: 20px;
  font-size: 12px;
  margin-right: 6px;
  box-shadow: inset 0 0 0 2px rgba(251, 244, 228, 0.45);
}
.qx-title {
  position: absolute;
  top: 8.5vh;
  left: 50%;
  display: flex;
  align-items: center;
  gap: 18px;
  font-size: clamp(18px, 2.3vw, 30px);
  letter-spacing: 0.6em;
  padding-left: 0.6em;
  white-space: nowrap;
  color: var(--ink);
  text-shadow: 0 0 10px var(--halo), 0 0 3px var(--halo);
  opacity: 0;
}
.qx-title .rule {
  display: inline-block;
  width: clamp(24px, 5vw, 64px);
  height: 1px;
  background: var(--line-strong);
}
.roster {
  position: absolute;
  left: 50%;
  bottom: 46px;
  transform: translateX(-50%);
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px 12px;
  width: max-content;
  max-width: 94vw;
  opacity: 0;
  visibility: hidden;
}
.roster-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  width: 62px;
}
.roster-name {
  font-size: 12px;
  letter-spacing: 0.08em;
  white-space: nowrap;
  color: var(--ink-2);
  text-shadow: 0 0 6px var(--halo);
}
.roster-item.own .roster-name {
  color: var(--cinnabar);
}
.card {
  position: absolute;
  right: clamp(16px, 5vw, 80px);
  top: 17vh;
  width: min(360px, 34vw);
  padding: 26px 28px 24px;
  background: var(--panel);
  border-top: 2px solid var(--ink);
  box-shadow: 0 18px 50px -24px rgba(30, 20, 10, 0.45);
  opacity: 0;
  visibility: hidden;
}
.card::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 4px;
  height: 1px;
  background: var(--line-strong);
}
.card-kicker {
  font-size: 13px;
  letter-spacing: 0.6em;
  color: var(--cinnabar);
  margin-bottom: 12px;
}
.card-head {
  display: flex;
  align-items: center;
  gap: 14px;
}
.card-seal {
  width: 44px;
  height: 44px;
  font-size: 26px;
}
.card-label {
  margin: 0;
  font-weight: 400;
  font-size: clamp(34px, 3.8vw, 52px);
  line-height: 1.05;
  letter-spacing: 0.12em;
}
.card-full {
  margin-top: 12px;
  font-size: 15px;
  line-height: 1.6;
  color: var(--ink-2);
  letter-spacing: 0.06em;
}
.card-rows {
  margin: 18px 0 0;
  padding-top: 14px;
  border-top: 1px solid var(--line);
  display: grid;
  gap: 10px;
}
.card-rows > div {
  display: grid;
  grid-template-columns: 3.4em 1fr;
  align-items: baseline;
  gap: 8px;
}
.card-rows dt {
  font-size: 12px;
  letter-spacing: 0.32em;
  color: var(--ink-3);
}
.card-rows dd {
  margin: 0;
  font-size: 16px;
  line-height: 1.5;
  letter-spacing: 0.05em;
}
.neighbors {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
}
.neighbor {
  display: inline-flex;
  align-items: center;
  font-size: 14px;
  opacity: 0;
  white-space: nowrap;
}
.lockup {
  position: absolute;
  left: 50%;
  top: 50%;
  display: flex;
  align-items: center;
  gap: clamp(18px, 2.4vw, 34px);
  transform: translate(-50%, -50%);
  visibility: hidden;
  max-width: 92vw;
}
.stamp-wrap {
  position: relative;
  flex: none;
}
.stamp {
  --s: clamp(112px, 14vw, 176px);
  position: relative;
  width: var(--s);
  height: var(--s);
  display: grid;
  place-items: center;
  border-radius: 7px;
  background: var(--cinnabar);
  color: var(--on-cinnabar);
  font-size: calc(var(--s) * 0.62);
  line-height: 1;
  box-shadow: inset 0 0 0 calc(var(--s) * 0.035) var(--cinnabar), inset 0 0 0 calc(var(--s) * 0.055) rgba(248, 239, 220, 0.75),
    0 10px 30px -12px rgba(120, 30, 20, 0.6);
  opacity: 0;
  overflow: hidden;
}
.stamp::after {
  content: '';
  position: absolute;
  inset: 0;
  background-image: var(--paper-tex);
  background-size: 260px auto;
  mix-blend-mode: screen;
  opacity: 0.22;
}
.stamp span {
  position: relative;
  transform: translateY(-2%);
}
.stamp-ring {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 100%;
  height: 100%;
  border: 2px solid var(--cinnabar);
  border-radius: 10px;
  opacity: 0;
}
.decree {
  opacity: 0;
  min-width: 0;
}
.decree-sub {
  font-size: clamp(13px, 1.3vw, 17px);
  letter-spacing: 0.42em;
  color: var(--ink-2);
  margin-bottom: 10px;
  text-shadow: 0 0 8px var(--halo);
}
.decree-main {
  font-size: clamp(30px, 4.4vw, 60px);
  line-height: 1.2;
  letter-spacing: 0.1em;
  color: var(--ink);
  text-shadow: 0 0 14px var(--halo), 0 0 4px var(--halo);
  overflow-wrap: anywhere;
}
.decree-main .bracket {
  color: var(--cinnabar);
}

.wait-note {
  position: absolute;
  left: 50%;
  bottom: 12vh;
  transform: translateX(-50%);
  font-size: 14px;
  letter-spacing: 0.4em;
  color: var(--on-blot);
  opacity: 0.85;
  pointer-events: none;
}

.bar {
  position: absolute;
  z-index: 3;
  top: max(12px, env(safe-area-inset-top));
  right: max(12px, env(safe-area-inset-right));
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: calc(100vw - 24px);
  opacity: 0.86;
  transition: opacity 200ms ease;
}
.bar:hover,
.bar:focus-within {
  opacity: 1;
}
.bar-act {
  margin-right: 6px;
  font-size: 12px;
  letter-spacing: 0.2em;
  color: var(--ink-2);
  text-shadow: 0 0 6px var(--halo);
  white-space: nowrap;
}
.bar-btn {
  height: 44px;
  min-width: 44px;
  padding: 0 11px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm, 4px);
  background: var(--panel);
  font-size: 13px;
  letter-spacing: 0.14em;
  cursor: pointer;
  white-space: nowrap;
  transition: border-color 160ms ease, color 160ms ease;
}
.bar-btn:hover {
  border-color: var(--line-strong);
}
.bar-btn[aria-pressed='true'] {
  color: var(--cinnabar);
}
.bar-btn.strong {
  background: var(--cinnabar);
  color: var(--on-cinnabar);
  border-color: var(--cinnabar);
}

.error-panel {
  position: absolute;
  inset: 0;
  z-index: 4;
  display: grid;
  place-items: center;
  padding: 20px;
  background: color-mix(in srgb, var(--paper) 60%, transparent);
}
.error-card {
  width: min(440px, 100%);
  padding: 28px;
  background: var(--panel-solid);
  border-top: 2px solid var(--ink);
  box-shadow: 0 24px 60px -30px rgba(30, 20, 10, 0.6);
}
.error-seal {
  background: var(--cinnabar);
  margin-bottom: 14px;
}
.error-card h2 {
  margin: 0;
  font-weight: 400;
  font-size: 26px;
  letter-spacing: 0.12em;
}
.error-msg {
  margin: 10px 0 0;
  font-size: 14px;
  color: var(--cinnabar);
  overflow-wrap: anywhere;
}
.error-hint {
  margin: 12px 0 20px;
  font-size: 15px;
  line-height: 1.7;
  color: var(--ink-2);
}
.error-actions {
  display: flex;
  gap: 8px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

@media (max-width: 960px) {
  .roster-name {
    display: none;
  }
  .roster-item {
    width: auto;
  }
}
@media (max-width: 639px) {
  .epic-intro {
    --yc: min(12vh, 19vw, 96px);
  }
  .roster {
    bottom: 40px;
    gap: 5px;
  }
  .roster .seal {
    width: 22px;
    height: 22px;
    font-size: 13px;
  }
  .qx-title {
    top: 10vh;
    gap: 10px;
    letter-spacing: 0.4em;
  }
  .card {
    left: 12px;
    right: 12px;
    top: auto;
    bottom: 34px;
    width: auto;
    padding: 16px 18px 14px;
  }
  .card-label {
    font-size: 30px;
  }
  .card-seal {
    width: 34px;
    height: 34px;
    font-size: 20px;
  }
  .card-full {
    margin-top: 8px;
    font-size: 13px;
  }
  .card-rows {
    margin-top: 10px;
    padding-top: 10px;
    gap: 6px;
  }
  .card-rows dd {
    font-size: 14px;
  }
  .lockup {
    flex-direction: column;
    text-align: center;
    gap: 16px;
  }
  .decree-sub {
    letter-spacing: 0.24em;
  }
  .decree-main {
    font-size: clamp(24px, 8vw, 34px);
  }
  .bar-act {
    display: none;
  }
  .bar {
    gap: 4px;
  }
  .bar-btn {
    padding: 0 8px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .bar,
  .bar-btn {
    transition: none;
  }
}
</style>
