/**
 * 打卡记录云端同步：登录用户打卡随账户走云端，换设备/换浏览器可恢复。
 *
 * - 上推（flush）：把本地待同步队列 syncQueue 推给 PUT /api/records；成功清队列，
 *   失败保留并派发 sync-error（联网恢复后自动重试）。
 * - 拉取（pull）：登录/切账号/启动时 GET /api/records，mergeRemoteEntries 合并进
 *   本地库（updated_at 新者胜），多端一致。
 * - 游客（无 token）与纯本地模式：cloudReady()=false，所有函数直接短路——游客
 *   打卡只留本机、永不上传；登录后本地库随用户切换，绝不混用。
 *
 * 隔离保证：后端按 JWT 解出的 user_id 读写 user_records；admin 的个人打卡只属
 * admin 自身，不进默认模板、不被游客或其他用户看到。
 */
import { api, cloudReady } from './auth'
import { db, type RecordEntry } from '../db/db'
import { mergeRemoteEntries, pruneDuplicates } from '../db/records'

/**
 * 上推串行化（Promise 链）：
 * 批量打卡（一键打卡/一键取消）逐项 setCompletion，每项都触发一次 flush。
 * 若每次 flush 各读一次「当前队列快照」再清空，极易在批量写入进行中读到
 * 不完整快照而漏推。这里把所有 flush 串到一条 Promise 链上顺序执行——
 * 每次 flush 读的是「前一次完成后的最新队列」，而显式 await flushPendingSync()
 * 排在链尾，必然读到全部变更，从而保证批量打卡最终全量上推、不漏一条。
 */
let flushChain: Promise<boolean> = Promise.resolve(true)

/** 打卡上推：读待同步队列 → PUT /api/records → 成功清队列。返回是否已同步。 */
export function flushPendingSync(): Promise<boolean> {
  if (!cloudReady()) return Promise.resolve(false)
  const run = flushChain.then(async () => {
    const queue = await db.syncQueue.toArray()
    if (!queue.length) return true
    const records = queue.map((q) => q.record)
    try {
      await api('/api/records', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records }),
      })
      await db.syncQueue.bulkDelete(queue.map((q) => q.key))
      window.dispatchEvent(new CustomEvent('liansheng:sync-done'))
      return true
    } catch (e) {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false
      window.dispatchEvent(
        new CustomEvent('liansheng:sync-error', {
          detail: {
            message: offline ? '当前离线，打卡已存本机，联网后自动同步' : '云端同步失败，已存本机，联网后自动重试',
          },
        }),
      )
      return false
    }
  })
  flushChain = run.catch(() => false)
  return run
}

/** 打卡拉取：登录/切账号/启动时把云端记录合并进本地库（离线静默，本地照常可用）。 */
export async function pullRecords(): Promise<boolean> {
  if (!cloudReady()) return false
  try {
    const data = await api<{ records: RecordEntry[] }>('/api/records')
    if (!Array.isArray(data.records)) return false
    const changed = await mergeRemoteEntries(data.records)
    if (changed) await pruneDuplicates()
    window.dispatchEvent(new CustomEvent('liansheng:sync-pulled'))
    return true
  } catch {
    return false // 离线/失败静默：打卡本地照常用，联网后 flush/pull 自动补齐
  }
}

/** 是否还有未上推的本地变更（供设置页/提示使用）。 */
export async function pendingCount(): Promise<number> {
  return db.syncQueue.count()
}

let installed = false
/** 联网恢复 / 回前台时自动补齐同步。安装幂等。 */
export function installSyncListeners(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('online', () => void flushPendingSync())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void flushPendingSync()
  })
}
