<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { db, seedIfEmpty, type Level1Item, type Level2Item } from './db/db'
import { completedIdsOn, dateKey, setCompletion, toggleCompletion, uncompleteAllOn } from './db/records'
import { stopAll } from './lib/audioSession'
import { buildTaskGroups, flattenTasks } from './lib/tasks'
import { auth, initAuth } from './lib/auth'
import {
  canWriteCloud,
  cloudAvailable,
  fetchAdminSpace,
  fetchMySpace,
  resetMySpace,
} from './lib/cloudSpace'
import EditView from './components/EditView.vue'
import AuthView from './components/AuthView.vue'
import HelpView from './components/HelpView.vue'
import SettingsView from './components/SettingsView.vue'
import StatsView from './components/StatsView.vue'
import TaskView from './components/TaskView.vue'
import TodayView from './components/TodayView.vue'
import TunerView from './components/TunerView.vue'

const base = import.meta.env.BASE_URL

type Tab = 'stats' | 'today' | 'practice' | 'tuner'
type Overlay = 'none' | 'settings' | 'help' | 'edit'

const groups = ref<ReturnType<typeof buildTaskGroups>>([])
const tasks = computed(() => flattenTasks(groups.value))
const current = ref(0)
const tab = ref<Tab>('stats')
const overlay = ref<Overlay>('none')
const ready = ref(false)
const reloadKey = ref(0)
const statsKey = ref(0)
/** 登录/注册弹层 */
const showAuth = ref(false)
/** 是否处于维护模式（供设置页开关点亮）。 */
const maintaining = computed(() => overlay.value === 'edit')

/** 当前日期（响应式）：挂后台跨天后回前台/操作前自动修正，避免打卡记错日期。 */
const today = ref(dateKey())
const doneToday = ref<Set<string>>(new Set())

const task = computed(() => tasks.value[current.value])
const groupOfCurrent = computed(() =>
  groups.value.find((g) => g.tasks.some((t) => t.key === task.value?.key)),
)
const isDone = computed(() => !!task.value && doneToday.value.has(task.value.item.id))

/** 日期变了才刷新；同日不重复查库。 */
function refreshToday() {
  const k = dateKey()
  if (k !== today.value) {
    today.value = k
    void loadToday()
  }
}
// 挂后台过夜回前台：立即修正日期
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshToday()
})

async function loadToday() {
  doneToday.value = await completedIdsOn(today.value)
}

/** ── 轻提示 toast：每次打卡/取消都有文字反馈，杜绝"点了没反应"的困惑 ── */
const toastMsg = ref('')
let toastTimer: number | undefined
function showToast(msg: string) {
  toastMsg.value = msg
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toastMsg.value = ''), 1800)
}

/** 跟练页"打卡后自动跳下一项"的定时器；等待期按钮锁定。 */
const jumping = ref(false)
let jumpTimer: number | undefined
function cancelJump() {
  window.clearTimeout(jumpTimer)
  jumping.value = false
}

/** 打卡互斥锁：进行中的打卡未落库前忽略再次点击，防止并发双写。 */
let checkBusy = false
const toggleBusy = new Set<string>()
const autoBusy = new Set<string>()

/**
 * 打卡冷却：同一项操作成功后 900ms 内忽略再次点击。
 * 根治"打不上卡"：手机上响应慢/手快连点两下 = 打卡又取消 = 等于没打；
 * 跟练页打卡后 0.7s 自动跳转期间，误点"已完成"会取消打卡并卡住本项。
 * 冷却按 item 隔离——自动跳到下一项后立即可打卡，不受影响。
 */
const lastToggleAt = new Map<string, number>()
const COOLDOWN_MS = 900
function inCooldown(itemId: string): boolean {
  return Date.now() - (lastToggleAt.get(itemId) ?? 0) < COOLDOWN_MS
}

async function markDone(itemId: string, completed: boolean) {
  await setCompletion(itemId, today.value, completed)
  await afterChange()
}

async function toggleDone() {
  if (!task.value || checkBusy || jumping.value) return
  const itemId = task.value.item.id
  if (inCooldown(itemId)) return
  checkBusy = true
  cancelJump()
  refreshToday()
  try {
    const now = await toggleCompletion(itemId, today.value)
    lastToggleAt.set(itemId, Date.now())
    await afterChange()
    if (now) {
      const last = current.value >= tasks.value.length - 1
      if (last) {
        showToast(`已打卡 · 今日全部完成（${doneToday.value.size}/${tasks.value.length}）`)
      } else {
        showToast(`已打卡 ${doneToday.value.size}/${tasks.value.length}`)
        // 短暂停留让"已完成"反馈可见，再自动进入下一项；期间按钮锁定防误触取消。
        const idx = current.value
        jumping.value = true
        jumpTimer = window.setTimeout(() => {
          jumping.value = false
          if (tab.value === 'practice' && current.value === idx) go(1)
        }, 700)
      }
    } else {
      showToast('已取消打卡')
    }
  } catch {
    // 落库失败（存储紧张等）：明确告知，而不是静默无反应。
    showToast('打卡失败，请重试')
  } finally {
    checkBusy = false
  }
}

/** 第三页音频/轮次播完触发：自动打卡（幂等，setCompletion 内部去重）。 */
async function onAutoDone(itemId: string) {
  if (autoBusy.has(itemId)) return
  autoBusy.add(itemId)
  refreshToday()
  try {
    await markDone(itemId, true)
    showToast(`已自动打卡 ${doneToday.value.size}/${tasks.value.length}`)
  } catch {
    showToast('自动打卡失败，请重试')
  } finally {
    autoBusy.delete(itemId)
  }
}

/** 当日页圆勾：切换完成状态（带冷却防连点翻转 + 失败提示）。 */
async function onToggleItem(itemId: string) {
  if (toggleBusy.has(itemId) || inCooldown(itemId)) return
  toggleBusy.add(itemId)
  refreshToday()
  try {
    const now = await toggleCompletion(itemId, today.value)
    lastToggleAt.set(itemId, Date.now())
    await afterChange()
    showToast(now ? '已打卡' : '已取消打卡')
  } catch {
    showToast('打卡失败，请重试')
  } finally {
    toggleBusy.delete(itemId)
  }
}

/**
 * 当日页「一键打卡」：把当日全部未完成项一次打满。
 * 逐项落库，单项失败不中断其余项，结束后汇总提示。
 */
async function onCheckAll() {
  const pending = tasks.value.filter((t) => !doneToday.value.has(t.item.id))
  if (!pending.length) return
  let ok = 0
  let failed = 0
  for (const t of pending) {
    try {
      await setCompletion(t.item.id, today.value, true)
      ok += 1
    } catch {
      failed += 1
    }
  }
  await afterChange()
  if (failed === 0) showToast(`一键打卡完成 · 今日全部完成（${doneToday.value.size}/${tasks.value.length}）`)
  else if (ok > 0) showToast(`已打卡 ${ok} 项，${failed} 项失败请重试`)
  else showToast('打卡失败，请重试')
}

/** 当日页「一键取消」：经弹窗确认后清空今日全部打卡（逐项走同步链路）。 */
let uncheckAllBusy = false
async function onUncheckAll() {
  if (uncheckAllBusy) return
  uncheckAllBusy = true
  refreshToday()
  try {
    const n = await uncompleteAllOn(today.value)
    await afterChange()
    showToast(n ? `已取消今日全部打卡（${n} 项）` : '今日暂无打卡记录')
  } catch {
    showToast('取消失败，请重试')
  } finally {
    uncheckAllBusy = false
  }
}

async function afterChange() {
  await loadToday()
  statsKey.value += 1
}

function go(delta: number) {
  const next = current.value + delta
  if (next < 0 || next >= tasks.value.length) return
  cancelJump()
  stopAll()
  current.value = next
}

/** 当日页点某项：跳到跟练页并定位到它。 */
function practiceIndex(index: number) {
  if (index < 0 || index >= tasks.value.length) return
  cancelJump()
  stopAll()
  current.value = index
  tab.value = 'practice'
}

async function reloadCatalog() {
  const [l1, l2] = await Promise.all([
    db.level1.orderBy('order').toArray(),
    db.level2.orderBy('order').toArray(),
  ])
  groups.value = buildTaskGroups(l1, l2)
  reloadKey.value += 1
}

/** 云端空间数据覆盖本地目录（整体替换，保持 id 稳定以免打卡历史断链）。 */
async function applySpace(data: { level1: Level1Item[]; level2: Level2Item[] }) {
  await db.transaction('rw', db.level1, db.level2, async () => {
    await db.level1.clear()
    await db.level2.clear()
    await db.level1.bulkAdd(data.level1)
    await db.level2.bulkAdd(data.level2)
  })
}

/**
 * 启动时从云端拉取练习内容：
 * - 游客 → admin 默认模板空间（只读）
 * - 登录用户 → 专属空间（后端首次自动复制模板）
 * 云端不可达时静默回退本地缓存（seedIfEmpty 已兜底），离线也能用。
 */
async function loadCloudCatalog() {
  if (!cloudAvailable) return
  try {
    const resp = auth.user ? await fetchMySpace() : await fetchAdminSpace()
    await applySpace(resp.data)
  } catch {
    // 忽略：走本地缓存
  }
}

/** 恢复默认模板（登录用户）：用模板覆盖我的空间并刷新界面。 */
async function onRestoreDefault() {
  if (!auth.user) return
  try {
    const data = await resetMySpace()
    await applySpace(data)
    await reloadCatalog()
    await loadToday()
    current.value = Math.min(current.value, Math.max(0, tasks.value.length - 1))
    showToast('已恢复默认模板')
  } catch (e) {
    showToast(e instanceof Error ? e.message : '恢复失败，请重试')
  }
}

const tunerView = ref<InstanceType<typeof TunerView> | null>(null)
/** 音调仪离开可视状态即释放麦克风，绝不后台监听。 */
function stopTuner() {
  tunerView.value?.stopEngine()
}

function switchTab(next: Tab) {
  if (next === tab.value) return
  cancelJump()
  stopAll()
  stopTuner()
  refreshToday()
  tab.value = next
}

function openMaintenance() {
  stopAll()
  stopTuner()
  overlay.value = 'edit'
}

async function onSaved() {
  await reloadCatalog()
  await loadToday()
  current.value = Math.min(current.value, Math.max(0, tasks.value.length - 1))
  overlay.value = 'none'
  tab.value = 'today'
  showToast(
    canWriteCloud()
      ? '维护已完成，所有修改与文件已保存至云端 ✓'
      : '维护已完成，修改已保存至本机 ✓',
  )
}

function openSettings() {
  stopAll()
  stopTuner()
  overlay.value = 'settings'
}

function openHelp() {
  stopAll()
  stopTuner()
  overlay.value = 'help'
}

/** 设置页维护开关（游客）：打开登录/注册弹层并提示。 */
function onLoginRequired() {
  showToast('请先登录账号')
  showAuth.value = true
}

/** 登录/注册成功：整页刷新，本地库随用户空间切换、数据重新加载。 */
function onAuthSuccess() {
  location.reload()
}

function closeOverlay() {
  overlay.value = 'none'
}

onMounted(async () => {
  await initAuth()
  try {
    await seedIfEmpty() // 离线首启兜底
    await loadCloudCatalog() // 云端可用时以云端空间为准（游客=默认模板，登录=专属空间）
    await loadToday()
    await reloadCatalog()
  } finally {
    ready.value = true
  }
})
</script>

<template>
  <div class="app">
    <!-- 登录 / 注册弹层：根级挂载，任何界面（含设置页）都能唤起 -->
    <AuthView v-if="showAuth" @close="showAuth = false" @success="onAuthSuccess" />

    <!-- 覆盖层：维护 / 设置 / 帮助 -->
    <template v-if="overlay === 'edit'">
      <EditView @close="closeOverlay" @saved="onSaved" />
    </template>

    <template v-else-if="overlay === 'settings'">
      <main class="panel-stage">
        <SettingsView
          :task-count="tasks.length"
          :maintaining="maintaining"
          @back="closeOverlay"
          @maintenance="openMaintenance"
          @help="openHelp"
          @login="onLoginRequired"
          @restore="onRestoreDefault"
        />
      </main>
    </template>

    <template v-else-if="overlay === 'help'">
      <main class="panel-stage">
        <HelpView @back="openSettings" />
      </main>
    </template>

    <!-- 三页主界面 -->
    <template v-else>
      <header class="topbar">
        <div class="brand">
          <img class="brand-mark" :src="`${base}icon-192.png?v=2`" alt="" aria-hidden="true" />
          <span class="brand-name">练声助手还没取名字</span>
        </div>
        <button class="icon-btn" type="button" aria-label="设置" @click="openSettings">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M19.4 13a7.8 7.8 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-1.7-1L15 3.3h-4l-.4 2.7a7.6 7.6 0 0 0-1.7 1l-2.4-1-2 3.4L6.6 11a7.8 7.8 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 1.7 1l.4 2.7h4l.4-2.7a7.6 7.6 0 0 0 1.7-1l2.4 1 2-3.4-2.1-1.6ZM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z" />
          </svg>
        </button>
      </header>

      <main class="stage" :class="{ 'stage-scroll': tab !== 'practice' }">
        <p v-if="!ready" class="empty">载入中…</p>

        <template v-else-if="tab === 'stats'">
          <StatsView :task-count="tasks.length" :refresh-key="statsKey" :embedded="true" />
        </template>

        <template v-else-if="tab === 'today'">
          <TodayView
            :groups="groups"
            :done-ids="doneToday"
            :task-count="tasks.length"
            @practice="practiceIndex"
            @toggle="onToggleItem"
            @auto-done="onAutoDone"
            @check-all="onCheckAll"
            @uncheck-all="onUncheckAll"
          />
        </template>

        <template v-else-if="tab === 'tuner'">
          <TunerView ref="tunerView" />
        </template>

        <template v-else>
          <div v-if="!task" class="empty">暂无跟练内容</div>
          <TaskView
            v-else
            :key="`${task.key}-${reloadKey}`"
            :task="task"
            :done="isDone"
            :group-label="groupOfCurrent ? `${groupOfCurrent.cn}、${groupOfCurrent.title}` : ''"
            @auto-done="onAutoDone"
          />
        </template>
      </main>

      <!-- 跟练页底部操作条 -->
      <footer v-if="tab === 'practice' && ready && task" class="actionbar">
        <button type="button" :disabled="current <= 0" @click="go(-1)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
          上一项
        </button>
        <button
          type="button"
          class="done-btn"
          :class="{ done: isDone }"
          :disabled="!task || jumping"
          @click="toggleDone"
        >
          <svg v-if="!isDone" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" stroke-width="1.8" />
          </svg>
          {{ isDone ? '已完成' : '打卡' }}
        </button>
        <span class="counter">{{ tasks.length ? current + 1 : 0 }} / {{ tasks.length }}</span>
        <button type="button" :disabled="current >= tasks.length - 1" @click="go(1)">
          下一项
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </button>
      </footer>

      <!-- 轻提示：打卡/取消的文字反馈 -->
      <Transition name="toast">
        <div v-if="toastMsg" class="toast" role="status">{{ toastMsg }}</div>
      </Transition>

      <!-- 三个 tab -->
      <nav class="tabbar">
        <button type="button" :class="{ active: tab === 'stats' }" @click="switchTab('stats')">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V11m5 8V5m5 14v-7m5 7V8" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" /></svg>
          <span>统计</span>
        </button>
        <button type="button" :class="{ active: tab === 'today' }" @click="switchTab('today')">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.7" /><path d="M3.5 10h17M8 3v4m8-4v4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" /></svg>
          <span>当日</span>
        </button>
        <button type="button" :class="{ active: tab === 'practice' }" @click="switchTab('practice')">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" /></svg>
          <span>跟练</span>
        </button>
        <button type="button" :class="{ active: tab === 'tuner' }" @click="switchTab('tuner')">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 3v5.5a3.5 3.5 0 0 0 7 0V3M12 12v9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
          <span>音调仪</span>
        </button>
      </nav>
    </template>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  min-height: 0;
  overflow: hidden;
  background: transparent;
}
.topbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: max(12px, env(safe-area-inset-top)) 20px 10px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.brand-mark {
  width: 28px;
  height: 28px;
  border-radius: 7px;
  flex: 0 0 auto;
  object-fit: cover;
  display: block;
}
.brand-name {
  font-size: 15px;
  font-weight: 500;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.icon-btn {
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--accent);
  display: grid;
  place-items: center;
  cursor: pointer;
  padding: 0;
}
.icon-btn:hover {
  background: var(--fill);
}
.icon-btn svg {
  width: 20px;
  height: 20px;
}
.stage {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  overflow: hidden;
  padding: 4px 18px 8px;
}
.stage-scroll {
  overflow-y: auto;
  padding-top: 8px;
  scrollbar-width: thin;
  scrollbar-color: var(--faint) transparent;
}
.panel-stage {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: max(14px, env(safe-area-inset-top)) 18px 24px;
  scrollbar-width: thin;
}
.empty {
  color: var(--muted);
  font-size: 14px;
  margin: auto;
}
.actionbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 18px 10px;
}
.actionbar button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: var(--fill);
  color: var(--text);
  border-radius: var(--r-m);
  padding: 10px 14px;
  font-size: 14px;
  cursor: pointer;
}
.actionbar button svg {
  width: 16px;
  height: 16px;
}
.actionbar button:disabled {
  opacity: 0.35;
  cursor: default;
}
.actionbar .done-btn {
  color: var(--accent);
  background: var(--accent-soft);
  padding: 10px 18px;
}
.actionbar .done-btn.done {
  background: var(--accent);
  color: #fff;
}
/* 打卡成功→跳下一项的等待期：按钮微降透明度，提示已锁定、即将自动前进 */
.actionbar .done-btn:disabled {
  opacity: 0.65;
  cursor: default;
}
.counter {
  font-size: 13px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.toast {
  position: fixed;
  left: 50%;
  bottom: calc(88px + env(safe-area-inset-bottom));
  transform: translateX(-50%);
  max-width: min(86vw, 420px);
  background: rgba(28, 32, 42, 0.88);
  color: #fff;
  font-size: 13px;
  line-height: 1.4;
  padding: 9px 18px;
  border-radius: 999px;
  z-index: 60;
  pointer-events: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.18);
}
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(10px);
}
.tabbar {
  flex: 0 0 auto;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0;
  margin: 0;
  padding: 4px 0 max(6px, env(safe-area-inset-bottom));
  border-radius: 0;
  background: var(--glass);
  border: none;
  border-top: 1px solid var(--hairline);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  backdrop-filter: blur(24px) saturate(180%);
}
.tabbar button {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  border: none;
  background: none;
  color: var(--faint);
  padding: 7px 0 4px;
  border-radius: 0;
  cursor: pointer;
  font-size: 10.5px;
  letter-spacing: 0.01em;
  transition: color 0.3s var(--ease);
}
.tabbar button svg {
  width: 24px;
  height: 24px;
}
.tabbar button.active {
  color: var(--accent);
  background: none;
}
@media (max-width: 560px) {
  .topbar { padding-left: 14px; padding-right: 14px; }
  .stage { padding-left: 14px; padding-right: 14px; }
  .brand-name { font-size: 14px; }
}
</style>
