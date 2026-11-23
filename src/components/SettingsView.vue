<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { adminResetUserPassword, auth, logout, refreshUsage, updateProfile } from '../lib/auth'
import { CLOUD_API_BASE, FEEDBACK_EMAIL, STORAGE_LIMIT } from '../config'
import { cloudAvailable } from '../lib/cloudSpace'
import { exportJsonBackup, importJsonBackup } from '../lib/backup'
import { currentTheme, setTheme, type ThemeName } from '../lib/theme'
import { compressAvatar } from '../lib/avatar'
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
  /** 导入备份恢复成功后，通知 App 刷新目录与打卡状态。 */
  imported: []
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

// ── 备份（导出 / 导入 JSON）──
const busy = ref(false)
const feedback = ref('')
const importInput = ref<HTMLInputElement | null>(null)
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

function pickImport() {
  importInput.value?.click()
}

async function onImportFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || busy.value) return
  busy.value = true
  feedback.value = '正在恢复备份…'
  try {
    const r = await importJsonBackup(file)
    feedback.value = `已恢复：目录 ${r.level1} 组 / ${r.level2} 项、打卡 ${r.records} 条`
    emit('imported')
  } catch (err) {
    feedback.value = `导入失败：${err instanceof Error ? err.message : String(err)}（现有数据未受影响）`
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

// ── 信息二级页：关于 / 关于作者 / 投诉与建议 / 鸣谢 ──
type InfoKey = 'about' | 'author' | 'feedback' | 'thanks'
const activeInfo = ref<InfoKey | null>(null)
const infoTitle = computed(() => {
  switch (activeInfo.value) {
    case 'about':
      return '关于'
    case 'author':
      return '作者与支持'
    case 'feedback':
      return '意见与反馈'
    case 'thanks':
      return '鸣谢'
    default:
      return ''
  }
})

// ── 支付宝收款码：点击放大查看 ──
const donateImg = ref<string | null>(null)
function openDonate() {
  donateImg.value = `${import.meta.env.BASE_URL}donate-alipay.png`
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

// ── 用户信息与账号安全弹窗 ──
const showProfile = ref(false)
const profileEmail = ref('')
const profilePhone = ref('')
const profileAvatar = ref<string | null>(null)
const profileBusy = ref(false)
const profileErr = ref('')
const avatarInput = ref<HTMLInputElement | null>(null)

/** 顶部用户卡片点击：登录态 → 打开信息弹窗；游客 → 唤起登录。 */
function onAccountClick() {
  if (auth.user) openProfile()
  else emit('login')
}

function openProfile() {
  if (!auth.user) return
  profileEmail.value = auth.user.email
  profilePhone.value = auth.user.phone
  profileAvatar.value = auth.user.avatar
  profileErr.value = ''
  showProfile.value = true
}

function pickAvatar() {
  avatarInput.value?.click()
}

async function onAvatarFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    profileAvatar.value = await compressAvatar(file)
    profileErr.value = ''
  } catch (err) {
    profileErr.value = err instanceof Error ? err.message : String(err)
  }
}

async function saveProfile() {
  if (profileBusy.value) return
  const email = profileEmail.value.trim()
  const phone = profilePhone.value.trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    profileErr.value = '邮箱格式不正确'
    return
  }
  if (!/^\d{6,20}$/.test(phone)) {
    profileErr.value = '手机号格式不正确'
    return
  }
  profileBusy.value = true
  profileErr.value = ''
  try {
    await updateProfile({ email, phone, avatar: profileAvatar.value })
    showProfile.value = false
    feedback.value = '账号信息已更新'
    window.setTimeout(() => (feedback.value = ''), 2200)
  } catch (e) {
    profileErr.value = e instanceof Error ? e.message : String(e)
  } finally {
    profileBusy.value = false
  }
}

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
  <!-- 信息二级页：关于 / 关于作者 / 投诉与建议 / 鸣谢 -->
  <div v-if="activeInfo" class="settings">
    <header class="bar">
      <button type="button" class="back" @click="activeInfo = null">‹ 返回</button>
      <h1>{{ infoTitle }}</h1>
    </header>

    <section class="info-detail">
      <!-- 关于 -->
      <template v-if="activeInfo === 'about'">
        <p class="block-text">支持完全自定义练声项目与上传练声曲，支持实时音调检测、跟练打卡与多端云端同步。</p>
        <p class="block-text muted">无广告，免费极简应用。</p>
        <p class="block-text muted about-version">版本 {{ appVersion }} · {{ buildId }}</p>
      </template>

      <!-- 作者与支持 -->
      <template v-else-if="activeInfo === 'author'">
        <p class="block-text">VINCE DWAN，业余入门唱歌爱好者，不务正业的ENFP小会计，赞赏给我晚饭加个鸡腿吧，感激不尽。</p>
        <button type="button" class="donate-card single" @click="openDonate">
          <img :src="`${base}donate-alipay.png`" alt="支付宝收款码" />
          <span>支付宝扫一扫，加个鸡腿</span>
        </button>
        <ul class="biz-list">
          <li>接中小企业财务分析；</li>
          <li>接个人/银企大额/小额电子过桥等，费用低廉（仅限地区：粤）；</li>
          <li>招聘我（跨境财务全盘）</li>
          <li class="biz-contact">
            <span>以上可联系 {{ FEEDBACK_EMAIL }}</span>
            <a class="biz-mail" :href="`mailto:${FEEDBACK_EMAIL}`">发邮件</a>
            <button type="button" class="biz-copy" @click="copyEmail">{{ emailCopied ? '已复制 ✓' : '复制' }}</button>
          </li>
        </ul>
      </template>

      <!-- 意见与反馈 -->
      <template v-else-if="activeInfo === 'feedback'">
        <p class="block-text">如有功能建议、问题反馈或密码找回需求，请联系邮箱 {{ FEEDBACK_EMAIL }}（邮件请注明账号信息；如需加急处理，可在「作者与支持」页赞赏后备注邮箱，优先为您查阅回复）。</p>
        <div class="feedback-row">
          <span class="feedback-email">{{ FEEDBACK_EMAIL }}</span>
          <button type="button" class="mini" @click="copyEmail">{{ emailCopied ? '已复制 ✓' : '复制邮箱' }}</button>
          <a class="mini-link" :href="`mailto:${FEEDBACK_EMAIL}`">发邮件</a>
        </div>
      </template>

      <!-- 鸣谢 -->
      <template v-else>
        <p class="block-text">特别感谢我自己的鼎力支持。</p>
      </template>
    </section>

    <!-- 支付宝收款码放大预览 -->
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
  </div>

  <!-- 主设置页 -->
  <div v-else class="settings">
    <header class="bar">
      <button type="button" class="back" @click="emit('back')">‹ 返回</button>
      <h1>设置</h1>
    </header>

    <!-- 顶部：账号与头像（点击进入用户信息与账号安全弹窗） -->
    <section
      class="account"
      role="button"
      tabindex="0"
      @click="onAccountClick"
      @keydown.enter="onAccountClick"
    >
      <img class="avatar" :src="avatarSrc" alt="头像" />
      <div class="account-info">
        <p class="username">{{ auth.user ? auth.user.username : '游客模式' }}</p>
        <p class="account-sub">
          {{ auth.user ? (auth.user.role === 'admin' ? '管理员 · 默认模板维护者' : '专属空间已就绪') : '公共只读 · 登录后可定制' }}
        </p>
      </div>
      <span v-if="auth.user" class="account-chevron" aria-hidden="true">›</span>
      <button v-if="!auth.user" type="button" class="pill primary" @click.stop="emit('login')">
        {{ cloudAvailable ? '登录 / 注册' : '账号' }}
      </button>
      <button v-else type="button" class="pill" @click.stop="logout">退出登录</button>
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
        <dt>云端状态</dt>
        <dd :class="{ ok: !!auth.user && cloudAvailable }">
          <template v-if="!cloudAvailable">未连接云端（本地模式）</template>
          <template v-else-if="!auth.user">公共只读模式</template>
          <template v-else>已连接 · {{ auth.user.role === 'admin' ? '默认模板维护者' : '专属空间' }}</template>
        </dd>
      </div>
      <div class="row">
        <dt>数据备份</dt>
        <dd class="backup-actions">
          <button type="button" class="mini" :disabled="busy" @click="onExport">导出数据备份</button>
          <button type="button" class="mini" :disabled="busy" @click="pickImport">导入备份恢复</button>
        </dd>
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
    </dl>

    <p v-if="feedback" class="backup-feedback" role="status">{{ feedback }}</p>

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

    <!-- 信息板块：5 项纯标题 + 箭头，点击进入二级页 -->
    <section class="block info-list">
      <button type="button" class="info-row" @click="activeInfo = 'about'">
        <span>关于</span>
        <span class="chevron" aria-hidden="true">›</span>
      </button>
      <button type="button" class="info-row" @click="emit('help')">
        <span>使用教程与自定义</span>
        <span class="chevron" aria-hidden="true">›</span>
      </button>
      <button type="button" class="info-row" @click="activeInfo = 'author'">
        <span>作者与支持</span>
        <span class="chevron" aria-hidden="true">›</span>
      </button>
      <button type="button" class="info-row" @click="activeInfo = 'feedback'">
        <span>意见与反馈</span>
        <span class="chevron" aria-hidden="true">›</span>
      </button>
      <button type="button" class="info-row" @click="activeInfo = 'thanks'">
        <span>鸣谢</span>
        <span class="chevron" aria-hidden="true">›</span>
      </button>
    </section>

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

    <!-- 用户信息与账号安全弹窗 -->
    <Teleport to="body">
      <Transition name="dlg">
        <div v-if="showProfile" class="dlg-mask" @click.self="showProfile = false">
          <div class="profile" role="dialog" aria-modal="true" aria-label="用户信息与账号安全">
            <p class="dlg-title">用户信息与账号安全</p>

            <div class="profile-avatar-wrap">
              <button type="button" class="profile-avatar" aria-label="更换头像" @click="pickAvatar">
                <img :src="profileAvatar || `${base}favicon.svg`" alt="头像" />
              </button>
              <button type="button" class="profile-avatar-change" @click="pickAvatar">更换头像</button>
            </div>

            <label class="profile-field">
              <span>用户名</span>
              <input :value="auth.user?.username" type="text" disabled />
            </label>
            <label class="profile-field">
              <span>绑定邮箱</span>
              <input v-model="profileEmail" type="email" autocomplete="email" placeholder="name@example.com" />
            </label>
            <label class="profile-field">
              <span>绑定手机号</span>
              <input v-model="profilePhone" inputmode="numeric" autocomplete="tel" placeholder="绑定手机号" />
            </label>
            <p class="profile-hint">
              已绑定信息用于账号找回与身份核验，请妥善保管、切勿向他人泄露；修改前请确认准确无误，以免影响后续找回。
            </p>
            <p v-if="profileErr" class="profile-err" role="alert">{{ profileErr }}</p>
            <div class="dlg-actions">
              <button type="button" class="dlg-btn ghost" @click="showProfile = false">取消</button>
              <button type="button" class="dlg-btn primary" :disabled="profileBusy" @click="saveProfile">
                {{ profileBusy ? '保存中…' : '保存' }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 隐藏文件选择：导入备份 / 更换头像 -->
    <input ref="importInput" type="file" accept=".json,application/json" hidden @change="onImportFile" />
    <input ref="avatarInput" type="file" accept="image/jpeg,image/png,image/webp" hidden @change="onAvatarFile" />
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
  cursor: pointer;
}
.account:hover {
  border-color: var(--accent-bg);
}
.account:focus-visible {
  outline: 2px solid var(--accent-bg);
  outline-offset: 2px;
}
.account-chevron {
  flex: 0 0 auto;
  color: var(--faint);
  font-size: 22px;
  line-height: 1;
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
/* ── 设置页信息板块：5 项纯标题行，点击进二级页 ── */
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
.info-list {
  padding: 6px 16px;
}
.info-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  padding: 13px 0;
  border: none;
  background: none;
  color: var(--text);
  font-family: inherit;
  font-size: 14px;
  cursor: pointer;
  text-align: left;
  border-bottom: 1px solid var(--line);
}
.info-row:last-child {
  border-bottom: none;
}
.info-detail {
  background: var(--card-glass);
  border: 1px solid var(--card-glass-border);
  -webkit-backdrop-filter: var(--card-blur);
  backdrop-filter: var(--card-blur);
  box-shadow: var(--card-glass-shadow);
  transition: background 0.5s ease, box-shadow 0.5s ease, border-color 0.5s ease;
  border-radius: var(--r-m);
  padding: 16px;
}
.chevron {
  color: var(--accent);
  font-size: 20px;
  flex: 0 0 auto;
}
/* 打赏码 */
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
/* 关于作者：单卡片居中展示 */
.donate-card.single {
  flex: none;
  width: 100%;
  max-width: 220px;
  margin: 12px auto 4px;
}
/* 业务合作说明：每条独立成行 */
.biz-list {
  margin: 14px 0 0;
  padding: 0;
  list-style: none;
}
.biz-list li {
  margin: 0 0 8px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--muted);
  opacity: 0.85;
}
.biz-list li:last-child {
  margin-bottom: 0;
}
.biz-contact {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.biz-mail {
  color: var(--accent);
  text-decoration: none;
  word-break: break-all;
}
.biz-mail:hover {
  text-decoration: underline;
}
.biz-copy {
  border: none;
  background: var(--fill);
  color: var(--accent);
  border-radius: 999px;
  font-size: 11px;
  padding: 2px 10px;
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
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
/* ── 数据备份行：导入 / 导出同排并排 ── */
.backup-actions {
  flex-wrap: wrap;
  justify-content: flex-end;
}
.backup-feedback {
  margin: 12px 0 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--accent);
}
/* 关于页：版本信息小字 */
.about-version {
  margin-top: 12px;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.01em;
}
/* ── 用户信息与账号安全弹窗 ── */
.profile {
  width: min(340px, 100%);
  max-height: 86vh;
  overflow-y: auto;
  border-radius: 22px;
  padding: 20px 20px 16px;
  text-align: left;
  background: var(--card-glass);
  -webkit-backdrop-filter: blur(40px) saturate(160%);
  backdrop-filter: blur(40px) saturate(160%);
  border: 1px solid var(--card-glass-border);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.55),
    inset 0 0 0 1px rgba(255, 255, 255, 0.14),
    0 24px 64px rgba(0, 0, 0, 0.22);
}
.profile .dlg-title {
  text-align: center;
  margin-bottom: 14px;
}
.profile-avatar-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}
.profile-avatar {
  position: relative;
  width: 72px;
  height: 72px;
  border: none;
  border-radius: 50%;
  padding: 0;
  overflow: hidden;
  cursor: pointer;
  background: var(--fill);
  box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.6);
}
.profile-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.profile-avatar-change {
  border: none;
  background: var(--fill);
  color: var(--accent);
  border-radius: 999px;
  font-size: 12px;
  padding: 5px 16px;
  cursor: pointer;
  font-family: inherit;
}
.profile-field {
  display: block;
  margin: 10px 0;
}
.profile-field span {
  display: block;
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 5px;
}
.profile-field input {
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
.profile-field input:disabled {
  opacity: 0.55;
}
.profile-hint {
  margin: 12px 0 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--muted);
  opacity: 0.9;
}
.profile-err {
  margin: 10px 0 0;
  font-size: 13px;
  line-height: 1.5;
  color: #e0300e;
}
.profile .dlg-actions {
  margin-top: 16px;
}
.dlg-enter-active .profile,
.dlg-leave-active .profile {
  transition: transform 0.26s var(--ease), opacity 0.2s ease;
}
.dlg-enter-from .profile,
.dlg-leave-to .profile {
  transform: translateY(12px) scale(0.96);
  opacity: 0;
}
</style>
