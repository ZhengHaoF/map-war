<template>
  <!-- 罗盘方位图 + 里数比例尺：纯装饰（不动坐标系），右下角落款 -->
  <div class="map-compass" aria-hidden="true">
    <svg viewBox="0 0 120 152" width="92" height="117">
      <!-- 罗盘 -->
      <circle cx="60" cy="50" r="32" fill="none" stroke="#5c4426" stroke-width="1.4" />
      <circle cx="60" cy="50" r="27" fill="none" stroke="#5c4426" stroke-width="0.7" opacity="0.7" />
      <!-- 斜向短芒 -->
      <g stroke="#5c4426" stroke-width="0.8" opacity="0.75">
        <line x1="68.5" y1="41.5" x2="79.1" y2="30.9" />
        <line x1="68.5" y1="58.5" x2="79.1" y2="69.1" />
        <line x1="51.5" y1="58.5" x2="40.9" y2="69.1" />
        <line x1="51.5" y1="41.5" x2="40.9" y2="30.9" />
      </g>
      <!-- 东/南/西芒：纸色填底 -->
      <g fill="#efe6cf" stroke="#5c4426" stroke-width="0.8">
        <path d="M96 50 L66 44 L60 50 L66 56 Z" />
        <path d="M60 86 L54 56 L60 50 L66 56 Z" />
        <path d="M24 50 L54 56 L60 50 L54 44 Z" />
      </g>
      <!-- 北芒：朱砂 -->
      <path d="M60 14 L66 44 L60 50 L54 44 Z" fill="#b04a3a" stroke="#7a2a1a" stroke-width="0.8" />
      <circle cx="60" cy="50" r="2.2" fill="#3b2a18" />
      <text x="60" y="11" text-anchor="middle" class="rose-north">北</text>
      <!-- 里数比例尺（装饰性） -->
      <g>
        <rect x="16" y="115" width="88" height="6" fill="none" stroke="#5c4426" stroke-width="0.8" />
        <rect x="16" y="115" width="22" height="6" fill="#5c4426" />
        <rect x="60" y="115" width="22" height="6" fill="#5c4426" />
        <g class="scale-num">
          <text x="16" y="110">〇</text>
          <text x="38" y="110">一百</text>
          <text x="60" y="110">二百</text>
          <text x="82" y="110">三百</text>
          <text x="107" y="110">里</text>
        </g>
      </g>
    </svg>
  </div>
</template>

<style scoped>
.map-compass {
  position: fixed;
  right: 18px;
  bottom: 46px;
  z-index: 950;
  pointer-events: none;
  opacity: 0.82;
  transform: rotate(-1.6deg);
}

.rose-north {
  font-family: var(--font-kai);
  font-size: 12px;
  fill: #7a2a1a;
}

.scale-num text {
  font-family: var(--font-kai);
  font-size: 7.5px;
  fill: #5c4426;
  text-anchor: middle;
  letter-spacing: 0.5px;
}
</style>
