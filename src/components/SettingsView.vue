<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { adminResetUserPassword, auth, logout, refreshUsage } from '../lib/auth'
import { CLOUD_API_BASE, FEEDBACK_EMAIL, GITHUB_REPO_URL, STORAGE_LIMIT } from '../config'
import { cloudAvailable } from '../lib/cloudSpace'
import { exportJsonBackup } from '../lib/backup'
import { currentTheme, setTheme, type ThemeName } from '../lib/theme'
import StorageRing from './StorageRing.vue'
import CloudFilesDialog from './CloudFilesDialog.vue'

const props = defineProps<{
  taskCount: number
  /** 是否处于自定义模式（编辑页打开时为 true，开关随之点亮）。 */
  maintaining: boolean
}>()
const emit = defineEmits<{
  back: []
  maintenance: []
  help: []
  /** 游客点自定义开关：打开登录/注册弹层（App 侧同时 toast 提示）。 */
  login: []
  /** 恢复默认模板（登录用户）。 */
  restore: []
}>()

/** 语义化版本号 + 构建信息（vite define 注入），用于核对设备是否运行最新版。 */
const appVersion = __APP_VERSION__
const buildId = __BUILD_ID__

const base = import.meta.env.BASE_URL

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

// ── 自定义模式开关：游客拦截 ──
function onMaintenanceSwitch() {
  if (!auth.user) {
    emit('login') // App 打开登录/注册并提示「请先登录账号」
    return
  }
  // 编辑页打开时开关已点亮；再点关闭不做任何事（退出由编辑页按钮负责）。
  if (!props.maintaining) emit('maintenance')
}

// ── 云端容量 ──
const showFiles = ref(false)
const cloudNote = ref('')
const usage = computed(() => ({
  usedBytes: auth.usage?.used ?? 0,
  quotaBytes: auth.usage?.limit || STORAGE_LIMIT,
}))

onMounted(() => {
  // 进入设置页时拉一次最新用量，避免显示上次会话的旧数字
  void refreshUsage()
})

function onFilesChanged(payload: { deletedIds: string[] }) {
  cloudNote.value = `已删除 ${payload.deletedIds.length} 个文件，容量已释放`
  window.setTimeout(() => (cloudNote.value = ''), 2600)
}

// ── 打赏码：点击放大查看 ──
const donateImg = ref<string | null>(null)
function openDonate(name: 'wechat' | 'alipay') {
  donateImg.value = `${import.meta.env.BASE_URL}donate-${name}.png`
}

// ── 反馈邮箱：一键复制 ──
const emailCopied = ref(false)
async function copyEmail() {
  try {
    await navigator.clipboard.writeText(FEEDBACK_EMAIL)
  } catch {
    // 剪贴板不可用（非安全上下文）时退回选中文本提示
    const el = document.createElement('textarea')
    el.value = FEEDBACK_EMAIL
    document.body.appendChild(el)
    el.select()
    document.execCommand('copy')
    el.remove()
  }
  emailCopied.value = true
  window.setTimeout(() => (emailCopied.value = false), 1800)
}

// ── 显示辅助 ──
const avatarSrc = computed(() => auth.user?.avatar || `${import.meta.env.BASE_URL}favicon.svg`)

// ── 管理员工具：协助重置用户密码（仅 admin 可见）──
const isAdmin = computed(() => auth.user?.role === 'admin')
const adminIdentifier = ref('')
const adminNewPassword = ref('')
const adminBusy = ref(false)
const adminMsg = ref('')
const adminErr = ref(false)
const showAdminConfirm = ref(false)

function openAdminResetConfirm() {
  adminMsg.value = ''
  adminErr.value = false
  const id = adminIdentifier.value.trim()
  if (!id) {
    adminMsg.value = '请输入用户标识（用户名 / 邮箱 / 手机号）'
    adminErr.value = true
    return
  }
  if (adminNewPassword.value.length < 6) {
    adminMsg.value = '临时新密码至少 6 位'
    adminErr.value = true
    return
  }
  showAdminConfirm.value = true
}

async function confirmAdminReset() {
  if (adminBusy.value) return
  showAdminConfirm.value = false
  adminBusy.value = true
  adminMsg.value = ''
  adminErr.value = false
  try {
    const r = await adminResetUserPassword(adminIdentifier.value.trim(), adminNewPassword.value)
    adminMsg.value = `已为用户 ${r.username} 重置密码，请通知其登录后及时修改`
    adminErr.value = false
    adminIdentifier.value = ''
    adminNewPassword.value = ''
  } catch (e) {
    adminMsg.value = e instanceof Error ? e.message : String(e)
    adminErr.value = true
  } finally {
    adminBusy.value = false
  }
}
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
      <button v-if="!auth.user" type="button" class="pill primary" @click="emit('login')">
        {{ cloudAvailable ? '登录 / 注册' : '账号' }}
      </button>
      <button v-else type="button" class="pill" @click="logout">退出登录</button>
    </section>

    <!-- 云端容量：镂空圆环 + 精确用量 + 管理入口 -->
    <section v-if="cloudAvailable && auth.user" class="cloud">
      <div class="cloud-head">
        <h2>云端空间</h2>
        <button type="button" class="mini" @click="showFiles = true">管理云端文件</button>
      </div>
      <StorageRing :used="usage.usedBytes" :quota="usage.quotaBytes" :size="90" :stroke="9" />
      <p class="cloud-hint">练习内容与上传的音频 / 图片保存在你的云端空间；打卡状态随账户同步，不占此容量。</p>
      <p v-if="cloudNote" class="cloud-note">{{ cloudNote }}</p>
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
          <template v-else>已连接 · {{ auth.user.role === 'admin' ? '默认模板维护者' : '专属空间' }}</template>
        </dd>
      </div>
      <div class="row">
        <dt>数据备份</dt>
        <dd><button type="button" class="mini" :disabled="busy" @click="onExport">导出 JSON 备份</button></dd>
      </div>
      <div class="row">
        <dt>自定义模式</dt>
        <dd>
          <button
            type="button"
            class="switch"
            :class="{ on: maintaining }"
            role="switch"
            :aria-checked="maintaining"
            :aria-label="auth.user ? '自定义模式' : '自定义模式（需登录）'"
            @click="onMaintenanceSwitch"
          >
            <span class="knob"></span>
          </button>
        </dd>
      </div>
      <div class="row">
        <dt>应用版本</dt>
        <dd class="version">{{ appVersion }} · {{ buildId }}</dd>
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

    <p class="hint">{{ CLOUD_API_BASE ? '打卡状态与个人数据随账户云端同步（多端一致）；练习内容与文件保存在你的云端空间。' : '云端服务未配置，当前为纯本地模式：所有数据仅保存在本机。' }}</p>

    <!-- 管理员工具：协助重置用户密码（仅 admin 可见） -->
    <section v-if="isAdmin" class="block admin-block">
      <h2>管理员工具：协助重置用户密码</h2>
      <p class="block-text muted small">
        用户遗忘邮箱 / 手机号联系你时，输入其用户名、注册邮箱或手机号任一，再设置临时新密码即可代为重置。
      </p>
      <label class="admin-field">
        <span>用户标识（用户名 / 注册邮箱 / 手机号）</span>
        <input v-model="adminIdentifier" type="text" autocomplete="off" placeholder="任填其一即可定位用户" />
      </label>
      <label class="admin-field">
        <span>临时新密码（至少 6 位）</span>
        <input v-model="adminNewPassword" type="text" autocomplete="off" placeholder="为其设置的临时密码" />
      </label>
      <button type="button" class="admin-submit" :disabled="adminBusy" @click="openAdminResetConfirm">
        {{ adminBusy ? '重置中…' : '确认重置密码' }}
      </button>
      <p v-if="adminMsg" class="admin-msg" :class="{ err: adminErr }" role="status">{{ adminMsg }}</p>
    </section>

    <!-- 板块一：关于 -->
    <section class="block">
      <h2>关于</h2>
      <p class="block-text">
        支持完全自定义练声项目与上传练声曲，支持实时音调检测、跟练打卡与多端云端同步。
      </p>
      <p class="block-text muted">项目已完全免费开源。</p>
      <a class="block-link" :href="GITHUB_REPO_URL" target="_blank" rel="noopener noreferrer">
        开源仓库 {{ GITHUB_REPO_URL }} ↗
      </a>
      <p class="block-text muted small">
        鸣谢：WorkBuddy 及各大智能体（Hy4 flash / DeepSeek-v4.1-Flash / DeepSeek-v4-Pro / GLM-5.3 /
        GLM-5.3-Flash / GLM-5.3-FlashX）及贡献提示词的网页版 AI（腾讯元宝 / DeepSeek / Google Gemini）的鼎力支持，
        以及 GitHub 提供的前端服务、Cloudflare 提供的免费后端数据库、DigitalPlat 提供的免费域名。
      </p>
    </section>

    <!-- 板块二：使用与自定义教程 -->
    <section class="block">
      <button type="button" class="block-entry" @click="emit('help')">
        <span>
          <strong>使用与自定义教程</strong>
          <small>跟练打卡、自定义模式、容量清理、主屏幕安装</small>
        </span>
        <span aria-hidden="true" class="chevron">›</span>
      </button>
    </section>

    <!-- 板块三：作者与打赏 -->
    <section class="block">
      <h2>作者与打赏</h2>
      <p class="block-text">作者：VINCE DWAN，作者很神秘，只留下了神秘打赏二维码，希望顿顿晚饭加鸡腿。</p>
      <div class="donate-row">
        <button type="button" class="donate-card" @click="openDonate('wechat')">
          <img :src="`${base}donate-wechat.png`" alt="微信收款码" />
          <span>微信</span>
        </button>
        <button type="button" class="donate-card" @click="openDonate('alipay')">
          <img :src="`${base}donate-alipay.png`" alt="支付宝收款码" />
          <span>支付宝</span>
        </button>
      </div>
      <p class="block-text muted small">点击收款码可放大查看。</p>
    </section>

    <!-- 板块四：意见反馈 -->
    <section class="block">
      <h2>意见反馈</h2>
      <div class="feedback-row">
        <span class="feedback-email">{{ FEEDBACK_EMAIL }}</span>
        <button type="button" class="mini" @click="copyEmail">{{ emailCopied ? '已复制 ✓' : '复制邮箱' }}</button>
        <a class="mini-link" :href="`mailto:${FEEDBACK_EMAIL}`">发邮件</a>
      </div>
    </section>

    <!-- 打赏码放大预览 -->
    <Teleport to="body">
      <Transition name="donate">
        <div v-if="donateImg" class="donate-mask" @click.self="donateImg = null">
          <figure class="donate-big">
            <img :src="donateImg" alt="收款码大图" />
            <button type="button" class="donate-close" @click="donateImg = null">关闭</button>
          </figure>
        </div>
      </Transition>
    </Teleport>

    <!-- 管理员重置密码：二次确认弹窗 -->
    <Teleport to="body">
      <Transition name="dlg">
        <div v-if="showAdminConfirm" class="dlg-mask" @click.self="showAdminConfirm = false">
          <div class="dlg" role="dialog" aria-modal="true" aria-label="确认重置用户密码">
            <p class="dlg-title">协助重置用户密码</p>
            <p class="dlg-text">确定要为「{{ adminIdentifier.trim() }}」重置密码吗？重置后其旧密码与登录状态将立即失效。</p>
            <div class="dlg-actions">
              <button type="button" class="dlg-btn ghost" @click="showAdminConfirm = false">取消</button>
              <button type="button" class="dlg-btn primary" @click="confirmAdminReset">确定重置</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <CloudFilesDialog v-if="showFiles" @close="showFiles = false" @changed="onFilesChanged" />
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
/* 云端容量卡片 */
.cloud {
  background: var(--card-glass);
  border: 1px solid var(--card-glass-border);
  -webkit-backdrop-filter: var(--card-blur);
  backdrop-filter: var(--card-blur);
  box-shadow: var(--card-glass-shadow);
  transition: background 0.5s ease, box-shadow 0.5s ease, border-color 0.5s ease;
  border-radius: var(--r-m);
  padding: 14px 16px 16px;
  margin-bottom: 16px;
}
.cloud-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}
.cloud-head h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 500;
  color: var(--text);
}
.cloud-hint {
  margin: 12px 0 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--muted);
}
.cloud-note {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--accent);
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

/* 应用版本：等宽数字，长串信息（版本 · 时间 · hash）不跳动 */
dd.version {
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.01em;
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
/* iOS 风格开关：自定义模式 */
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
/* ── 设置页四大信息板块：关于 / 教程 / 打赏 / 反馈 ── */
.block {
  margin-top: 16px;
  background: var(--card-glass);
  border: 1px solid var(--card-glass-border);
  -webkit-backdrop-filter: var(--card-blur);
  backdrop-filter: var(--card-blur);
  box-shadow: var(--card-glass-shadow);
  transition: background 0.5s ease, box-shadow 0.5s ease, border-color 0.5s ease;
  border-radius: var(--r-m);
  padding: 14px 16px;
}
.block h2 {
  margin: 0 0 8px;
  font-size: 15px;
  font-weight: 500;
  color: var(--text);
}
.block-text {
  margin: 0 0 6px;
  font-size: 13px;
  line-height: 1.55;
  color: var(--text);
}
.block-text.muted {
  color: var(--muted);
}
.block-text.small {
  font-size: 11.5px;
  line-height: 1.6;
}
.block-link {
  display: inline-block;
  margin: 2px 0 8px;
  font-size: 13px;
  color: var(--accent);
  text-decoration: none;
  word-break: break-all;
}
.block-link:hover {
  text-decoration: underline;
}
.block-entry {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  padding: 0;
  border: none;
  background: none;
  color: var(--text);
  font-family: inherit;
  cursor: pointer;
  text-align: left;
}
.block-entry strong {
  display: block;
  font-size: 14px;
  font-weight: 500;
  color: var(--text);
}
.block-entry small {
  display: block;
  margin-top: 3px;
  font-size: 12px;
  color: var(--muted);
}
.chevron {
  color: var(--accent);
  font-size: 20px;
  flex: 0 0 auto;
}
/* 打赏码 */
.donate-row {
  display: flex;
  gap: 14px;
  margin: 10px 0 4px;
}
.donate-card {
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--card-glass-border);
  background: var(--fill);
  border-radius: var(--r-s);
  padding: 10px;
  cursor: pointer;
  font-family: inherit;
}
.donate-card img {
  width: 100%;
  max-width: 150px;
  border-radius: 6px;
  display: block;
}
.donate-card span {
  font-size: 12px;
  color: var(--muted);
}
/* 意见反馈 */
.feedback-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.feedback-email {
  font-size: 13px;
  color: var(--text);
  font-variant-numeric: tabular-nums;
  word-break: break-all;
}
.mini-link {
  font-size: 12px;
  color: var(--accent);
  text-decoration: none;
  padding: 5px 12px;
  border-radius: 999px;
  background: var(--fill);
}
.mini-link:hover {
  text-decoration: underline;
}
/* 打赏码放大预览 */
.donate-mask {
  position: fixed;
  inset: 0;
  z-index: 99;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.6);
}
.donate-big {
  margin: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
.donate-big img {
  max-width: min(78vw, 360px);
  max-height: 72vh;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.35);
}
.donate-close {
  border: none;
  background: rgba(255, 255, 255, 0.92);
  color: #222;
  font-size: 13px;
  padding: 8px 22px;
  border-radius: 999px;
  cursor: pointer;
  font-family: inherit;
}
.donate-enter-active,
.donate-leave-active {
  transition: opacity 0.22s ease;
}
.donate-enter-active .donate-big,
.donate-leave-active .donate-big {
  transition: transform 0.24s var(--ease);
}
.donate-enter-from,
.donate-leave-to {
  opacity: 0;
}
.donate-enter-from .donate-big,
.donate-leave-to .donate-big {
  transform: scale(0.9);
}
/* ── 管理员工具：协助重置用户密码 ── */
.admin-block {
  border-color: var(--accent-bg);
}
.admin-field {
  display: block;
  margin: 10px 0;
}
.admin-field span {
  display: block;
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 5px;
}
.admin-field input {
  width: 100%;
  box-sizing: border-box;
  border: none;
  border-radius: var(--r-s);
  background: var(--fill);
  color: var(--text);
  padding: 10px 12px;
  font-size: 14px;
  font-family: inherit;
}
.admin-submit {
  margin-top: 6px;
  width: 100%;
  border: none;
  background: var(--accent);
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  padding: 11px 0;
  border-radius: 999px;
  cursor: pointer;
  transition: opacity 0.2s ease, transform 0.15s ease;
}
.admin-submit:active {
  transform: scale(0.98);
}
.admin-submit:disabled {
  opacity: 0.55;
  cursor: default;
}
.admin-msg {
  margin: 10px 0 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--accent);
}
.admin-msg.err {
  color: #e0300e;
}
/* ── 二次确认弹窗（复用全局 dlg 风格）── */
.dlg-mask {
  position: fixed;
  inset: 0;
  z-index: 100;
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
  word-break: break-all;
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
