import Dexie, { type EntityTable } from 'dexie'
import seedData from './seed.json'
import { dbName, SPACE } from '../lib/space'

export type FileType = 'audio' | 'image'

/** 资源引用：name 是原始文件名，path 是 OPFS 存储路径（用 id 命名避免冲突）。 */
export interface PracticeFile {
  id: string
  name: string
  type: FileType
  path: string
  mime: string
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

/** 打卡记录：每项每天至多一条，completed 可来回切换。 */
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

/** 同步待确认队列：与 RecordEntry 同构；同一 record_id 的最新一条覆盖旧条目。 */
export type OutboxEntry = RecordEntry

class AppDatabase extends Dexie {
  level1!: EntityTable<Level1Item, 'id'>
  level2!: EntityTable<Level2Item, 'id'>
  practiceRecords!: EntityTable<PracticeRecord, 'id'>
  records!: EntityTable<RecordEntry, 'record_id'>
  config!: EntityTable<ConfigEntry, 'key'>
  outbox!: EntityTable<OutboxEntry, 'record_id'>

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
    // 同步待发送队列：确认（服务端已有不旧版本）后删除。
    this.version(5).stores({
      outbox: 'record_id, updated_at',
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
