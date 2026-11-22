import { db, type RecordEntry } from './db'
import { uuid } from '../lib/uuid'

/**
 * 打卡数据不变量（多用户隔离的根基，改动前必读）：
 *
 * 1. 打卡记录只存在于「当前空间的本地 IndexedDB」records 表，永不上传云端——
 *    云端 user_spaces 只同步 {level1, level2} 模板结构（见 cloudSpace.ts 与
 *    worker 的 validateSpaceData），任何打卡状态都没有网络通道。
 * 2. 库按用户隔离：登录用户为 liansheng-u-<uid8>，游客/未登录为本机 liansheng
 *    （见 space.ts）。切换账号 = 切换整个库，天然互不干扰。
 * 3. 新用户/新库首次启动只写入种子模板（seedIfEmpty），records 从零开始，
 *    不继承任何人的历史打卡。
 * 4. 后端接口全部从 JWT 解析 user_id 过滤数据，不信任客户端传入的身份。
 */

/** 本地时区的 YYYY-MM-DD，避免 toISOString() 的 UTC 跨日问题。 */
export function dateKey(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 按 [date+practice_item_id] 找唯一记录。 */
function findOne(date: string, itemId: string): Promise<RecordEntry | undefined> {
  return db.records.where('[date+practice_item_id]').equals([date, itemId]).first()
}

const twinKey = (r: Pick<RecordEntry, 'date' | 'practice_item_id'>) =>
  `${r.date}|${r.practice_item_id}`

/**
 * 设置某天某项目完成状态，幂等 upsert，仅写本地 records 表。
 * 关闭时不新增记录（避免空白行），已有记录则保留并置 completed=false。
 */
export async function setCompletion(
  itemId: string,
  date: string,
  completed: boolean,
): Promise<void> {
  const now = Date.now()
  await db.transaction('rw', db.records, async () => {
    const existing = await findOne(date, itemId)
    if (existing) {
      if (existing.completed === completed) return
      await db.records.update(existing.record_id, { completed, updated_at: now })
    } else {
      if (!completed) return
      await db.records.add({
        record_id: uuid(),
        date,
        practice_item_id: itemId,
        completed: true,
        updated_at: now,
      })
    }
  })
}

/** 切换完成状态，返回切换后的值。 */
export async function toggleCompletion(itemId: string, date: string): Promise<boolean> {
  const existing = await findOne(date, itemId)
  const next = !(existing?.completed ?? false)
  await setCompletion(itemId, date, next)
  return next
}

/** 某天已完成的项目 id 集合。 */
export async function completedIdsOn(date: string): Promise<Set<string>> {
  const rows = await db.records.where('date').equals(date).toArray()
  return new Set(rows.filter((r) => r.completed).map((r) => r.practice_item_id))
}

/**
 * 一键取消某天全部打卡：逐项复用 setCompletion 置为未完成。
 * 不物理删除记录——与手动取消一致，记录保留在本地。
 * 返回实际取消的项数。
 */
export async function uncompleteAllOn(date: string): Promise<number> {
  const ids = await completedIdsOn(date)
  for (const id of ids) await setCompletion(id, date, false)
  return ids.size
}

/** 全部已完成记录，供统计视图一次性在内存聚合（本地数据量很小）。 */
export function allCompleted(): Promise<RecordEntry[]> {
  return db.records.filter((r) => r.completed).toArray()
}

/**
 * 合并一批记录进本地库（updated_at 新者胜 + 双键竞争裁决）。
 * 当前唯一用途：JSON 备份导入（backup.ts）——备份来自同一用户自己导出的
 * 文件，合并不涉及跨用户；云端多用户同步不存在（打卡不出本机）。
 * 返回本地数据是否有变化。
 */
export async function mergeRemoteEntries(
  remote: RecordEntry[],
  deleted: string[] = [],
): Promise<boolean> {
  let changed = false
  await db.transaction('rw', db.records, async () => {
    if (deleted.length) {
      const gone = (await db.records.bulkGet(deleted)).filter((r): r is RecordEntry => !!r)
      if (gone.length) {
        await db.records.bulkDelete(gone.map((r) => r.record_id))
        changed = true
      }
    }
    for (const r of remote) {
      if (!r || typeof r.record_id !== 'string' || typeof r.updated_at !== 'number') continue
      const twins = await db.records
        .where('[date+practice_item_id]')
        .equals([r.date, r.practice_item_id])
        .toArray()
      const same = twins.find((t) => t.record_id === r.record_id)
      if (same) {
        // 近距翻转保护：设备间时钟略有偏差时，刚发生的完成状态相反的更新
        //（间隔 30 秒内）无法可靠分辨先后——保留本地，用户刚点的打卡不被弹回。
        const flip = r.completed !== same.completed
        const recent = Math.abs(r.updated_at - same.updated_at) < 30_000
        if (flip && recent) continue
        if (r.updated_at > same.updated_at) {
          await db.records.put(r)
          changed = true
        }
        continue
      }
      // 双键竞争：本地存在更强版本则忽略远端，否则删除本地败者并写入远端。
      // 近距翻转保护：远端与本地完成状态相反且时间差在 30 秒内——设备时钟略偏时
      // 无法可靠分辨先后，保留本地，用户刚点的打卡不被另一设备的旧操作弹回。
      const flipRecent = twins.some(
        (t) => r.completed !== t.completed && Math.abs(r.updated_at - t.updated_at) < 30_000,
      )
      if (flipRecent) continue
      const dominated = twins.some(
        (t) =>
          t.updated_at > r.updated_at ||
          (t.updated_at === r.updated_at && t.record_id < r.record_id),
      )
      if (dominated) continue
      const losers = twins
        .filter((t) => t.updated_at < r.updated_at)
        .map((t) => t.record_id)
      if (losers.length) {
        await db.records.bulkDelete(losers)
        changed = true
      }
      await db.records.put(r)
      changed = true
    }
  })
  return changed
}

/** 本地全量规整：同一 (date, item) 只留 updated_at 最大者，消除历史双键残留。 */
export async function pruneDuplicates(): Promise<void> {
  const all = await db.records.toArray()
  const best = new Map<string, RecordEntry>()
  for (const r of all) {
    const k = twinKey(r)
    const cur = best.get(k)
    if (
      !cur ||
      r.updated_at > cur.updated_at ||
      (r.updated_at === cur.updated_at && r.record_id < cur.record_id)
    ) {
      best.set(k, r)
    }
  }
  const keep = new Set([...best.values()].map((r) => r.record_id))
  const drop = all.filter((r) => !keep.has(r.record_id)).map((r) => r.record_id)
  if (drop.length) await db.records.bulkDelete(drop)
}
