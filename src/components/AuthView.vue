<script setup lang="ts">
import { ref } from 'vue'
import { login, register } from '../lib/auth'
import { cloudAvailable } from '../lib/cloudSpace'

const emit = defineEmits<{ close: []; success: [] }>()

const base = import.meta.env.BASE_URL

type Mode = 'login' | 'register'
const mode = ref<Mode>('login')

const account = ref('')
const username = ref('')
const email = ref('')
const phone = ref('')
const password = ref('')
const avatar = ref<string | null>(null) // dataURL；空 = 默认 Logo
const busy = ref(false)
const error = ref('')

function switchMode(m: Mode) {
  mode.value = m
  error.value = ''
}

// ── 头像：默认 Logo / 本地图片压缩（256px JPEG，控制存储体积）──
const avatarInput = ref<HTMLInputElement | null>(null)

function pickAvatar() {
  avatarInput.value?.click()
}

function onAvatarFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!file.type.startsWith('image/')) {
    error.value = '头像仅支持图片'
    return
  }
  const img = new Image()
  img.onload = () => {
    const S = 256
    const canvas = document.createElement('canvas')
    canvas.width = S
    canvas.height = S
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const side = Math.min(img.width, img.height)
    ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, S, S)
    avatar.value = canvas.toDataURL('image/jpeg', 0.85)
    URL.revokeObjectURL(img.src)
  }
  img.onerror = () => {
    error.value = '图片读取失败，请换一张试试'
    URL.revokeObjectURL(img.src)
  }
  img.src = URL.createObjectURL(file)
}

// ── 提交 ──
async function submit() {
  if (busy.value) return
  error.value = ''
  if (mode.value === 'login') {
    if (!account.value.trim() || !password.value) {
      error.value = '请输入账号与密码'
      return
    }
  } else {
    if (!username.value.trim() || !email.value.trim() || !phone.value.trim() || !password.value) {
      error.value = '请填写全部必填项'
      return
    }
    if (!/^[\u4e00-\u9fa5A-Za-z0-9_-]{2,32}$/.test(username.value.trim())) {
      error.value = '用户名需 2~32 位（中文/字母/数字/下划线/连字符）'
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) {
      error.value = '邮箱格式不正确'
      return
    }
    if (!/^\d{6,20}$/.test(phone.value.trim())) {
      error.value = '手机号格式不正确'
      return
    }
    if (password.value.length < 6) {
      error.value = '密码至少 6 位'
      return
    }
  }
  busy.value = true
  try {
    if (mode.value === 'login') {
      await login(account.value.trim(), password.value)
    } else {
      await register({
        username: username.value.trim(),
        email: email.value.trim(),
        phone: phone.value.trim(),
        password: password.value,
        avatar: avatar.value,
      })
    }
    emit('success') // App 侧整页刷新，本地库随用户空间切换
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="auth">
      <div class="auth-mask" @click.self="emit('close')">
        <div class="auth-card" role="dialog" aria-modal="true" aria-label="登录或注册">
          <!-- 纯本地模式：不渲染表单、不发请求（静态托管域名对 POST 返回 405），只做说明 -->
          <div v-if="!cloudAvailable" class="offline">
            <h2>纯本地模式</h2>
            <p>当前未接入云端账号服务，注册与登录暂不可用。</p>
            <p>所有数据已自动保存在本机，无需登录即可使用全部功能。</p>
            <button type="button" class="primary" @click="emit('close')">我知道了</button>
          </div>

          <template v-else>
            <div class="tabs" role="tablist">
            <button type="button" role="tab" :class="{ active: mode === 'login' }" @click="switchMode('login')">
              登录
            </button>
            <button type="button" role="tab" :class="{ active: mode === 'register' }" @click="switchMode('register')">
              注册
            </button>
          </div>

          <!-- 登录：用户名 / 邮箱 / 手机号任一 -->
          <form v-if="mode === 'login'" class="form" @submit.prevent="submit">
            <label class="field">
              <span>用户名 / 邮箱 / 手机号</span>
              <input v-model="account" autocomplete="username" placeholder="任意一种即可" />
            </label>
            <label class="field">
              <span>密码</span>
              <input v-model="password" type="password" autocomplete="current-password" placeholder="••••••" />
            </label>
            <button type="submit" class="primary" :disabled="busy">
              {{ busy ? '登录中…' : '登录' }}
            </button>
          </form>

          <!-- 注册：4 必填 + 头像（无验证码） -->
          <form v-else class="form" @submit.prevent="submit">
            <div class="avatar-row">
              <button type="button" class="avatar" aria-label="选择头像" @click="pickAvatar">
                <img v-if="avatar" :src="avatar" alt="" />
                <img v-else :src="`${base}favicon.svg`" alt="" />
                <span class="avatar-tip">{{ avatar ? '更换' : '选头像' }}</span>
              </button>
              <p class="avatar-note">不选则使用应用默认头像</p>
            </div>
            <label class="field">
              <span>用户名 *</span>
              <input v-model="username" autocomplete="username" placeholder="2~32 位，中英文数字-_均可" />
            </label>
            <label class="field">
              <span>邮箱 *</span>
              <input v-model="email" type="email" autocomplete="email" placeholder="name@example.com" />
            </label>
            <label class="field">
              <span>手机号 *</span>
              <input v-model="phone" inputmode="numeric" autocomplete="tel" placeholder="仅用于账号标识" />
            </label>
            <label class="field">
              <span>密码 *</span>
              <input v-model="password" type="password" autocomplete="new-password" placeholder="至少 6 位" />
            </label>
            <button type="submit" class="primary" :disabled="busy">
              {{ busy ? '注册中…' : '注册并登录' }}
            </button>
          </form>

          <p v-if="error" class="error" role="alert">{{ error }}</p>
          </template>
        </div>
      </div>
    </Transition>
    <input ref="avatarInput" type="file" accept="image/*" hidden @change="onAvatarFile" />
  </Teleport>
</template>

<style scoped>
.auth-mask {
  position: fixed;
  inset: 0;
  z-index: 95;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.35);
}
.auth-card {
  width: min(340px, 100%);
  border-radius: 24px;
  padding: 18px 20px 20px;
  background: var(--card-glass);
  -webkit-backdrop-filter: blur(40px) saturate(160%);
  backdrop-filter: blur(40px) saturate(160%);
  border: 1px solid var(--card-glass-border);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.55),
    inset 0 0 0 1px rgba(255, 255, 255, 0.14),
    0 24px 64px rgba(0, 0, 0, 0.24);
}
.tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  background: var(--fill);
  border-radius: 999px;
  padding: 4px;
  margin-bottom: 18px;
}
/* 纯本地模式说明面板 */
.offline h2 {
  margin: 4px 0 10px;
  font-size: 17px;
  text-align: center;
  color: var(--text);
}
.offline p {
  margin: 0 0 8px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--muted);
  text-align: center;
}
.offline .primary {
  width: 100%;
  margin-top: 10px;
}
.tabs button {
  border: none;
  background: none;
  color: var(--muted);
  font-size: 14px;
  font-weight: 500;
  padding: 8px 0;
  border-radius: 999px;
  cursor: pointer;
  transition: color 0.2s ease;
}
.tabs button.active {
  background: var(--accent);
  color: #fff;
}
.form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.field span {
  display: block;
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 5px;
}
.field input {
  width: 100%;
  border: none;
  border-radius: var(--r-s);
  background: var(--fill);
  color: var(--text);
  padding: 10px 12px;
  font-size: 14px;
  font-family: inherit;
  box-sizing: border-box;
}
.primary {
  margin-top: 4px;
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
.primary:active {
  transform: scale(0.98);
}
.primary:disabled {
  opacity: 0.55;
  cursor: default;
}
.avatar-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.avatar {
  position: relative;
  width: 56px;
  height: 56px;
  border: none;
  border-radius: 50%;
  padding: 0;
  overflow: hidden;
  cursor: pointer;
  background: var(--fill);
  box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.6);
}
.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.avatar-tip {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  font-size: 9px;
  color: #fff;
  background: rgba(0, 0, 0, 0.45);
  padding: 2px 0;
}
.avatar-note {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.4;
}
.error {
  margin: 12px 0 0;
  font-size: 13px;
  color: #e0300e;
  text-align: center;
}
/* 过渡：遮罩淡入淡出，卡片轻微上浮缩放 */
.auth-enter-active,
.auth-leave-active {
  transition: opacity 0.22s ease;
}
.auth-enter-active .auth-card,
.auth-leave-active .auth-card {
  transition: transform 0.26s var(--ease), opacity 0.2s ease;
}
.auth-enter-from,
.auth-leave-to {
  opacity: 0;
}
.auth-enter-from .auth-card,
.auth-leave-to .auth-card {
  transform: translateY(12px) scale(0.96);
  opacity: 0;
}
</style>
