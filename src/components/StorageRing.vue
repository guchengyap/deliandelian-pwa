<script setup lang="ts">
/**
 * 云端容量环：镂空 SVG 圆环 + 精确用量。
 *
 * - 圆环中心留白，不显示整数百分比（百分比按下一位精度显示在右侧文字里）；
 * - 阈值配色：<85% 正常、>=85% 黄色、>=95% 红色并提示「空间即将满」（100% 为「空间已满」）；
 * - 设置页与维护模式顶部共用；compact 用于窄条场景。
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    used: number
    quota: number
    /** 整体直径（px）。 */
    size?: number
    /** 环宽（px）。 */
    stroke?: number
    /** 紧凑模式：小字号 + 横向排布，用于维护页顶部容量栏。 */
    compact?: boolean
  }>(),
  { size: 92, stroke: 9, compact: false },
)

const safeQuota = computed(() => (props.quota > 0 ? props.quota : 1))
const ratio = computed(() => Math.min(props.used / safeQuota.value, 1))
const percent = computed(() => (props.used / safeQuota.value) * 100)

const level = computed<'ok' | 'warn' | 'danger'>(() => {
  if (percent.value >= 95) return 'danger'
  if (percent.value >= 85) return 'warn'
  return 'ok'
})

const radius = computed(() => (props.size - props.stroke) / 2)
const circumference = computed(() => 2 * Math.PI * radius.value)
const dashOffset = computed(() => circumference.value * (1 - ratio.value))

const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1)
const usedText = computed(() => mb(props.used))
const quotaText = computed(() => mb(props.quota))
const percentText = computed(() => `${percent.value.toFixed(1)}%`)
const tip = computed(() => {
  if (level.value !== 'danger') return ''
  return percent.value >= 100 ? '空间已满' : '空间即将满'
})

const ariaLabel = computed(
  () => `云端空间已用 ${usedText.value} MB，共 ${quotaText.value} MB，占 ${percentText.value}${tip.value ? `，${tip.value}` : ''}`,
)
</script>

<template>
  <div class="storage-ring" :class="[level, { compact }]" role="img" :aria-label="ariaLabel">
    <svg class="ring" :width="size" :height="size" :viewBox="`0 0 ${size} ${size}`" aria-hidden="true">
      <circle class="track" :cx="size / 2" :cy="size / 2" :r="radius" fill="none" :stroke-width="stroke" />
      <circle
        v-if="ratio > 0.0005"
        class="bar"
        :cx="size / 2"
        :cy="size / 2"
        :r="radius"
        fill="none"
        :stroke-width="stroke"
        stroke-linecap="round"
        :stroke-dasharray="circumference"
        :stroke-dashoffset="dashOffset"
      />
    </svg>
    <div class="metrics">
      <p class="figure">
        <b>{{ usedText }}</b>
        <span class="unit"> MB</span>
        <span class="slash">/</span>
        <span class="quota">{{ quotaText }} MB</span>
      </p>
      <p class="sub">
        <span class="pct">占用 {{ percentText }}</span>
        <span v-if="tip" class="tip">· {{ tip }}</span>
      </p>
    </div>
  </div>
</template>

<style scoped>
.storage-ring {
  --ring-color: var(--accent);
  display: flex;
  align-items: center;
  gap: 16px;
  min-width: 0;
}
.storage-ring.warn {
  --ring-color: #d99a00;
}
.storage-ring.danger {
  --ring-color: #e0300e;
}
.ring {
  flex: 0 0 auto;
  transform: rotate(-90deg);
  overflow: visible;
}
.track {
  stroke: var(--track);
}
.bar {
  stroke: var(--ring-color);
  transition:
    stroke-dashoffset 0.45s var(--ease),
    stroke 0.35s var(--ease);
}
.metrics {
  min-width: 0;
}
.figure {
  margin: 0;
  font-size: 17px;
  line-height: 1.25;
  color: var(--text);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.figure b {
  font-size: 22px;
  font-weight: 600;
  color: var(--ring-color);
  letter-spacing: -0.02em;
}
.unit {
  font-size: 13px;
  color: var(--muted);
}
.slash {
  margin: 0 5px;
  color: var(--faint);
  font-size: 13px;
}
.quota {
  font-size: 13px;
  color: var(--muted);
}
.sub {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.pct {
  color: var(--muted);
}
.tip {
  margin-left: 4px;
  font-weight: 500;
  color: var(--ring-color);
}

/* 紧凑模式：维护页顶部窄条 */
.storage-ring.compact {
  gap: 10px;
}
.compact .figure {
  font-size: 12px;
}
.compact .figure b {
  font-size: 14px;
}
.compact .unit,
.compact .slash,
.compact .quota,
.compact .sub {
  font-size: 11px;
}
.compact .sub {
  margin-top: 1px;
}
</style>
