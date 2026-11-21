<script setup lang="ts">
import { ref } from 'vue'
import type { StorageStatus } from '../lib/persistence'
import { exportBackup, importBackup, type ImportResult } from '../lib/backup'
import { SPACE } from '../lib/space'
import { autoSyncEnabled, setAutoSync } from '../lib/syncClient'
import { currentTheme, setTheme, type ThemeName } from '../lib/theme'

defineProps<{
  status: StorageStatus
  taskCount: number
  syncConnected: boolean
}>()
const emit = defineEmits<{ back: []; maintenance: []; imported: []; help: [] }>()

/** 构建版本号（vite define 注入），用于核对设备是否运行最新版。 */
const buildId = __BUILD_ID__

const busy = ref(false)
const feedback = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const theme = ref<ThemeName>(currentTheme())
const autoSync = ref(autoSyncEnabled.value)

async function toggleAutoSync() {
  autoSync.value = !autoSync.value
  await setAutoSync(autoSync.value)
}

async function pickTheme(name: ThemeName) {
  theme.value = name
  await setTheme(name)
}

async function onExport() {
  if (busy.value) return
  busy.value = true
  feedback.value = '正在打包备份…'
  try {
    const r = await exportBackup()
    feedback.value = `备份已下载：${r.level1} 组 / ${r.level2} 项 / ${r.records} 条打卡 / ${r.files} 个文件`
  } catch (e) {
    feedback.value = `导出失败：${e instanceof Error ? e.message : String(e)}`
  } finally {
    busy.value = false
  }
}

async function onImport(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || busy.value) return
  busy.value = true
  feedback.value = '正在恢复备份…'
  try {
    const r: ImportResult = await importBackup(file)
    feedback.value = `已恢复：${r.level1} 组 / ${r.level2} 项 / ${r.records} 条打卡 / ${r.files} 个文件`
    emit('imported')
  } catch (err) {
    feedback.value = `导入失败：${err instanceof Error ? err.message : String(err)}`
  } finally {
    input.value = ''
    busy.value = false
  }
}
</script>

<template>
  <div class="settings">
    <header class="bar">
      <button type="button" class="back" @click="emit('back')">‹ 返回</button>
      <h1>设置</h1>
    </header>

    <dl class="rows">
      <div class="row">
        <dt>存储持久化</dt>
        <dd v-if="!status.supported">当前浏览器不支持</dd>
        <dd v-else :class="status.persisted ? 'ok' : 'warn'">
          {{ status.persisted ? '已开启（数据不易被清理）' : '未开启（空间紧张时可能被清理）' }}
        </dd>
      </div>
      <div class="row">
        <dt>跟练项目</dt>
        <dd>{{ taskCount }} 项</dd>
      </div>
      <div class="row">
        <dt>同步通道</dt>
        <dd :class="syncConnected ? 'ok' : ''">
          {{ syncConnected ? '已连接' : '等待电脑端启动' }}
        </dd>
      </div>
      <div class="row">
        <dt>自动同步</dt>
        <dd>
          <button
            type="button"
            class="switch"
            :class="{ on: autoSync }"
            role="switch"
            :aria-checked="autoSync"
            aria-label="自动同步"
            @click="toggleAutoSync"
          >
            <span class="knob"></span>
          </button>
        </dd>
      </div>
      <div class="row">
        <dt>数据位置</dt>
        <dd>仅本机 · IndexedDB</dd>
      </div>
      <div class="row">
        <dt>当前空间</dt>
        <dd>{{ SPACE === 'default' ? '默认' : SPACE }}</dd>
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

    <p class="hint">音频与图片在首次联网时缓存到本机，之后可离线使用。</p>
    <p class="hint">iOS 锁屏后页面脚本会被挂起，未同步的打卡会在下次打开应用时自动补推。</p>

    <div class="backup">
      <h2>备份与恢复</h2>
      <p class="warning" role="note">自定义方案和上传的音频只保存在本设备。换设备或清理浏览器数据前，请使用导出备份。</p>
      <div class="backup-actions">
        <button type="button" :disabled="busy" @click="onExport">导出备份</button>
        <button type="button" :disabled="busy" @click="fileInput?.click()">导入备份</button>
        <input
          ref="fileInput"
          type="file"
          accept=".zip,application/zip"
          hidden
          @change="onImport"
        />
      </div>
      <p v-if="feedback" class="feedback" role="status">{{ feedback }}</p>
    </div>

    <div class="maintenance">
      <button type="button" class="entry" @click="emit('help')">
        帮助与教程 <span aria-hidden="true">›</span>
      </button>
      <button type="button" @click="emit('maintenance')">
        维护模式 <span aria-hidden="true">›</span>
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
}
dd.ok {
  color: var(--accent);
}
dd.warn {
  color: #b25000;
}
/* iOS 风格开关：自动同步 */
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
.backup {
  margin-top: 28px;
  border-top: 1px solid var(--line);
  padding-top: 18px;
}
.backup h2 {
  margin: 0 0 12px;
  font-size: 15px;
  font-weight: 500;
  color: var(--text);
}
.warning {
  margin: 0 0 14px;
  padding: 12px 14px;
  border: none;
  border-radius: var(--r-s);
  background: rgba(255, 204, 0, 0.14);
  font-size: 13px;
  line-height: 1.55;
  color: #7a5800;
}
.backup-actions {
  display: flex;
  gap: 12px;
}
.backup-actions button {
  flex: 1;
  padding: 10px 12px;
  border: none;
  border-radius: var(--r-s);
  background: var(--fill);
  color: var(--text);
  font-size: 14px;
  font-family: inherit;
  cursor: pointer;
}
.backup-actions button:disabled {
  opacity: 0.4;
  cursor: default;
}
.feedback {
  margin: 12px 0 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--accent);
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
