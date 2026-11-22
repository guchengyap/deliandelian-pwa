/**
 * 账号体系：登录状态、Token 持久化、注册/登录/登出。
 *
 * - Token 存 localStorage（key: auth_token），刷新页面保持登录；
 *   space.ts 在模块加载时同步读取它推导本地库隔离空间，因此本模块
 *   必须先于 db.ts 初始化（main.ts 里最先 await initAuth()）。
 * - 用户基础信息缓存于 localStorage（auth_user），云端 /api/me 刷新。
 * - 未登录 = 游客模式：读取 admin 默认空间（只读）。
 */
import { reactive } from 'vue'
import { CLOUD_API_BASE, STORAGE_LIMIT } from '../config'

export interface AuthUser {
  id: string
  username: string
  email: string
  phone: string
  role: 'admin' | 'user'
  avatar: string | null
  created_at: number
}

export interface Usage {
  used: number
  limit: number
}

const TOKEN_KEY = 'auth_token'
const USER_KEY = 'auth_user'

export const auth = reactive<{
  user: AuthUser | null
  ready: boolean
  usage: Usage | null
}>({
  user: null,
  ready: false,
  usage: null,
})

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

function cacheUser(user: AuthUser | null) {
  auth.user = user
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user))
  else localStorage.removeItem(USER_KEY)
}

function readCachedUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? (JSON.parse(raw) as AuthUser) : null
  } catch {
    return null
  }
}

export function isLoggedIn(): boolean {
  return !!getToken()
}

/** 应用入口调用：读缓存 → 云端校验/刷新；失败清 Token 回退游客。 */
export async function initAuth(): Promise<void> {
  const cached = readCachedUser()
  const token = getToken()
  if (token && cached) {
    auth.user = cached // 先用缓存，避免闪游客态
  }
  if (token && CLOUD_API_BASE) {
    try {
      const r = await api<ApiAuth>('/api/me')
      cacheUser(r.user)
      auth.usage = r.usage ?? null
    } catch {
      // Token 失效：静默回退游客（不弹错，不打扰首屏）
      localStorage.removeItem(TOKEN_KEY)
      cacheUser(null)
      auth.usage = null
    }
  }
  if (!isLoggedIn()) {
    localStorage.removeItem(TOKEN_KEY)
    cacheUser(null)
  }
  auth.ready = true
}

interface ApiAuth {
  token: string
  user: AuthUser
  usage?: Usage
}

/** 接口错误：保留 HTTP 状态与服务端结构化字段（配额类错误需要 usedBytes 等）。 */
export class ApiError extends Error {
  status: number
  payload: (Record<string, unknown> & { error?: string }) | null

  constructor(message: string, status: number, payload: (Record<string, unknown> & { error?: string }) | null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.payload = payload
  }
}

/** 统一请求封装：注入 Bearer，非 2xx 抛出 ApiError（message 为服务端文案）。 */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const resp = await fetch(`${CLOUD_API_BASE}${path}`, { ...init, headers })
  const data = (await resp.json().catch(() => null)) as (T & { error?: string }) | null
  if (!resp.ok) throw new ApiError(data?.error || `请求失败（${resp.status}）`, resp.status, data)
  return data as T
}

export interface RegisterFields {
  username: string
  email: string
  password: string
  phone: string
  avatar?: string | null // dataURL，可空
}

/**
 * 云端未配置（纯本地模式）时的兜底拦截。
 * 若放行，fetch 会以相对路径把 POST 打到当前静态托管域名（如 GitHub Pages），
 * Pages 只支持 GET，POST 一律 405——用户只能看到莫名的「请求失败 (405)」。
 */
function requireCloud(): void {
  if (!CLOUD_API_BASE) {
    throw new Error('当前为纯本地模式，未接入云端账号服务，注册与登录不可用；所有数据已自动保存在本机')
  }
}

export async function register(fields: RegisterFields): Promise<AuthUser> {
  requireCloud()
  const r = await api<ApiAuth>('/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  })
  localStorage.setItem(TOKEN_KEY, r.token)
  cacheUser(r.user)
  auth.usage = r.usage ?? { used: 0, limit: STORAGE_LIMIT }
  return r.user
}

export async function login(account: string, password: string): Promise<AuthUser> {
  requireCloud()
  const r = await api<ApiAuth>('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account, password }),
  })
  localStorage.setItem(TOKEN_KEY, r.token)
  cacheUser(r.user)
  auth.usage = r.usage ?? null
  return r.user
}

/** 刷新容量显示（上传/删除后调用）。 */
export async function refreshUsage(): Promise<void> {
  if (!isLoggedIn() || !CLOUD_API_BASE) return
  try {
    auth.usage = await api<Usage>('/api/usage')
  } catch {
    // 容量刷新失败不打扰主流程
  }
}

/**
 * 退出登录：清凭证后整页刷新。
 * 会话缓存清理点：auth_token / auth_user 从 localStorage 移除；内存态
 * （auth.user / auth.usage）随 reload 重置；本地库随 space.ts 重新推导，
 * 切回游客空间（liansheng）。下个用户登录后落在自己的 liansheng-u-<uid8>
 * 库，互相看不到对方的打卡记录。
 */
export function logout(): void {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
  location.reload()
}
