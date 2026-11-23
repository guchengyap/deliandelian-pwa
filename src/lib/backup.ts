import { unzip, zip, strFromU8, strToU8 } from 'fflate'
import {
  db,
  type ConfigEntry,
  type Level1Item,
  type Level2Item,
  type RecordEntry,
} from '../db/db'
import { mergeRemoteEntries, pruneDuplicates } from '../db/records'
import {
  deleteOpfsFile,
  enumerateOpfsFiles,
  invalidateFileUrl,
  writeOpfsFile,
} from './opfsFiles'

/**
 * 离线备份：把本地全部数据打成一个 zip（纯前端，不经过任何服务端）。
 * - records.json          打卡记录（RecordEntry[]）
 * - practice-items.json   完整目录（level1 / level2，含 order、files、note、plan、config）
 * - files/<id>            OPFS 中用户上传 / 替换的音频与图片
 */

const RECORDS_FILE = 'records.json'
const ITEMS_FILE = 'practice-items.json'
const FILES_PREFIX = 'files/'

export interface ImportResult {
  records: number
  level1: number
  level2: number
  files: number
}

interface ItemsPayload {
  level1: Level1Item[]
  level2: Level2Item[]
}

function zipAsync(files: Record<string, Uint8Array<ArrayBuffer>>): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    zip(files, (err, data) => (err ? reject(err) : resolve(data)))
  })
}

function unzipAsync(data: Uint8Array): Promise<Record<string, Uint8Array<ArrayBuffer>>> {
  return new Promise((resolve, reject) => {
    unzip(data, (err, files) => (err ? reject(err) : resolve(files)))
  })
}

function localDate(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 导出并触发浏览器下载，返回 zip 内的简要统计。 */
export async function exportBackup(): Promise<ImportResult> {
  const [records, level1, level2, opfsFiles] = await Promise.all([
    db.records.toArray(),
    db.level1.orderBy('order').toArray(),
    db.level2.orderBy('order').toArray(),
    enumerateOpfsFiles(),
  ])

  const entries: Record<string, Uint8Array<ArrayBuffer>> = {
    [RECORDS_FILE]: strToU8(JSON.stringify(records)),
    [ITEMS_FILE]: strToU8(JSON.stringify({ level1, level2 } satisfies ItemsPayload)),
  }
  for (const f of opfsFiles) {
    entries[FILES_PREFIX + f.name] = new Uint8Array(await f.blob.arrayBuffer())
  }

  const blob = new Blob([await zipAsync(entries)], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `练声助手-备份-${localDate()}.zip`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)

  return { records: records.length, level1: level1.length, level2: level2.length, files: opfsFiles.length }
}

/** 单文件 JSON 备份（云端模式下文件已存云端，无需打包 OPFS）。返回条目数。 */
export async function exportJsonBackup(): Promise<number> {
  const [records, level1, level2, config] = await Promise.all([
    db.records.toArray(),
    db.level1.orderBy('order').toArray(),
    db.level2.orderBy('order').toArray(),
    db.config.toArray(),
  ])
  const payload = { app: 'liansheng', version: 1, exported_at: Date.now(), records, level1, level2, config }
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `练声助手-备份-${localDate()}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return records.length + level1.length + level2.length
}

/** 从备份 File 恢复。校验后先合并记录，再整体替换目录，最后写回 OPFS 文件。 */
export async function importBackup(file: File): Promise<ImportResult> {
  const entries = await unzipAsync(new Uint8Array(await file.arrayBuffer()))

  if (!entries[ITEMS_FILE]) throw new Error('备份缺少练声项目录（practice-items.json）')
  let payload: ItemsPayload
  let records: RecordEntry[]
  try {
    payload = JSON.parse(strFromU8(entries[ITEMS_FILE])) as ItemsPayload
    records = entries[RECORDS_FILE]
      ? (JSON.parse(strFromU8(entries[RECORDS_FILE])) as RecordEntry[])
      : []
  } catch {
    throw new Error('备份文件解析失败，可能已损坏')
  }
  if (!Array.isArray(payload.level1) || !Array.isArray(payload.level2) || !Array.isArray(records)) {
    throw new Error('备份数据结构不正确')
  }

  // 1) 记录按 record_id 合并，updated_at 新者胜；同键双胞胎去重。
  //    备份来自用户自己导出的文件，合并不涉及跨用户数据。
  await mergeRemoteEntries(records)
  await pruneDuplicates()

  // 2) 整体恢复练声项目录（保留 id 以免打卡历史断链；order 原样带回）。
  //    编号由渲染层按 order 重新生成，无需另存编号字段。
  await db.transaction('rw', db.level1, db.level2, async () => {
    await db.level1.clear()
    await db.level2.clear()
    await db.level1.bulkAdd(payload.level1)
    await db.level2.bulkAdd(payload.level2)
  })

  // 3) 文件写回 OPFS：只接受 files/ 下的扁平文件名，拒绝任何路径穿越。
  const opfsNames = new Set<string>()
  for (const [path, data] of Object.entries(entries)) {
    if (!path.startsWith(FILES_PREFIX)) continue
    const name = path.slice(FILES_PREFIX.length)
    if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..') continue
    await writeOpfsFile(name, new Blob([data]))
    invalidateFileUrl(name)
    opfsNames.add(name)
  }
  // 本地 OPFS 中备份已不再引用的文件清除，避免残留旧方案资源。
  for (const local of await enumerateOpfsFiles()) {
    if (!opfsNames.has(local.name)) await deleteOpfsFile(local.name)
  }

  return {
    records: records.length,
    level1: payload.level1.length,
    level2: payload.level2.length,
    files: opfsNames.size,
  }
}

/**
 * 从「导出数据备份」产生的 JSON 文件恢复（目录 + 打卡 + 配置）。
 * 格式无效时抛错且不落任何数据，绝不覆盖现有有效内容；恢复后由调用方刷新界面状态。
 */
export async function importJsonBackup(file: File): Promise<ImportResult> {
  let payload: {
    app?: string
    version?: number
    records?: unknown
    level1?: unknown
    level2?: unknown
    config?: unknown
  }
  try {
    payload = JSON.parse(await file.text())
  } catch {
    throw new Error('备份文件解析失败，可能不是有效的 JSON 备份')
  }
  if (!payload || payload.app !== 'liansheng') throw new Error('备份文件格式不正确')

  const records = Array.isArray(payload.records) ? (payload.records as RecordEntry[]) : []
  const level1 = Array.isArray(payload.level1) ? (payload.level1 as Level1Item[]) : []
  const level2 = Array.isArray(payload.level2) ? (payload.level2 as Level2Item[]) : []
  if (!level1.length && !level2.length) throw new Error('备份中缺少练声项目录数据')

  const okL1 = level1.every(
    (x) => x && typeof x.id === 'string' && typeof x.order === 'number' && typeof x.title === 'string',
  )
  const okL2 = level2.every(
    (x) =>
      x &&
      typeof x.id === 'string' &&
      typeof x.order === 'number' &&
      typeof x.title === 'string' &&
      typeof x.level1_id === 'string',
  )
  if (!okL1 || !okL2) throw new Error('备份数据结构不正确')

  // 1) 打卡记录合并（updated_at 新者胜；失败会抛错，不触碰目录）
  await mergeRemoteEntries(records)
  await pruneDuplicates()

  // 2) 整体恢复练声项目录（保留 id 以免打卡历史断链；order 原样带回）
  await db.transaction('rw', db.level1, db.level2, async () => {
    await db.level1.clear()
    await db.level2.clear()
    await db.level1.bulkAdd(level1)
    await db.level2.bulkAdd(level2)
  })

  // 3) 本地配置（主题等）恢复
  if (Array.isArray(payload.config)) {
    const cfg = payload.config as ConfigEntry[]
    await db.transaction('rw', db.config, async () => {
      for (const c of cfg) {
        if (c && typeof c.key === 'string' && typeof c.value === 'string') await db.config.put(c)
      }
    })
  }

  return { records: records.length, level1: level1.length, level2: level2.length, files: 0 }
}
