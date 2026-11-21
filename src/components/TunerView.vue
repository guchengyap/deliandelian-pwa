<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { PitchEngine } from '../lib/tuner'

/**
 * 音调仪：专业级音高轨迹监测器。
 *
 * 结构（自下而上）：
 *   1. 长轨道 C2~C7 毛玻璃色带（rAF 平移，行高 = 视口高/36，恒显 3 个八度）
 *   2. Canvas 轨迹层（pointer-events:none，音块/滑音折线，时间轴向左推移）
 *   3. 中央 1.5px 基准线
 *   4. 右侧极细滑块（拖动暂停自动跟随，松手 2s 后有新音高则恢复）
 *
 * 高频渲染全部走 rAF 直写 DOM/Canvas，零 Vue 响应式；rowH 等低频值才用 ref。
 */
const engine = new PitchEngine()
// 临时调试口：实机验证用，读取 state.frequency / state.note / a4
;(window as unknown as Record<string, unknown>).__tunerDebug = engine

const viewportEl = ref<HTMLElement | null>(null)
const stripEl = ref<HTMLElement | null>(null)
const canvasEl = ref<HTMLCanvasElement | null>(null)
const lineEl = ref<HTMLElement | null>(null)
const thumbEl = ref<HTMLElement | null>(null)

/** 每个半音高度（px）= 视口高 / 36，resize 时低频更新 */
const rowH = ref(14)

const running = ref(false)
const starting = ref(false)
const failed = ref(false)
const outOfRange = ref(false)
const manualMode = ref(false)
const showA4 = ref(false)

// A4 参考频率（设备偏好，存 localStorage）
const A4_KEY = 'tuner-a4'
const a4 = ref(Number(localStorage.getItem(A4_KEY)) || 440)
function setA4(hz: number) {
  a4.value = hz
  engine.setA4(hz)
  localStorage.setItem(A4_KEY, String(hz))
  showA4.value = false
}
engine.setA4(a4.value)

// ── 长轨道：C2(midi 36) ~ C7(midi 96)，高音在上 ──────────
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const BLACK = new Set([1, 3, 6, 8, 10])
const MIDI_LO = 36
const MIDI_HI = 96
interface Row {
  name: string
  octave: number
  black: boolean
}
const rows: Row[] = []
for (let midi = MIDI_HI; midi >= MIDI_LO; midi--) {
  const pc = ((midi % 12) + 12) % 12
  rows.push({ name: NAMES[pc], octave: Math.floor(midi / 12) - 1, black: BLACK.has(pc) })
}

/** midi → 长轨道 Y（px，取该音名带的中心；C7 顶为 0） */
function trackYOfMidi(m: number): number {
  return (MIDI_HI - m + 0.5) * rowH.value
}
/** 频率 → midi 浮点 */
function midiOfFreq(f: number): number {
  return 69 + 12 * Math.log2(f / a4.value)
}

// ── 视图状态（rAF 内可变量） ────────────────────────────
let viewY = 0 // 长轨道当前 translateY
let targetY = 0 // 目标 translateY（自动=对准音高；手动=滑块位置）
let drawId = 0

// ── Canvas 轨迹缓冲（50ms 一格：橙色吸附块 + 白色真实音高线） ─
const CELL_MS = 50
const BLOCK_W = 9
const BLOCK_GAP = 0 // 方块紧挨排列（参考专业调音器样式）
interface Pt {
  t: number
  /** 吸附到最近音名带中心的 Y（橙色方块） */
  snapY: number
  /** 真实音高（未吸附 midi 浮点）的 Y（白色细线） */
  fineY: number
}
let pts: Pt[] = []
let lastSampleAt = 0

/** 橙色（参考图配色，固定不随主题） */
const BLOCK_COLOR = 'rgba(230, 145, 56, 0.92)'
const LINE_COLOR = 'rgba(255, 255, 255, 0.9)'

function resizeCanvas(): void {
  const cv = canvasEl.value
  const vp = viewportEl.value
  if (!cv || !vp) return
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  cv.width = vp.clientWidth * dpr
  cv.height = vp.clientHeight * dpr
  cv.style.width = vp.clientWidth + 'px'
  cv.style.height = vp.clientHeight + 'px'
}

/** 视口尺寸/行高变化时重算 */
function relayout(): void {
  const vp = viewportEl.value
  if (!vp) return
  rowH.value = vp.clientHeight / 36
  resizeCanvas()
  targetY = manualMode.value ? targetY : clampTarget(targetY)
}

function clampTarget(y: number): number {
  // 目标视图中心 midi 限制在轨道范围内
  const vp = viewportEl.value
  if (!vp) return y
  const center = vp.clientHeight / 2
  const min = center - trackYOfMidi(MIDI_LO) // 最低（C2 对中）
  const max = center - trackYOfMidi(MIDI_HI) // 最高（C7 对中）
  return Math.min(min, Math.max(max, y))
}

// ── 主渲染循环 ─────────────────────────────────────────
function frame(): void {
  drawId = requestAnimationFrame(frame)
  const now = performance.now()
  const s = engine.state
  const vp = viewportEl.value
  const strip = stripEl.value
  if (!vp || !strip) return
  const center = vp.clientHeight / 2

  // 1. 计算目标视图
  const valid = s.running && s.holdAlpha > 0 && s.frequency > 0
  if (valid && !manualMode.value) {
    const m = midiOfFreq(s.frequency)
    if (m >= MIDI_LO && m <= MIDI_HI) {
      if (outOfRange.value) outOfRange.value = false
      targetY = center - trackYOfMidi(m)
    } else if (!outOfRange.value) {
      outOfRange.value = true // 低于 C2 / 高于 C7：卷帘停住
    }
  }

  // 2. 平滑趋近目标并直写轨道位移（无 CSS transition，画布同步无漂移）
  viewY += (targetY - viewY) * 0.22
  strip.style.transform = `translateY(${viewY}px)`

  // 3. 滑块拇指跟随当前视图中心 midi
  const thumb = thumbEl.value
  if (thumb) {
    const midiAtCenter = MIDI_HI + 0.5 - (center - viewY) / rowH.value
    const frac = 1 - (midiAtCenter - MIDI_LO) / (MIDI_HI - MIDI_LO) // 0=顶 C7
    const trackLen = vp.clientHeight - 56
    thumb.style.transform = `translateY(${Math.min(trackLen - 40, Math.max(0, frac * trackLen))}px)`
  }

  // 4. 基准线音准色
  if (lineEl.value) lineEl.value.classList.toggle('in-tune', valid && Math.abs(s.cents) <= 5)

  // 5. 采样：每 50ms 记录一格（吸附音名 + 真实音高双坐标）
  if (valid && !outOfRange.value && now - lastSampleAt >= CELL_MS) {
    lastSampleAt = now
    const m = midiOfFreq(s.frequency)
    const nearest = Math.round(m)
    // 橙色块：吸附最近音名带中心（绝不落在两音名之间）
    const snapY = trackYOfMidi(nearest)
    // 白线：真实音高微动（音分偏差换算为带内偏移，偏高上移）
    const fineY = snapY - (m - nearest) * rowH.value
    pts.push({ t: now, snapY, fineY })
  }
  const cv = canvasEl.value
  if (!cv) return
  const cell = BLOCK_W + BLOCK_GAP
  const maxAge = ((vp.clientWidth / 2 + cell) / cell) * CELL_MS + 400
  while (pts.length && now - pts[0].t > maxAge) pts.shift()

  // 6. 绘制：橙色吸附方块矩阵 + 白色真实音高折线
  const g = cv.getContext('2d')
  if (!g) return
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.clearRect(0, 0, cv.width / dpr, cv.height / dpr)
  const cx = vp.clientWidth / 2
  const bh = rowH.value * 0.86
  // 橙色方块（吸附音名带）
  g.fillStyle = BLOCK_COLOR
  for (const p of pts) {
    const ageCells = (now - p.t) / CELL_MS
    const x = cx + BLOCK_GAP - ageCells * cell
    if (x + BLOCK_W < 0) continue
    const y = p.snapY + viewY - bh / 2
    g.fillRect(x, y, BLOCK_W, bh)
  }
  // 白色细线（真实音高，不吸附；仅在采样点覆盖范围内绘制）
  if (pts.length > 1) {
    g.strokeStyle = LINE_COLOR
    g.lineWidth = 1.5
    g.lineJoin = 'round'
    g.beginPath()
    let started = false
    for (const p of pts) {
      const ageCells = (now - p.t) / CELL_MS
      const x = cx + BLOCK_GAP - ageCells * cell + BLOCK_W / 2
      if (x < 0) {
        if (started) {
          g.stroke()
          started = false
        }
        continue
      }
      const y = p.fineY + viewY
      if (!started) {
        g.moveTo(x, y)
        started = true
      } else {
        g.lineTo(x, y)
      }
    }
    if (started) g.stroke()
  }
}

// ── 右侧滑块：手动拖动暂停自动跟随 ──────────────────────
let resumeTimer = 0
function onSliderDown(e: PointerEvent): void {
  if (!running.value) return
  manualMode.value = true
  clearTimeout(resumeTimer)
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  onSliderMove(e)
}
function onSliderMove(e: PointerEvent): void {
  if (!manualMode.value) return
  const vp = viewportEl.value
  const track = e.currentTarget as HTMLElement
  if (!vp) return
  const rect = track.getBoundingClientRect()
  const frac = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))
  const midi = MIDI_HI - frac * (MIDI_HI - MIDI_LO)
  targetY = clampTarget(vp.clientHeight / 2 - trackYOfMidi(midi))
}
function onSliderUp(): void {
  // 松手 2s 后检测到新声音自动恢复跟随
  clearTimeout(resumeTimer)
  resumeTimer = window.setTimeout(() => {
    manualMode.value = false
  }, 2000)
}

async function toggleStart() {
  if (running.value) {
    stopEngine()
    return
  }
  starting.value = true
  failed.value = false
  // 用户手势内初始化 AudioContext 并请求麦克风（iOS Safari 要求）。
  const ok = await engine.start()
  starting.value = false
  if (!ok) {
    failed.value = true
    return
  }
  running.value = true
  manualMode.value = false
  pts = []
  drawId = requestAnimationFrame(frame)
}

/** 彻底释放麦克风与绘制循环；供按钮、切页、页面隐藏调用。 */
function stopEngine(): void {
  if (drawId) cancelAnimationFrame(drawId)
  drawId = 0
  engine.stop()
  clearTimeout(resumeTimer)
  running.value = false
  manualMode.value = false
  outOfRange.value = false
  pts = []
  const cv = canvasEl.value
  const g = cv?.getContext('2d')
  if (g) g.clearRect(0, 0, cv!.width, cv!.height)
  resetStrip()
}

/** 复位卷帘到轨道中段 */
function resetStrip(): void {
  const vp = viewportEl.value
  if (!vp) return
  const center = vp.clientHeight / 2
  viewY = targetY = center - trackYOfMidi((MIDI_HI + MIDI_LO) / 2)
  const strip = stripEl.value
  if (strip) strip.style.transform = `translateY(${viewY}px)`
  if (lineEl.value) lineEl.value.classList.remove('in-tune')
}

defineExpose({ stopEngine })

onMounted(() => {
  document.addEventListener('visibilitychange', onHidden)
  window.addEventListener('pagehide', onHidden)
  window.addEventListener('resize', onResize)
  relayout()
  resetStrip()
})
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onHidden)
  window.removeEventListener('pagehide', onHidden)
  window.removeEventListener('resize', onResize)
  stopEngine()
})
function onHidden() {
  if (document.hidden) stopEngine()
}
function onResize() {
  relayout()
  if (!drawId) resetStrip()
}
</script>

<template>
  <div class="tuner">
    <!-- 视口：60vh，恒显 36 个半音（3 个八度） -->
    <section ref="viewportEl" class="viewport">
      <!-- 长轨道 C2 ~ C7 毛玻璃色带 -->
      <div ref="stripEl" class="strip">
        <div
          v-for="r in rows"
          :key="r.name + r.octave"
          class="lane"
          :class="{ black: r.black }"
          :style="{ height: rowH + 'px' }"
        >
          <span class="label">{{ r.name }}{{ r.octave }}</span>
        </div>
      </div>

      <!-- Canvas 音高轨迹层（不阻挡触摸） -->
      <canvas ref="canvasEl" class="trail" aria-hidden="true"></canvas>

      <!-- 中央极细基准线 -->
      <div ref="lineEl" class="needle" aria-hidden="true"></div>

      <!-- 上下渐隐 -->
      <div class="fade top" aria-hidden="true"></div>
      <div class="fade bottom" aria-hidden="true"></div>

      <!-- 右侧极细滑块（iOS 原生滚动条质感） -->
      <div
        class="slider"
        @pointerdown="onSliderDown"
        @pointermove="onSliderMove"
        @pointerup="onSliderUp"
        @pointercancel="onSliderUp"
      >
        <div class="slider-track">
          <div ref="thumbEl" class="slider-thumb"></div>
        </div>
      </div>
    </section>

    <!-- 视口外控制区 -->
    <section class="controls">
      <div class="controls-row">
        <button
          type="button"
          class="rec"
          :class="{ on: running }"
          :disabled="starting"
          :aria-label="running ? '停止监听' : '开始监听'"
          @click="toggleStart"
        >
          <span class="rec-inner"></span>
        </button>
        <button type="button" class="gear" aria-label="A4 参考频率设置" @click="showA4 = true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3.2" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.1-1.55 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1.1 1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z" />
          </svg>
        </button>
      </div>
      <p v-if="starting" class="status">正在开启麦克风…</p>
      <p v-else-if="failed" class="status err">无法访问麦克风，请检查权限设置。</p>
      <p v-else-if="outOfRange" class="status warn">超出范围（C2 ~ C7）</p>
      <p v-else-if="manualMode" class="status">手动浏览中 · 松手后检测到声音将恢复跟随</p>
      <p v-else-if="!running" class="status">点击按钮开始监听</p>
      <p v-else class="status">对着麦克风唱一个长音</p>
    </section>

    <!-- A4 弹窗 -->
    <div v-if="showA4" class="modal-mask" @click.self="showA4 = false">
      <div class="modal">
        <h2>A4 参考频率</h2>
        <div class="seg">
          <button
            v-for="hz in [432, 440, 442]"
            :key="hz"
            type="button"
            :class="{ active: a4 === hz }"
            @click="setA4(hz)"
          >
            {{ hz }} Hz
          </button>
        </div>
        <button type="button" class="modal-close" @click="showA4 = false">完成</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tuner {
  width: 100%;
  max-width: 640px;
  margin: 0 auto;
  padding-bottom: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ── 视口：60vh，36 半音 × (60vh/36) ── */
.viewport {
  position: relative;
  height: 60vh;
  border-radius: var(--r-m);
  overflow: hidden;
  background: var(--card-glass);
  border: 1px solid var(--card-glass-border);
  -webkit-backdrop-filter: var(--card-blur);
  backdrop-filter: var(--card-blur);
  box-shadow: var(--card-glass-shadow);
  transition: background 0.5s ease, box-shadow 0.5s ease, border-color 0.5s ease;
  touch-action: none;
}

/* 长轨道（rAF 直写 transform，无 CSS transition） */
.strip {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  will-change: transform;
}
/* 白键：白色微透明毛玻璃带 */
.lane {
  position: relative;
  display: flex;
  align-items: center;
  background: rgba(255, 255, 255, 0.4);
  border-top: 1px solid rgba(0, 0, 0, 0.05);
}
.lane:first-child {
  border-top: none;
}
/* 黑键：更深的暗色带，边界清晰如钢琴卷帘 */
.lane.black {
  background: rgba(0, 0, 0, 0.08);
}
.label {
  padding-left: 16px;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: rgba(60, 60, 67, 0.85); /* 浅色带用深灰字 */
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.lane.black .label {
  color: rgba(255, 255, 255, 0.85); /* 深色带用浅色字 */
}

/* Canvas 轨迹层：铺满视口，不阻挡触摸 */
.trail {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 2;
}

/* 中央基准线：1.5px accent，微光降到极淡（不再遮挡色带） */
.needle {
  position: absolute;
  left: 50%;
  top: 0;
  bottom: 0;
  width: 1.5px;
  transform: translateX(-50%);
  background: color-mix(in srgb, var(--accent-color) 80%, transparent);
  box-shadow: 0 0 6px 0 color-mix(in srgb, var(--accent-color) 10%, transparent);
  transition: background 0.3s var(--ease), box-shadow 0.3s var(--ease);
  pointer-events: none;
  z-index: 3;
}
.needle.in-tune {
  background: #34c759;
  box-shadow: 0 0 12px 1px rgba(52, 199, 89, 0.55);
}

/* 上下渐隐 */
.fade {
  position: absolute;
  left: 0;
  right: 0;
  height: 56px;
  pointer-events: none;
  z-index: 4;
}
.fade.top {
  top: 0;
  background: linear-gradient(to bottom, var(--bg) 8%, transparent);
}
.fade.bottom {
  bottom: 0;
  background: linear-gradient(to top, var(--bg) 8%, transparent);
}

/* ── 右侧滑块：极细、若隐若现 ── */
.slider {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 28px;
  z-index: 5;
  display: flex;
  justify-content: center;
  cursor: ns-resize;
  touch-action: none;
}
.slider-track {
  position: relative;
  width: 4px;
  margin: 28px 0;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent-color) 14%, transparent);
}
.slider-thumb {
  position: absolute;
  left: 50%;
  top: 0;
  width: 4px;
  height: 40px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.45);
  box-shadow: 0 0 6px color-mix(in srgb, var(--accent-color) 30%, transparent);
  transform-origin: center;
  will-change: transform;
}
.slider:active .slider-thumb {
  background: color-mix(in srgb, var(--accent-color) 60%, white 20%);
}

/* ── 视口外控制区 ── */
.controls {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.controls-row {
  display: flex;
  align-items: center;
  gap: 14px;
}
.rec {
  width: 54px;
  height: 54px;
  border-radius: 50%;
  border: 2.5px solid var(--card-glass-border);
  background: var(--glass);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  backdrop-filter: blur(24px) saturate(180%);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.09);
  cursor: pointer;
  display: grid;
  place-items: center;
  transition: transform 0.2s var(--ease), box-shadow 0.3s var(--ease);
}
.rec:active {
  transform: scale(0.93);
}
.rec-inner {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: #ff3b30;
  box-shadow: 0 4px 14px rgba(255, 59, 48, 0.4);
  transition: all 0.3s var(--ease);
}
.rec.on .rec-inner {
  animation: pulse 1.2s ease-in-out infinite;
}
.rec:disabled {
  opacity: 0.5;
  cursor: default;
}
@keyframes pulse {
  0%,
  100% {
    box-shadow: 0 4px 14px rgba(255, 59, 48, 0.4);
  }
  50% {
    box-shadow: 0 4px 22px rgba(255, 59, 48, 0.65);
  }
}
.gear {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: 50%;
  background: var(--glass);
  color: var(--muted);
  cursor: pointer;
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  backdrop-filter: blur(24px) saturate(180%);
}
.status {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}
.status.err {
  color: #e0300e;
}
.status.warn {
  color: #b25000;
}

/* ── A4 弹窗 ── */
.modal-mask {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: rgba(0, 0, 0, 0.3);
  display: grid;
  place-items: center;
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
}
.modal {
  width: min(320px, 86vw);
  border-radius: var(--r-m);
  background: var(--card-glass);
  border: 1px solid var(--card-glass-border);
  -webkit-backdrop-filter: var(--card-blur);
  backdrop-filter: var(--card-blur);
  box-shadow: var(--card-glass-shadow);
  padding: 22px 20px;
  text-align: center;
}
.modal h2 {
  margin: 0 0 16px;
  font-size: 16px;
  font-weight: 500;
  color: var(--text);
}
.seg {
  display: flex;
  background: var(--fill);
  border-radius: var(--r-s);
  padding: 3px;
}
.seg button {
  flex: 1;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  font-size: 13px;
  padding: 8px 0;
  cursor: pointer;
  transition: all 0.3s var(--ease);
}
.seg button.active {
  background: var(--card);
  color: var(--text);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
}
.modal-close {
  margin-top: 16px;
  width: 100%;
  border: none;
  border-radius: var(--r-s);
  background: var(--accent);
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  padding: 10px 0;
  cursor: pointer;
}
</style>
