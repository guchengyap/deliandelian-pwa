<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import type { PracticeTask, TaskGroup } from '../lib/tasks'
import TaskView from './TaskView.vue'

const props = defineProps<{
  groups: TaskGroup[]
  doneIds: Set<string>
  taskCount: number
}>()
const emit = defineEmits<{
  practice: [index: number]
  toggle: [itemId: string]
  autoDone: [itemId: string]
  checkAll: []
  uncheckAll: []
}>()

/** 摊平后的全局下标，供"单独练"跳转到跟练页定位。 */
const flat = computed<PracticeTask[]>(() => props.groups.flatMap((g) => g.tasks))
const doneCount = computed(() => flat.value.filter((t) => props.doneIds.has(t.item.id)).length)
const remainCount = computed(() => Math.max(0, props.taskCount - doneCount.value))
const pct = computed(() =>
  props.taskCount ? Math.min(100, Math.round((doneCount.value / props.taskCount) * 100)) : 0,
)
const checkingAll = ref(false)
function checkAll() {
  if (checkingAll.value || remainCount.value === 0) return
  checkingAll.value = true
  emit('checkAll')
  // 按钮防连点：父层完成后进度刷新，这里短暂锁定
  setTimeout(() => (checkingAll.value = false), 1200)
}

/** 一键取消确认弹窗：绝不直接清空，必须经过弹窗确认。 */
const showUncheck = ref(false)
function confirmUncheck() {
  showUncheck.value = false
  emit('uncheckAll')
}

function indexOf(key: string): number {
  return flat.value.findIndex((t) => t.key === key)
}
function toggleItem(itemId: string) {
  emit('toggle', itemId)
}
function openTask(key: string) {
  const i = indexOf(key)
  if (i >= 0) emit('practice', i)
}
function groupDone(g: TaskGroup): number {
  return g.tasks.filter((t) => props.doneIds.has(t.item.id)).length
}

/** 收起的项；默认全展开——这一页的定位就是"全部练法一次看全"。 */
const collapsed = reactive(new Set<string>())
function isExpanded(key: string): boolean {
  return !collapsed.has(key)
}
function toggleExpand(key: string) {
  if (collapsed.has(key)) collapsed.delete(key)
  else collapsed.add(key)
}
const allCollapsed = computed(
  () => flat.value.length > 0 && flat.value.every((t) => collapsed.has(t.key)),
)
function toggleAll() {
  if (allCollapsed.value) collapsed.clear()
  else flat.value.forEach((t) => collapsed.add(t.key))
}

/** 是否有可展示的媒体/说明，没有则给一句提示而不是空白卡片。 */
function hasBody(t: PracticeTask): boolean {
  const item = t.item
  return (
    (item.files?.length ?? 0) > 0 ||
    !!item.plan ||
    !!item.note ||
    (item.config != null && Object.keys(item.config).length > 0)
  )
}

/** 注意事项卡：单卡一次打卡，无「单独练」入口（内容只在当日页看）。 */
function isNotesCard(t: PracticeTask): boolean {
  return !!t.item.config?.notesCard
}
</script>

<template>
  <div class="today">
    <section class="progress-card glass">
      <div class="progress-top">
        <div>
          <p class="eyebrow">今天的练习</p>
          <p class="big"><span>{{ doneCount }}</span> <em>/ {{ taskCount }}</em></p>
        </div>
        <div class="top-right">
          <button
            type="button"
            class="fold-all"
            :class="{ open: !allCollapsed }"
            :aria-label="allCollapsed ? '全部展开' : '全部收起'"
            :title="allCollapsed ? '全部展开' : '全部收起'"
            @click="toggleAll"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M6 9l6 6 6-6"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
          <div class="ring" :style="{ '--p': pct + '%' }">
            <span>{{ pct }}%</span>
          </div>
        </div>
      </div>
      <div class="track"><div class="fill" :style="{ width: pct + '%' }"></div></div>
      <p class="tip">每一项都展开了完整练法：直接播放、看图，或点圆勾打卡</p>
      <button
        type="button"
        class="check-all"
        :disabled="remainCount === 0 || checkingAll"
        @click="checkAll"
      >
        {{ remainCount === 0 ? '今日已全部完成' : `一键打卡 · 剩 ${remainCount} 项` }}
      </button>
      <button
        v-if="doneCount > 0"
        type="button"
        class="uncheck-all"
        @click="showUncheck = true"
      >
        一键取消今日打卡
      </button>
    </section>

    <section v-for="g in groups" :key="g.key" class="group">
      <div class="group-head">
        <h2>{{ g.cn ? `${g.cn}、` : '' }}{{ g.title }}</h2>
        <span class="group-count">{{ groupDone(g) }}/{{ g.tasks.length }}</span>
      </div>
      <div class="cards">
        <article
          v-for="t in g.tasks"
          :key="t.key"
          class="item-card glass"
          :class="{ done: doneIds.has(t.item.id) }"
        >
          <div class="card-top">
            <button
              type="button"
              class="check"
              :aria-label="doneIds.has(t.item.id) ? '取消打卡' : '打卡'"
              @click="toggleItem(t.item.id)"
            >
              <svg v-if="doneIds.has(t.item.id)" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M5 12.5 10 17 19 7.5"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.4"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
            <button type="button" class="card-toggle" @click="toggleExpand(t.key)">
              <span class="no">{{ t.no }}</span>
              <span class="name">{{ t.item.title }}</span>
              <svg class="chev" :class="{ up: isExpanded(t.key) }" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M9 5l7 7-7 7"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
          </div>

          <div v-if="isExpanded(t.key)" class="card-body">
            <TaskView
              :task="t"
              :done="doneIds.has(t.item.id)"
              embedded
              @auto-done="emit('autoDone', $event)"
            />
            <p v-if="!hasBody(t)" class="no-content">这一项没有音频或图片，照上面的说明练即可。</p>
            <button v-if="!isNotesCard(t)" type="button" class="solo" @click="openTask(t.key)">到跟练页单独练 ›</button>
          </div>
        </article>
      </div>
    </section>

    <p v-if="!groups.length" class="empty">暂无练习内容，去自定义模式添加吧。</p>

    <!-- 一键取消确认弹窗：毛玻璃 + 黑色轻遮罩 -->
    <Teleport to="body">
      <Transition name="dlg">
        <div v-if="showUncheck" class="dlg-mask" @click.self="showUncheck = false">
          <div class="dlg" role="dialog" aria-modal="true" aria-label="一键取消今日打卡">
            <p class="dlg-title">一键取消今日打卡</p>
            <p class="dlg-text">确定要取消今日的所有打卡记录吗？</p>
            <div class="dlg-actions">
              <button type="button" class="dlg-btn ghost" @click="showUncheck = false">取消</button>
              <button type="button" class="dlg-btn primary" @click="confirmUncheck">确定</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.today {
  width: 100%;
  max-width: 640px;
  margin: 0 auto;
  padding-bottom: 12px;
}
.glass {
    background: var(--card-glass);
  border: 1px solid var(--card-glass-border);
  -webkit-backdrop-filter: var(--card-blur);
  backdrop-filter: var(--card-blur);
  box-shadow: var(--card-glass-shadow);
  transition: background 0.5s ease, box-shadow 0.5s ease, border-color 0.5s ease;

  border: none;
}
.progress-card {
  border-radius: var(--r-l);
  padding: 20px 20px 16px;
  margin-bottom: 26px;
}
.progress-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.eyebrow {
  margin: 0 0 4px;
  font-size: 13px;
  color: var(--muted);
}
.big {
  margin: 0;
  font-size: 15px;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.big span {
  font-size: 34px;
  font-weight: 500;
  letter-spacing: -0.03em;
}
.big em {
  font-style: normal;
  color: var(--muted);
  font-size: 16px;
}
.ring {
  width: 58px;
  height: 58px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: conic-gradient(var(--accent) var(--p), var(--accent-bg) 0);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  backdrop-filter: blur(20px) saturate(180%);
  box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.9), inset 0 -1px 2px rgba(255, 255, 255, 0.2), 0 20px 40px rgba(0, 0, 0, 0.04);
  position: relative;
  transition: background 0.5s ease, box-shadow 0.5s ease;
}
.ring::before {
  content: '';
  position: absolute;
  inset: 5px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.3);
}
.ring span {
  position: relative;
  font-size: 12px;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.track {
  height: 6px;
  border-radius: 99px;
  background: var(--accent-bg);
  overflow: hidden;
  transition: background 0.5s ease;
}
.fill {
  height: 100%;
  border-radius: 99px;
  background: var(--accent);
  transition: width 0.3s var(--ease), background 0.5s ease;
}
.tip {
  margin: 12px 0 0;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.4;
}
.top-right {
  display: flex;
  align-items: center;
  gap: 10px;
}
.fold-all {
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 50%;
  background: var(--fill);
  color: var(--muted);
  display: grid;
  place-items: center;
  cursor: pointer;
  padding: 0;
  transition: transform 0.15s ease;
}
.fold-all svg {
  width: 14px;
  height: 14px;
  transition: transform 0.25s var(--ease);
}
.fold-all.open svg {
  transform: rotate(180deg);
}
.fold-all:active {
  transform: scale(0.92);
}
.check-all {
  width: 100%;
  margin-top: 10px;
  border: none;
  background: var(--accent);
  color: #fff;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 500;
  padding: 9px 14px;
  cursor: pointer;
  transition: opacity 0.25s ease, transform 0.15s ease;
}
.check-all:active {
  transform: scale(0.97);
}
.check-all:disabled {
  opacity: 0.55;
  cursor: default;
}
.uncheck-all {
  display: block;
  margin: 12px auto 0;
  border: none;
  background: none;
  padding: 2px 10px;
  font-size: 13px;
  color: var(--muted);
  letter-spacing: 0.02em;
  cursor: pointer;
  transition: opacity 0.2s ease;
}
.uncheck-all:active {
  opacity: 0.55;
}
.group {
  margin-bottom: 22px;
}
.group-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 0 6px 8px;
}
.group-head h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  color: var(--text);
}
.group-count {
  font-size: 12px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.cards {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.item-card {
  border-radius: var(--r-m);
  overflow: hidden;
}
.card-top {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px 10px 12px;
}
.check {
  flex: 0 0 auto;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 1.6px solid var(--muted);
  background: transparent;
  color: #fff;
  display: grid;
  place-items: center;
  cursor: pointer;
  padding: 0;
  transition: background 0.3s var(--ease), border-color 0.3s var(--ease);
}
.check svg {
  width: 16px;
  height: 16px;
}
.item-card.done .check {
  background: var(--accent);
  border-color: var(--accent);
  animation: check-pop 0.35s var(--ease);
}
@keyframes check-pop {
  0% { transform: scale(0.6); }
  60% { transform: scale(1.18); }
  100% { transform: scale(1); }
}
.card-toggle {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  border: none;
  background: none;
  color: var(--text);
  cursor: pointer;
  padding: 2px 0;
  text-align: left;
}
.no {
  flex: 0 0 auto;
  width: 22px;
  font-size: 13px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.name {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.item-card.done .name {
  color: var(--muted);
}
.chev {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  color: var(--faint);
  transition: transform 0.2s ease;
}
.chev.up {
  transform: rotate(90deg);
}
.card-body {
  border-top: 1px solid var(--line);
  padding: 14px 14px 12px;
}
.no-content {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
  line-height: 1.5;
}
.solo {
  display: inline-block;
  margin-top: 12px;
  border: none;
  background: var(--fill);
  color: var(--accent);
  border-radius: 999px;
  font-size: 12px;
  padding: 5px 12px;
  cursor: pointer;
}
.empty {
  text-align: center;
  color: var(--muted);
  font-size: 14px;
  padding: 48px 0;
}

/* ── 一键取消确认弹窗 ─────────────────────────── */
.dlg-mask {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.3);
}
.dlg {
  width: min(320px, 100%);
  border-radius: 22px;
  padding: 22px 20px 16px;
  text-align: center;
  background: var(--card-glass);
  -webkit-backdrop-filter: blur(40px) saturate(160%);
  backdrop-filter: blur(40px) saturate(160%);
  border: 1px solid var(--card-glass-border);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.55),
    inset 0 0 0 1px rgba(255, 255, 255, 0.14),
    0 24px 64px rgba(0, 0, 0, 0.22);
}
.dlg-title {
  margin: 0 0 6px;
  font-size: 12px;
  color: var(--muted);
  letter-spacing: 0.06em;
}
.dlg-text {
  margin: 0;
  font-size: 15px;
  color: var(--text);
  line-height: 1.5;
}
.dlg-actions {
  display: flex;
  gap: 10px;
  margin-top: 18px;
}
.dlg-btn {
  flex: 1 1 0;
  border: none;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 500;
  padding: 10px 0;
  cursor: pointer;
  transition: transform 0.15s ease, opacity 0.2s ease;
}
.dlg-btn:active {
  transform: scale(0.97);
}
.dlg-btn.ghost {
  background: var(--fill);
  color: var(--text);
}
.dlg-btn.primary {
  background: var(--accent);
  color: #fff;
  box-shadow: 0 6px 18px var(--accent-bg);
}
/* 弹窗过渡：遮罩淡入淡出，卡片轻微上浮缩放 */
.dlg-enter-active,
.dlg-leave-active {
  transition: opacity 0.22s ease;
}
.dlg-enter-active .dlg,
.dlg-leave-active .dlg {
  transition: transform 0.26s var(--ease), opacity 0.2s ease;
}
.dlg-enter-from,
.dlg-leave-to {
  opacity: 0;
}
.dlg-enter-from .dlg,
.dlg-leave-to .dlg {
  transform: translateY(12px) scale(0.96);
  opacity: 0;
}
</style>
