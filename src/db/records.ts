import { db, type RecordEntry } from './db'
import { uuid } from '../lib/uuid'

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
 * 设置某天某项目完成状态，幂等 upsert。
 * records 与 outbox 在同一事务中写入：outbox 留待同步确认，确认后清空。
 * 关闭时不新增记录（避免空白行），已有记录则保留并置 completed=false。
 */
export async function setCompletion(
  itemId: string,
  date: string,
  completed: boolean,
): Promise<void> {
  const now = Date.now()
  await db.transaction('rw', db.records, db.outbox, async () => {
    const existing = await findOne(date, itemId)
    let rid: string
    if (existing) {
      if (existing.completed === completed) return
      rid = existing.record_id
      await db.records.update(rid, { completed, updated_at: now })
    } else {
      if (!completed) return
      rid = uuid()
      await db.records.add({
        record_id: rid,
        date,
        practice_item_id: itemId,
        completed: true,
        updated_at: now,
      })
    }
    // 同 record_id 的新条目覆盖旧条目，outbox 只留每个逻辑键的最新状态。
    await db.outbox.put({
      record_id: rid,
      date,
      practice_item_id: itemId,
      completed,
      updated_at: now,
    })
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
 * 不物理删除记录——与手动取消一致，走同一 outbox 同步链路。
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
 * 合并服务端推来的记录（state 全量或 update 增量）：
 * - 同 record_id：updated_at 新者胜；
 * - 同 (date, practice_item_id) 双键竞争：只保留最新版本，败者删除；
 * - deleted 是服务端判负删除的 record_id 列表，直接删。
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

/**
 * 用服务端全量状态确认 outbox：
 * state 是服务端收到本批 outbox 并合并之后返回的全量，
 * 因此只要服务端已存在同 (date, item) 逻辑键的记录，本条即视为已送达。
 * 不再比较 updated_at——避免设备间时钟偏差导致 outbox 永不确认、反复重发。
 */
export async function confirmOutbox(serverState: RecordEntry[]): Promise<void> {
  const seen = new Set<string>()
  for (const r of serverState) seen.add(twinKey(r))
  const pending = await db.outbox.toArray()
  const acked = pending.filter((o) => seen.has(twinKey(o))).map((o) => o.record_id)
  if (acked.length) await db.outbox.bulkDelete(acked)
}

/** 待发送条数（调试用）。 */
export function outboxCount(): Promise<number> {
  return db.outbox.count()
}
