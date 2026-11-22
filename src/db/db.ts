import Dexie, { type EntityTable } from 'dexie'
import seedData from './seed.json'
import { dbName, SPACE } from '../lib/space'

/**
 * 存储隔离模型（多用户不串号的根基）：
 * - 每个用户一个独立库：登录用户 liansheng-u-<uid8>，游客/未登录为本机 liansheng
 *   （库由 dbName(SPACE) 决定，SPACE 在模块加载时按登录态确定）。
 * - level1/level2 是练习「模板结构」，可被云端模板同步覆盖（仅登录/游客各自的
 *   空间范围内）；records 是「打卡记录」，登录用户的打卡随账户云端同步
 *   （见 recordSync.ts），游客打卡只留本机、永不上传。
 * - 因此：admin 维护默认模板不会带上自己的打卡；游客打卡只留在游客本机；
 *   新用户首次初始化只有干净模板 + 空打卡（云端不携带任何人的打卡历史）。
 */

export type FileType = 'audio' | 'image'

/** 资源引用：本地文件走 OPFS（id/path），云端文件走 cloud_id（D1 user_files）。 */
export interface PracticeFile {
  id: string
  name: string
  type: FileType
  path: string
  mime: string
  /** 云端文件 id（Workers user_files 主键）；存在时播放走云端直链。 */
  cloud_id?: string
  /** 文件字节大小（云端上传后记录，用于维护页展示）。 */
  size?: number
}

/** 二级项的 config，字段按需出现，不出现的 Key 不写进库。 */
export interface ItemConfig {
  sequence?: string[]
  sets?: { min: number; max: number }
  secondsPerSet?: number
  restSeconds?: number
  timer?: number
  reps?: number | { min: number; max: number }
  secondsPerRep?: number
}

/** 一级项：只存 order，展示用的中文编号由渲染层生成。 */
export interface Level1Item {
  id: string
  order: number
  title: string
}

/** 二级项：可空字段以 undefined 表示，写入种子时不落 Key。 */
export interface Level2Item {
  id: string
  level1_id: string
  order: number
  title: string
  files?: PracticeFile[]
  note?: string
  plan?: string
  config?: ItemConfig
}

/** 旧骨架表，保留以免升级时丢数据；新逻辑统一用 records。 */
export interface PracticeRecord {
  id?: number
  date: string
  itemId: string
  durationSec: number
  note?: string
  createdAt: number
}

/** 通用键值配置：维护口令 hash 等本地设置。 */
export interface ConfigEntry {
  key: string
  value: string
}

/** 打卡记录：每项每天至多一条，completed 可来回切换；登录用户随账户云端同步。 */
export interface RecordEntry {
  /** crypto.randomUUID() */
  record_id: string
  /** YYYY-MM-DD（本地时区） */
  date: string
  practice_item_id: string
  completed: boolean
  /** Date.now() */
  updated_at: number
}

/** 待同步队列条目：打卡变更后把最新状态按 twinKey 存一份，联网 flush 上推云端。 */
export interface SyncQueueEntry {
  /** `${date}|${practice_item_id}`，业务唯一键，重复打卡/取消只保留最新一条。 */
  key: string
  record: RecordEntry
}

class AppDatabase extends Dexie {
  level1!: EntityTable<Level1Item, 'id'>
  level2!: EntityTable<Level2Item, 'id'>
  practiceRecords!: EntityTable<PracticeRecord, 'id'>
  records!: EntityTable<RecordEntry, 'record_id'>
  config!: EntityTable<ConfigEntry, 'key'>
  syncQueue!: EntityTable<SyncQueueEntry, 'key'>

  constructor() {
    super(dbName(SPACE))
    this.version(1).stores({
      // 索引：主键自增，按日期 / 练习项查询
      practiceRecords: '++id, date, itemId, createdAt',
    })
    // 目录数据在后来的版本加入；高版本只需声明本次变更的表。
    this.version(2).stores({
      level1: 'id, order',
      level2: 'id, level1_id, order',
    })
    // 打卡表：复合索引 [date+practice_item_id] 支撑「某天某项目」的幂等 upsert 与统计。
    this.version(3).stores({
      records: 'record_id, date, practice_item_id, updated_at, [date+practice_item_id]',
    })
    this.version(4).stores({
      config: 'key',
    })
    // v6 待同步队列：打卡变更的云端上推缓冲区（key 即 twinKey，登录用户才有）。
    // v5 曾声明 outbox（已废弃的本地电脑同步服务遗留）：不再声明、不再读写。
    this.version(6).stores({
      syncQueue: 'key',
    })
  }
}

export const db = new AppDatabase()

/**
 * 首次加载时写入种子。以 level1 是否为空判定，包在事务里保证原子性；
 * 重复调用安全，不会覆盖用户已有数据。
 */
export async function seedIfEmpty(): Promise<void> {
  await db.transaction('rw', db.level1, db.level2, async () => {
    if ((await db.level1.count()) > 0) return
    // JSON 推导出的 type 是 string，这里按已知种子数据收窄到领域类型。
    await db.level1.bulkAdd(seedData.level1 as Level1Item[])
    await db.level2.bulkAdd(seedData.level2 as unknown as Level2Item[])
  })
}
