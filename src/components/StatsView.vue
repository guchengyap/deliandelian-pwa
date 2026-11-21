<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { RecordEntry } from '../db/db'
import { allCompleted, dateKey } from '../db/records'
import {
  monthGrid,
  parseKey,
  WEEKDAY_CN,
  weekKeys,
  yearHeatmap,
} from '../lib/calendar'

const emit = defineEmits<{ back: [] }>()

const rows = ref<RecordEntry[]>([])
const today = dateKey()
const todayDate = parseKey(today)

async function load() {
  rows.value = await allCompleted()
}
onMounted(load)

/** date -> 当天完成项数（同一天同一项至多一条记录）。 */
const counts = computed(() => {
  const m = new Map<string, number>()
  for (const r of rows.value) m.set(r.date, (m.get(r.date) ?? 0) + 1)
  return m
})
const countOn = (key: string) => counts.value.get(key) ?? 0

/** 统一色阶：0 空；1–4 逐级加深。 */
function level(count: number): number {
  if (count <= 0) return 0
  if (count === 1) return 1
  if (count === 2) return 2
  if (count <= 4) return 3
  return 4
}

// ── 今日进度 ────────────────────────────────────────────
const props = defineProps<{ taskCount: number; refreshKey?: number; embedded?: boolean }>()
// 远端同步合并后由父组件自增 refreshKey，重新拉取。
watch(
  () => props.refreshKey,
  () => void load(),
)
const todayDone = computed(() => countOn(today))
const pct = computed(() =>
  props.taskCount ? Math.min(100, Math.round((todayDone.value / props.taskCount) * 100)) : 0,
)

// ── 本周七列 ────────────────────────────────────────────
const week = computed(() =>
  weekKeys().map((key) => ({
    key,
    count: countOn(key),
    label: WEEKDAY_CN[(parseKey(key).getDay() + 6) % 7],
  })),
)
const weekMax = computed(() => Math.max(1, ...week.value.map((d) => d.count)))
const barHeight = (count: number) =>
  count ? `${Math.max(6, Math.round((count / weekMax.value) * 100))}%` : '0'

// ── 月日历 ──────────────────────────────────────────────
const monthCells = computed(() =>
  monthGrid().map((key) =>
    key ? { key, day: parseKey(key).getDate(), count: countOn(key) } : null,
  ),
)

// ── 年历热力图 ──────────────────────────────────────────
const heat = yearHeatmap()
const heatCols = { gridTemplateColumns: `repeat(${heat.weeks.length}, 11px)` }
const cells = computed(() =>
  heat.weeks.flatMap((w) =>
    w.days.map((key, i) => ({
      key,
      future: w.future[i],
      level: w.future[i] ? 0 : level(countOn(key)),
      title: `${key} · ${countOn(key)} 项`,
    })),
  ),
)
</script>

<template>
  <div class="stats">
    <header v-if="!embedded" class="bar">
      <button type="button" class="back" @click="emit('back')">‹ 返回</button>
      <h1>统计</h1>
    </header>

    <section class="card">
      <div class="sec-head">
        <h2>今日进度</h2>
        <span class="num">{{ todayDone }} / {{ taskCount }}</span>
      </div>
      <div class="progress"><div class="fill" :style="{ width: pct + '%' }"></div></div>
      <p class="sub">{{ pct }}% · 今天是 {{ todayDate.getMonth() + 1 }} 月 {{ todayDate.getDate() }} 日</p>
    </section>

    <section class="card">
      <div class="sec-head"><h2>本周</h2><span class="tag">完成项数</span></div>
      <div class="weekchart">
        <div v-for="d in week" :key="d.key" class="wcol" :class="{ today: d.key === today }">
          <span class="wval">{{ d.count }}</span>
          <div class="wbar-wrap"><div class="wbar" :style="{ height: barHeight(d.count) }"></div></div>
          <span class="wlabel">{{ d.label }}</span>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="sec-head">
        <h2>月打卡</h2>
        <span class="tag">{{ todayDate.getFullYear() }} 年 {{ todayDate.getMonth() + 1 }} 月</span>
      </div>
      <div class="cal">
        <span v-for="w in WEEKDAY_CN" :key="w" class="cal-wd">{{ w }}</span>
        <span
          v-for="(c, i) in monthCells"
          :key="i"
          class="cal-cell"
          :class="[`lvl-${c ? level(c.count) : 0}`, { blank: !c, today: !!c && c.key === today }]"
        >
          <span v-if="c" class="daynum">{{ c.day }}</span>
        </span>
      </div>
      <div class="legend">少 <i class="lvl-1"></i><i class="lvl-2"></i><i class="lvl-3"></i><i class="lvl-4"></i> 多</div>
    </section>

    <section class="card">
      <div class="sec-head"><h2>本年度</h2><span class="tag">可左右滑动</span></div>
      <div class="heat-scroll">
        <div class="heat-inner">
          <div class="heat-months" :style="heatCols">
            <span v-for="(m, i) in heat.months" :key="i">{{ m }}</span>
          </div>
          <div class="heat-body">
            <div class="heat-wd">
              <span v-for="i in 7" :key="i">{{ i % 2 === 1 ? WEEKDAY_CN[i - 1] : '' }}</span>
            </div>
            <div class="heat-grid" :style="heatCols">
              <span
                v-for="(c, i) in cells"
                :key="i"
                class="heat-cell"
                :class="[{ future: c.future }, `lvl-${c.level}`]"
                :title="c.title"
              ></span>
            </div>
          </div>
        </div>
      </div>
      <div class="legend">少 <i class="lvl-1"></i><i class="lvl-2"></i><i class="lvl-3"></i><i class="lvl-4"></i> 多</div>
    </section>
  </div>
</template>

<style scoped>
.stats {
  width: 100%;
  max-width: 640px;
  margin: 0 auto;
  padding-bottom: 24px;
}
.bar {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 20px;
}
.bar h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 500;
  letter-spacing: -0.02em;
}
.back {
  border: none;
  background: none;
  color: var(--accent);
  font-size: 15px;
  cursor: pointer;
  padding: 6px 0;
}
.card {
    background: var(--card-glass);
  border: 1px solid var(--card-glass-border);
  -webkit-backdrop-filter: var(--card-blur);
  backdrop-filter: var(--card-blur);
  box-shadow: var(--card-glass-shadow);
  transition: background 0.5s ease, box-shadow 0.5s ease, border-color 0.5s ease;

  border: none;
  border-radius: var(--r-m);
  padding: 16px 18px;
  margin-bottom: 14px;
}
.sec-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 14px;
}
.sec-head h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 500;
}
.num,
.tag {
  font-size: 12px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.num {
  color: var(--accent);
}
.progress {
  height: 10px;
  border-radius: 999px;
  background: var(--accent-bg);
  overflow: hidden;
  transition: background 0.5s ease;
}
.fill {
  height: 100%;
  border-radius: 999px;
  background: var(--accent);
  transition: width 0.3s var(--ease), background 0.5s ease;
}
.sub {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--muted);
}
.weekchart {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 8px;
}
.wcol {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.wval {
  font-size: 11px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.wbar-wrap {
  width: 100%;
  height: 90px;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: var(--fill);
  border-radius: 6px;
  overflow: hidden;
}
.wbar {
  width: 56%;
  min-height: 2px;
  border-radius: 6px 6px 0 0;
  background: var(--accent);
  transition: height 0.3s var(--ease);
}
.wcol.today .wbar {
  background: var(--accent);
}
.wlabel {
  font-size: 12px;
  color: var(--muted);
}
.wcol.today .wlabel {
  color: var(--accent);
}
.cal {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 5px;
}
.cal-wd {
  text-align: center;
  font-size: 11px;
  color: var(--muted);
  padding-bottom: 2px;
}
.cal-cell {
  height: 40px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
}
.cal-cell.blank {
  visibility: hidden;
}
.cal-cell.today {
  outline: 1px solid var(--accent);
}
.daynum {
  color: var(--text);
  opacity: 0.75;
  font-variant-numeric: tabular-nums;
}
.heat-scroll {
  overflow-x: auto;
  padding-bottom: 6px;
  scrollbar-width: thin;
  scrollbar-color: rgba(60,60,67,0.25) transparent;
}
.heat-scroll::-webkit-scrollbar {
  height: 8px;
}
.heat-scroll::-webkit-scrollbar-thumb {
  background: rgba(60,60,67,0.25);
  border-radius: 999px;
}
.heat-scroll::-webkit-scrollbar-track {
  background: transparent;
}
.heat-inner {
  display: inline-block;
}
.heat-months {
  display: grid;
  gap: 3px;
  height: 15px;
  margin-left: 23px;
  margin-bottom: 5px;
  font-size: 10px;
  color: var(--muted);
  white-space: nowrap;
}
.heat-body {
  display: flex;
  gap: 3px;
}
.heat-wd {
  display: grid;
  grid-template-rows: repeat(7, 11px);
  gap: 3px;
  width: 20px;
  font-size: 9px;
  line-height: 11px;
  color: var(--muted);
}
.heat-grid {
  display: grid;
  grid-auto-flow: column;
  grid-template-rows: repeat(7, 11px);
  gap: 3px;
}
.heat-cell {
  width: 11px;
  height: 11px;
  border-radius: 2px;
}
.heat-cell.future {
  opacity: 0;
}
.legend {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 12px;
  font-size: 11px;
  color: var(--muted);
}
.legend i {
  width: 11px;
  height: 11px;
  border-radius: 2px;
  display: inline-block;
}
.lvl-0 {
  background: var(--fill);
}
.lvl-1 {
  background: rgba(10, 132, 255, 0.22);
}
.lvl-2 {
  background: rgba(10, 132, 255, 0.45);
}
.lvl-3 {
  background: rgba(10, 132, 255, 0.7);
}
.lvl-4 {
  background: var(--accent);
}
</style>
