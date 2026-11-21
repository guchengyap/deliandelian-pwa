/**
 * 云端空间客户端：练习内容（level1/level2）的云端读写、文件上传删除、容量。
 *
 * 数据模型：user_spaces.data = {"level1":[...],"level2":[...]}
 * - 游客：GET /api/space/admin（公开，只读）
 * - 登录用户：GET/PUT /api/space（首次访问后端自动复制 admin 模板）
 * - admin 登录维护：PUT /api/space/admin（更新默认模板）
 * - 文件：POST /api/files 上传 → cloud_id 引用；GET /api/files/:id 公开直链
 */
import { CLOUD_API_BASE } from '../config'
import type { Level1Item, Level2Item } from '../db/db'
import { api, auth, getToken } from './auth'

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

/** 上传文件（multipart）。容量超限抛出服务端中文错误信息。 */
export async function uploadCloudFile(file: File): Promise<UploadedFile> {
  const form = new FormData()
  form.append('file', file)
  return api<UploadedFile>('/api/files', { method: 'POST', body: form })
}

/** 删除云端文件（仅 owner；404 视为已删除）。 */
export async function deleteCloudFile(id: string): Promise<void> {
  await api(`/api/files/${id}`, { method: 'DELETE' }).catch(() => {
    /* 文件不存在等场景视为已删除 */
  })
}

/** 云端文件直链（uuid 不可猜测，公开只读；供 audio/img src 直接使用）。 */
export function cloudFileUrl(id: string): string {
  return `${CLOUD_API_BASE}/api/files/${id}`
}
