<template>
  <!-- 纸纹与晕影：整屏氛围覆盖层，不拦截交互，垫在所有面板之下 -->
  <div class="paper-grain" aria-hidden="true"></div>
  <div class="paper-vignette" aria-hidden="true"></div>
</template>

<style scoped>
/* 纸纹：SVG 分形噪声平铺 + 正片叠底，像老纸的霉斑与纤维 */
.paper-grain {
  position: fixed;
  inset: 0;
  z-index: 900;
  pointer-events: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2' seed='11' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='240' height='240' filter='url(%23n)' opacity='0.32'/%3E%3C/svg%3E");
  background-size: 240px 240px;
  mix-blend-mode: multiply;
  opacity: 0.55;
}

/* 晕影：四角向纸心收暗，烛光下摊开舆图的聚光感 */
.paper-vignette {
  position: fixed;
  inset: 0;
  z-index: 901;
  pointer-events: none;
  background: radial-gradient(
    118% 92% at 50% 44%,
    transparent 54%,
    rgba(74, 52, 24, 0.09) 78%,
    rgba(52, 36, 14, 0.24) 100%
  );
}
</style>
