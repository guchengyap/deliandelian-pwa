import { ref } from 'vue'
import { db, type RecordEntry } from '../db/db'
import { confirmOutbox, mergeRemoteEntries, pruneDuplicates } from '../db/records'
import { SPACE } from './space'

/**
 * 电脑端同步客户端（静默）：
 * - 候选地址：当前 origin（经同步服务打开时即服务本身）；本机调试时降级试 127.0.0.1:3456
 * - 触发点：应用启动、打卡完成、visibilitychange 回到前台
 * - 协议：客户端 {type:'sync', records} → 服务端回 {type:'state', records: 全量}（即确认）；
 *   服务端把其他客户端的增量广播为 {type:'update', records, deleted}
 * - 失败静默保留 outbox，无任何 UI 打扰
 */

export const syncConnected = ref(false)

/** 自动同步开关：默认开。关闭后完全不连接/推送/接收（config 表持久化）。 */
export const autoSyncEnabled = ref(true)

const AUTO_SYNC_KEY = 'auto_sync'

/** 启动时从 config 表恢复开关状态（无记录默认开）。 */
export async function loadAutoSync(): Promise<boolean> {
  try {
    const entry = await db.config.get(AUTO_SYNC_KEY)
    autoSyncEnabled.value = entry ? entry.value !== '0' : true
  } catch {
    // 库不可用保持默认开。
  }
  return autoSyncEnabled.value
}

/** 切换开关并持久化；关闭时立即断开现有连接。 */
export async function setAutoSync(on: boolean): Promise<void> {
  autoSyncEnabled.value = on
  try {
    await db.config.put({ key: AUTO_SYNC_KEY, value: on ? '1' : '0' })
  } catch {
    // 持久化失败不中断：本次会话内状态已生效。
  }
  if (!on && ws) {
    const w = ws
    ws = null
    syncConnected.value = false
    w.close()
  }
  if (on) {
    // 立即重连；若首次尝试失败（服务恰好忙），2 秒后再补一次。
    void ensureConnection()
    setTimeout(() => {
      if (!ws) void ensureConnection()
    }, 2000)
  }
}

let ws: WebSocket | null = null
let connecting: Promise<void> | null = null
let mergedCallback: (() => void) | null = null
let started = false

function candidates(): string[] {
  // 带空间参数：服务端据此分库存储与广播，避免不同子路径用户数据串台。
  const q = `?space=${encodeURIComponent(SPACE)}`
  const list = [`ws://${location.host}${q}`]
  // 仅本机打开（vite dev/preview、本地文件）时才降级尝试独立同步服务；
  // 手机端经局域网访问时 location.host 就是同步服务，无需降级。
  if (/^(localhost|127\.)/.test(location.hostname)) list.push(`ws://127.0.0.1:3456${location.pathname}${q}`)
  return list
}

function attempt(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    let w: WebSocket
    try {
      w = new WebSocket(url)
    } catch {
      resolve(false)
      return
    }
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (!ok) w.close()
      resolve(ok)
    }
    const timer = setTimeout(() => finish(false), 2500)
    w.onopen = () => {
      clearTimeout(timer)
      settled = true
      ws = w
      syncConnected.value = true
      bind(w)
      void sendSync()
      resolve(true)
    }
    w.onerror = () => finish(false)
    w.onclose = () => finish(false)
  })
}

async function tryConnect(): Promise<void> {
  for (const url of candidates()) {
    if (await attempt(url)) return
  }
}

async function ensureConnection(): Promise<void> {
  if (!autoSyncEnabled.value) return
  if (ws && ws.readyState === WebSocket.OPEN) {
    await sendSync()
    return
  }
  if (!connecting) {
    connecting = tryConnect().finally(() => {
      connecting = null
    })
  }
  await connecting
}

/** 把 outbox 全部记录发给服务端；连接断开时静默跳过（下次触发再发）。 */
async function sendSync(): Promise<void> {
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  try {
    const outbox = await db.outbox.toArray()
    ws.send(JSON.stringify({ type: 'sync', records: outbox }))
  } catch {
    // 发送失败：保留 outbox 等待下次触发
  }
}

async function handleMessage(raw: string): Promise<void> {
  try {
    const msg = JSON.parse(raw) as {
      type?: string
      records?: RecordEntry[]
      deleted?: string[]
    }
    if (msg.type === 'state' && Array.isArray(msg.records)) {
      const changed = await mergeRemoteEntries(msg.records)
      await pruneDuplicates()
      await confirmOutbox(msg.records)
      if (changed) mergedCallback?.()
    } else if (msg.type === 'update' && Array.isArray(msg.records)) {
      const changed = await mergeRemoteEntries(msg.records, msg.deleted)
      if (changed) mergedCallback?.()
    }
  } catch {
    // 忽略无法解析的消息
  }
}

function bind(w: WebSocket): void {
  w.onmessage = (e) => void handleMessage(String(e.data))
  w.onclose = () => {
    // 连接意外断开：静默，等待下一个触发点（打卡 / 回前台 / 启动）重连。
    if (ws === w) {
      ws = null
      syncConnected.value = false
    }
  }
  w.onerror = () => {
    if (ws === w) {
      ws = null
      syncConnected.value = false
      w.close()
    }
  }
}

/** 打卡完成后调用：已连接则立刻推，未连接则尝试连接（静默；开关关闭时不做任何事）。 */
export function nudgeSync(): void {
  if (!autoSyncEnabled.value) return
  void ensureConnection()
}

/**
 * 应用启动时调用一次：注册触发点并开始首次连接尝试。
 * onMerged 在远端数据合并进本地后回调（刷新今日状态与统计）。
 */
export function startSync(onMerged: () => void): void {
  if (started) return
  started = true
  mergedCallback = onMerged
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void ensureConnection()
  })
  void loadAutoSync().then(() => ensureConnection())
}
