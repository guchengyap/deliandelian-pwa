/**
 * 云端空间客户端：练习内容（level1/level2）的云端读写、文件上传删除、容量。
 *
 * 数据模型：user_spaces.data = {"level1":[...],"level2":[...]}
 * - 游客：GET /api/space/admin（公开，只读）
 * - 登录用户：GET/PUT /api/space（首次访问后端自动复制 admin 模板）
 * - admin 登录维护：PUT /api/space/admin（更新默认模板）
 * - 文件：POST /api/files 上传 → cloud_id 引用；GET /api/files/:id 公开直链
 *
 * 隔离不变量：
 * - 云端只保存「模板结构 + 素材文件」，打卡记录（records）没有任何云端通道，
 *   仅存各自设备上对应空间的本地库——游客打卡不可能污染默认模板，
 *   admin 的个人打卡也不会出现在任何人的默认模板里。
 * - 新用户首次 GET /api/space 时后端只复制 __admin__ 模板的 level1/level2
 *   （copied=true），不含任何人的打卡记录；新用户本地 records 从零开始。
 * - 用户身份一律由后端从 JWT 解出（requireAuth），客户端传什么都不算数。
 */
import { CLOUD_API_BASE, STORAGE_LIMIT } from '../config'
import type { Level1Item, Level2Item } from '../db/db'
import { ApiError, api, auth, getToken } from './auth'

/** 云端是否已配置：未配置时应用回退纯本地模式。 */
export const cloudAvailable = CLOUD_API_BASE !== ''

export interface SpacePayload {
  level1: Level1Item[]
  level2: Level2Item[]
}

interface SpaceResp {
  data: SpacePayload
  updated_at: number
  copied?: boolean
}

/** 是否允许写云端（维护保存/上传的前提）：云端已配置且已登录。 */
export function canWriteCloud(): boolean {
  return cloudAvailable && isLoggedIn()
}

function isLoggedIn(): boolean {
  return !!getToken()
}

/** 游客读取默认模板空间（公开接口，无需登录）。 */
export function fetchAdminSpace(): Promise<SpaceResp> {
  return fetch(`${CLOUD_API_BASE}/api/space/admin`).then((r) => {
    if (!r.ok) throw new Error(`读取默认空间失败（${r.status}）`)
    return r.json() as Promise<SpaceResp>
  })
}

/** 登录用户读取自己的空间（后端首次自动复制模板，copied=true 表示刚初始化）。 */
export function fetchMySpace(): Promise<SpaceResp> {
  return api<SpaceResp>('/api/space')
}

/** 保存空间：admin → 更新默认模板；普通用户 → 更新自己的空间。 */
export async function saveSpace(data: SpacePayload): Promise<void> {
  if (auth.user?.role === 'admin') {
    await api('/api/space/admin', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data }),
    })
  } else {
    await api('/api/space', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data }),
    })
  }
}

/** 我的空间重置为默认模板。 */
export async function resetMySpace(): Promise<SpacePayload> {
  const r = await api<{ ok: boolean; data: SpacePayload }>('/api/space/reset', { method: 'POST' })
  return r.data
}

export interface UploadedFile {
  id: string
  name: string
  mime: string
  size: number
}

/** 容量视图：后端固定返回这两个字段，前端圆环与提示统一使用。 */
export interface FileUsage {
  usedBytes: number
  quotaBytes: number
}

/** 云端文件元信息（列表用，不含二进制）。 */
export interface CloudFileMeta {
  id: string
  name: string
  mime: string
  size: number
  created_at: number
}

export interface FileListResult extends FileUsage {
  files: CloudFileMeta[]
}

/** 容量不足：携带后端返回的具体数值，供弹窗写清"剩余/当前文件"。 */
export class QuotaError extends Error {
  usedBytes: number
  quotaBytes: number
  incomingBytes: number
  remainingBytes: number

  constructor(message: string, usedBytes: number, quotaBytes: number, incomingBytes: number, remainingBytes: number) {
    super(message)
    this.name = 'QuotaError'
    this.usedBytes = usedBytes
    this.quotaBytes = quotaBytes
    this.incomingBytes = incomingBytes
    this.remainingBytes = remainingBytes
  }
}

/** 兼容 used/limit 与 usedBytes/quotaBytes 两种命名。 */
function normalizeUsage(raw: { usedBytes?: number; quotaBytes?: number; used?: number; limit?: number }): FileUsage {
  return {
    usedBytes: raw.usedBytes ?? raw.used ?? 0,
    quotaBytes: raw.quotaBytes ?? raw.limit ?? STORAGE_LIMIT,
  }
}

/** 同步 auth.usage，让设置页/维护页所有容量显示立即一致（无需刷新页面）。 */
function absorbUsage(usage: FileUsage): void {
  if (auth.usage) {
    auth.usage.used = usage.usedBytes
    auth.usage.limit = usage.quotaBytes
  } else {
    auth.usage = { used: usage.usedBytes, limit: usage.quotaBytes }
  }
}

/** 列表 + 实时用量（鉴权，仅返回当前账号的文件）。 */
export async function listCloudFiles(): Promise<FileListResult> {
  const r = await api<FileListResult & { used?: number; limit?: number }>('/api/files')
  const usage = normalizeUsage(r)
  absorbUsage(usage)
  return { files: r.files ?? [], ...usage }
}

/** 删除单个云端文件；返回删除后的最新用量（并同步 auth.usage）。 */
export async function deleteCloudFile(id: string): Promise<FileUsage> {
  const r = await api<FileUsage & { used?: number; limit?: number }>(`/api/files/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
  const usage = normalizeUsage(r)
  absorbUsage(usage)
  return usage
}

/** 清理型删除：失败不打扰主流程（替换/丢弃草稿时用）。 */
export async function deleteCloudFileQuiet(id: string): Promise<void> {
  await deleteCloudFile(id).catch(() => {})
}

/** 上传文件（multipart）。配额不足抛 QuotaError，其余错误原样抛出。 */
export async function uploadCloudFile(file: File): Promise<UploadedFile & FileUsage> {
  const form = new FormData()
  form.append('file', file)
  try {
    const r = await api<UploadedFile & FileUsage & { used?: number; limit?: number }>('/api/files', {
      method: 'POST',
      body: form,
    })
    const usage = normalizeUsage(r)
    absorbUsage(usage)
    return { ...r, ...usage }
  } catch (e) {
    if (e instanceof ApiError && e.payload?.code === 'QUOTA_EXCEEDED') {
      const p = e.payload as Record<string, number>
      throw new QuotaError(
        e.message,
        p.usedBytes ?? 0,
        p.quotaBytes ?? STORAGE_LIMIT,
        p.incomingBytes ?? file.size,
        p.remainingBytes ?? Math.max(0, (p.quotaBytes ?? STORAGE_LIMIT) - (p.usedBytes ?? 0)),
      )
    }
    throw e
  }
}

/** 剩余可用字节（不小于 0）。 */
export function remainingBytes(usage: { usedBytes: number; quotaBytes: number }): number {
  return Math.max(0, usage.quotaBytes - usage.usedBytes)
}

/** 云端文件直链（uuid 不可猜测，公开只读；供 audio/img src 直接使用）。 */
export function cloudFileUrl(id: string): string {
  return `${CLOUD_API_BASE}/api/files/${id}`
}
