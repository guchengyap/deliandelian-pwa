<script setup lang="ts">
import { computed, ref } from 'vue'
import { auth, logout } from '../lib/auth'
import { CLOUD_API_BASE, STORAGE_LIMIT } from '../config'
import { cloudAvailable } from '../lib/cloudSpace'
import { exportJsonBackup } from '../lib/backup'
import { currentTheme, setTheme, type ThemeName } from '../lib/theme'

const props = defineProps<{
  taskCount: number
  /** 是否处于维护模式（维护页打开时为 true，开关随之点亮）。 */
  maintaining: boolean
}>()
const emit = defineEmits<{
  back: []
  maintenance: []
  help: []
  /** 游客点维护开关：打开登录/注册弹层（App 侧同时 toast 提示）。 */
  login: []
  /** 恢复默认模板（登录用户）。 */
  restore: []
}>()

/** 构建版本号（vite define 注入），用于核对设备是否运行最新版。 */
const buildId = __BUILD_ID__

const theme = ref<ThemeName>(currentTheme())
async function pickTheme(name: ThemeName) {
  theme.value = name
  await setTheme(name)
}

// ── 备份（导出 JSON）──
const busy = ref(false)
const feedback = ref('')
async function onExport() {
  if (busy.value) return
  busy.value = true
  feedback.value = '正在打包…'
  try {
    const n = await exportJsonBackup()
    feedback.value = `备份已下载（${n} 条数据），保存在浏览器下载目录`
  } catch (e) {
    feedback.value = `导出失败：${e instanceof Error ? e.message : String(e)}`
  } finally {
    busy.value = false
  }
}

// ── 维护模式开关：游客拦截 ──
function onMaintenanceSwitch() {
  if (!auth.user) {
    emit('login') // App 打开登录/注册并提示「请先登录账号」
    return
  }
  // 维护页打开时开关已点亮；再点关闭不做任何事（退出由维护页按钮负责）。
  if (!props.maintaining) emit('maintenance')
}

// ── 显示辅助 ──
const avatarSrc = computed(() => auth.user?.avatar || `${import.meta.env.BASE_URL}favicon.svg`)
const usageText = computed(() => {
  if (!auth.usage) return '云端已同步'
  const mb = (n: number) => (n / 1024 / 1024).toFixed(1)
  return `云端已同步（已用 ${mb(auth.usage.used)} MB / ${mb(auth.usage.limit || STORAGE_LIMIT)} MB）`
})
</script>

<template>
  <div class="settings">
    <header class="bar">
      <button type="button" class="back" @click="emit('back')">‹ 返回</button>
      <h1>设置</h1>
    </header>

    <!-- 顶部：账号与头像 -->
    <section class="account">
      <img class="avatar" :src="avatarSrc" alt="头像" />
      <div class="account-info">
        <p class="username">{{ auth.user ? auth.user.username : '游客模式' }}</p>
        <p class="account-sub">
          {{ auth.user ? (auth.user.role === 'admin' ? '管理员 · 默认模板维护者' : '专属空间已就绪') : '公共只读 · 登录后可定制' }}
        </p>
      </div>
      <button v-if="!auth.user" type="button" class="pill primary" @click="emit('login')">登录 / 注册</button>
      <button v-else type="button" class="pill" @click="logout">退出登录</button>
    </section>

    <dl class="rows">
      <div class="row">
        <dt>当前空间</dt>
        <dd>
          <template v-if="!auth.user">默认空间（只读）</template>
          <template v-else>
            我的专属空间
            <button type="button" class="mini" @click="emit('restore')">恢复默认模板</button>
          </template>
        </dd>
      </div>
      <div class="row">
        <dt>跟练项目</dt>
        <dd>{{ taskCount }} 项</dd>
      </div>
      <div class="row">
        <dt>云端状态</dt>
        <dd :class="{ ok: !!auth.user && cloudAvailable }">
          <template v-if="!cloudAvailable">未连接云端（本地模式）</template>
          <template v-else-if="!auth.user">公共只读模式</template>
          <template v-else>{{ usageText }}</template>
        </dd>
      </div>
      <div class="row">
        <dt>数据备份</dt>
        <dd><button type="button" class="mini" :disabled="busy" @click="onExport">导出 JSON 备份</button></dd>
      </div>
      <div class="row">
        <dt>维护模式</dt>
        <dd>
          <button
            type="button"
            class="switch"
            :class="{ on: maintaining }"
            role="switch"
            :aria-checked="maintaining"
            :aria-label="auth.user ? '维护模式' : '维护模式（需登录）'"
            @click="onMaintenanceSwitch"
          >
            <span class="knob"></span>
          </button>
        </dd>
      </div>
      <div class="row">
        <dt>应用版本</dt>
        <dd>{{ buildId }}</dd>
      </div>
    </dl>

    <div class="appearance">
      <h2>外观</h2>
      <div class="swatches">
        <button
          type="button"
          class="swatch"
          :class="{ active: theme === 'theme-ice' }"
          aria-label="液态冰蓝主题"
          @click="pickTheme('theme-ice')"
        >
          <span class="dot ice"></span>
          <span class="swatch-name">冰蓝</span>
        </button>
        <button
          type="button"
          class="swatch"
          :class="{ active: theme === 'theme-sunset' }"
          aria-label="落日橙主题"
          @click="pickTheme('theme-sunset')"
        >
          <span class="dot sunset"></span>
          <span class="swatch-name">落日</span>
        </button>
      </div>
    </div>

    <p class="hint">{{ CLOUD_API_BASE ? '打卡记录保存在本机你的专属库里；练习内容与文件保存在你的云端空间。' : '云端服务未配置，当前为纯本地模式：所有数据仅保存在本机。' }}</p>

    <div class="maintenance">
      <button type="button" class="entry" @click="emit('help')">
        帮助与教程 <span aria-hidden="true">›</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.settings {
  width: 100%;
  max-width: 640px;
  margin: 0 auto;
}
.bar {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 28px;
}
.bar h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 500;
}
.back {
  border: none;
  background: none;
  color: var(--accent);
  font-size: 15px;
  cursor: pointer;
  padding: 6px 0;
}
/* 顶部账号卡片 */
.account {
  display: flex;
  align-items: center;
  gap: 14px;
  background: var(--card-glass);
  border: 1px solid var(--card-glass-border);
  -webkit-backdrop-filter: var(--card-blur);
  backdrop-filter: var(--card-blur);
  box-shadow: var(--card-glass-shadow);
  border-radius: var(--r-m);
  padding: 16px;
  margin-bottom: 16px;
  transition: background 0.5s ease, box-shadow 0.5s ease, border-color 0.5s ease;
}
.avatar {
  flex: 0 0 auto;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  object-fit: cover;
  background: var(--fill);
  box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.6);
}
.account-info {
  flex: 1 1 auto;
  min-width: 0;
}
.username {
  margin: 0 0 2px;
  font-size: 16px;
  font-weight: 500;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.account-sub {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}
.pill {
  flex: 0 0 auto;
  border: none;
  background: var(--fill);
  color: var(--text);
  border-radius: 999px;
  font-size: 13px;
  padding: 8px 16px;
  cursor: pointer;
}
.pill.primary {
  background: var(--accent);
  color: #fff;
}
.rows {
  margin: 0;
  background: var(--card-glass);
  border: 1px solid var(--card-glass-border);
  -webkit-backdrop-filter: var(--card-blur);
  backdrop-filter: var(--card-blur);
  box-shadow: var(--card-glass-shadow);
  transition: background 0.5s ease, box-shadow 0.5s ease, border-color 0.5s ease;
  border-radius: var(--r-m);
  padding: 0 16px;
}
.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 13px 0;
  border-bottom: 1px solid var(--line);
}
.row:last-child {
  border-bottom: none;
}
dt {
  color: var(--text);
  font-size: 14px;
}
dd {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
  text-align: right;
  display: flex;
  align-items: center;
  gap: 8px;
}
dd.ok {
  color: var(--accent);
}
.mini {
  border: none;
  background: var(--fill);
  color: var(--accent);
  border-radius: 999px;
  font-size: 12px;
  padding: 5px 12px;
  cursor: pointer;
  white-space: nowrap;
}
.mini:disabled {
  opacity: 0.5;
  cursor: default;
}
/* iOS 风格开关：维护模式 */
.switch {
  position: relative;
  width: 46px;
  height: 27px;
  border: none;
  border-radius: 999px;
  background: var(--faint);
  cursor: pointer;
  padding: 0;
  transition: background 0.25s var(--ease);
}
.switch .knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 23px;
  height: 23px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.18);
  transition: transform 0.25s var(--ease);
}
.switch.on {
  background: var(--accent);
}
.switch.on .knob {
  transform: translateX(19px);
}
.hint {
  margin-top: 24px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--muted);
}
.appearance {
  margin-top: 24px;
  background: var(--card-glass);
  border: 1px solid var(--card-glass-border);
  -webkit-backdrop-filter: var(--card-blur);
  backdrop-filter: var(--card-blur);
  box-shadow: var(--card-glass-shadow);
  border-radius: var(--r-m);
  padding: 14px 16px;
  transition: background 0.5s ease, box-shadow 0.5s ease, border-color 0.5s ease;
}
.appearance h2 {
  margin: 0 0 12px;
  font-size: 15px;
  font-weight: 500;
  color: var(--text);
}
.swatches {
  display: flex;
  gap: 20px;
}
.swatch {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  border: none;
  background: none;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: var(--r-s);
}
.dot {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid var(--card-glass-border);
  box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.9);
  transition: box-shadow 0.5s ease, transform 0.3s var(--ease);
}
.dot.ice {
  background: linear-gradient(135deg, #e9f0f8 40%, #93c5fd 75%, #2563eb);
}
.dot.sunset {
  background: linear-gradient(135deg, #fdf8f5 40%, #fed7aa 75%, #d9480f);
}
.swatch.active .dot {
  box-shadow:
    inset 0 1px 2px rgba(255, 255, 255, 0.9),
    0 0 0 2px var(--card),
    0 0 0 4px var(--accent-color),
    0 4px 14px var(--shadow-color);
}
.swatch-name {
  font-size: 12px;
  color: var(--muted);
}
.swatch.active .swatch-name {
  color: var(--text);
}
.maintenance {
  margin-top: 24px;
  background: var(--card-glass);
  border: 1px solid var(--card-glass-border);
  -webkit-backdrop-filter: var(--card-blur);
  backdrop-filter: var(--card-blur);
  box-shadow: var(--card-glass-shadow);
  transition: background 0.5s ease, box-shadow 0.5s ease, border-color 0.5s ease;
  border-radius: var(--r-m);
  padding: 0 16px;
}
.maintenance button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 13px 0;
  border: none;
  border-bottom: 1px solid var(--line);
  background: none;
  color: var(--text);
  font-size: 14px;
  font-family: inherit;
  cursor: pointer;
}
.maintenance button:last-of-type {
  border-bottom: none;
}
.maintenance button span {
  color: var(--accent);
  font-size: 18px;
}
</style>
