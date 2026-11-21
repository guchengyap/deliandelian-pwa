#!/usr/bin/env node
/**
 * 得练得练 · 电脑端同步服务（零依赖，Node 18+）
 *
 * 启动：双击 start-sync.bat（或在本目录运行 node server.mjs）；关闭窗口 / Ctrl+C 即停止。
 * 手机端：与电脑同一 Wi-Fi，用浏览器打开启动时打印的局域网地址，添加到主屏幕即可。
 *
 * 端口 3456 同时提供：
 *  - HTTP：静态服务 ../dist（手机/电脑直接打开即用，无需另行部署）
 *  - WebSocket：接收 PWA 的打卡同步
 *
 * 协议：
 *  - 客户端 → 服务端：{type:'sync', records:[RecordEntry...]}
 *  - 服务端 → 发送者：{type:'state', records:[全量]}（即确认，客户端据此清空 outbox）
 *  - 服务端 → 其他客户端：{type:'update', records:[变更], deleted:[被覆盖删除的 record_id]}
 *
 * 合并规则：
 *  - 以 record_id 为键，updated_at 较新者胜；
 *  - 同 (date, practice_item_id) 视为同一条逻辑记录，只保留最新版本。
 *
 * 数据落本目录 sync-data.json。
 */

import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(__dirname, '..', 'dist')
const DATA_FILE = path.join(__dirname, 'sync-data.json')
const PORT = Number(process.env.SYNC_PORT || 3456)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('未找到 dist/index.html：请先在项目根目录运行 npm run build。')
  process.exit(1)
}

// ── 数据层（按空间隔离） ────────────────────────────────────
const DEFAULT_SPACE = 'default'
/** space -> { data: Map<record_id, entry>, file: string } */
const spaces = new Map()

function spaceData(space) {
  let s = spaces.get(space)
  if (!s) {
    const file = space === DEFAULT_SPACE
      ? DATA_FILE
      : path.join(__dirname, `sync-data-${space}.json`)
    const data = new Map()
    try {
      for (const e of JSON.parse(fs.readFileSync(file, 'utf8'))) data.set(e.record_id, e)
    } catch {
      // 首次启动无数据文件
    }
    s = { data, file }
    spaces.set(space, s)
  }
  return s
}

function save(space) {
  const { data, file } = spaceData(space)
  fs.writeFileSync(file, JSON.stringify([...data.values()], null, 2))
}

function validEntry(r) {
  return (
    r && typeof r === 'object' &&
    typeof r.record_id === 'string' && r.record_id.length > 0 &&
    typeof r.date === 'string' &&
    typeof r.practice_item_id === 'string' &&
    typeof r.completed === 'boolean' &&
    typeof r.updated_at === 'number'
  )
}

/** 合并：返回 {changed, deleted} 供确认与广播。 */
function merge(space, records) {
  const { data } = spaceData(space)
  const changed = []
  const deleted = []
  for (const r of records) {
    if (!validEntry(r)) continue
    const byId = data.get(r.record_id)
    if (byId && byId.updated_at >= r.updated_at) continue
    // 双键竞争：同 (date, item) 的其他记录，更新的留下，更旧的删除。
    let dominated = false
    for (const [id, e] of data) {
      if (id === r.record_id) continue
      if (e.date === r.date && e.practice_item_id === r.practice_item_id) {
        if (e.updated_at > r.updated_at || (e.updated_at === r.updated_at && id < r.record_id)) {
          dominated = true
        } else {
          data.delete(id)
          deleted.push(id)
        }
      }
    }
    if (dominated) continue
    data.set(r.record_id, r)
    changed.push(r)
  }
  if (changed.length || deleted.length) save(space)
  return { changed, deleted }
}

/** 规范化空间名，避免路径穿越与非法文件名。 */
function normalizeSpace(raw) {
  if (typeof raw !== 'string') return DEFAULT_SPACE
  const s = raw.trim().toLowerCase()
  if (!s || s === DEFAULT_SPACE || !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(s)) return DEFAULT_SPACE
  return s
}

// ── WebSocket（自实现协议，零依赖） ────────────────────────
const clients = new Set()

function sendFrame(socket, opcode, payload) {
  const len = payload.length
  let header
  if (len < 126) {
    header = Buffer.alloc(2)
    header[1] = len
  } else if (len < 65536) {
    header = Buffer.alloc(4)
    header[1] = 126
    header.writeUInt16BE(len, 2)
  } else {
    header = Buffer.alloc(10)
    header[1] = 127
    header.writeBigUInt64BE(BigInt(len), 2)
  }
  header[0] = 0x80 | opcode
  socket.write(Buffer.concat([header, payload]))
}

const sendText = (socket, str) => sendFrame(socket, 0x1, Buffer.from(str))

function readFrame(buf) {
  if (buf.length < 2) return null
  const fin = (buf[0] & 0x80) !== 0
  const opcode = buf[0] & 0x0f
  const masked = (buf[1] & 0x80) !== 0
  let len = buf[1] & 0x7f
  let off = 2
  if (len === 126) {
    if (buf.length < 4) return null
    len = buf.readUInt16BE(2)
    off = 4
  } else if (len === 127) {
    if (buf.length < 10) return null
    const big = buf.readBigUInt64BE(2)
    if (big > 2n ** 31n) return null // 超大帧直接放弃
    len = Number(big)
    off = 10
  }
  const maskLen = masked ? 4 : 0
  if (buf.length < off + maskLen + len) return null
  let payload = buf.subarray(off + maskLen, off + maskLen + len)
  if (masked) {
    const mask = buf.subarray(off, off + 4)
    const out = Buffer.allocUnsafe(len)
    for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i & 3]
    payload = out
  }
  return { fin, opcode, payload, rest: buf.subarray(off + maskLen + len) }
}

function broadcast(space, msg, except) {
  const raw = JSON.stringify(msg)
  for (const c of clients) {
    if (c !== except && c.space === space) sendText(c.socket, raw)
  }
}

function handleSyncMessage(client, raw) {
  let msg
  try {
    msg = JSON.parse(raw)
  } catch {
    return
  }
  if (msg?.type !== 'sync' || !Array.isArray(msg.records)) return
  const space = client.space
  const { changed, deleted } = merge(space, msg.records)
  // 给发送者回全量作为确认（客户端据此清空 outbox 并补齐缺失数据）。
  const { data } = spaceData(space)
  sendText(client.socket, JSON.stringify({ type: 'state', records: [...data.values()] }))
  if (changed.length || deleted.length) {
    broadcast(space, { type: 'update', records: changed, deleted }, client)
  }
}

// ── HTTP 静态服务 + WS 升级 ────────────────────────────────
const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end()
    return
  }
  let urlPath
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  } catch {
    res.writeHead(400).end()
    return
  }
  let file = path.join(DIST, urlPath === '/' ? 'index.html' : urlPath)
  if (!file.startsWith(DIST)) {
    res.writeHead(403).end()
    return
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(DIST, 'index.html') // SPA 兜底
  }
  const ext = path.extname(file).toLowerCase()
  const body = fs.readFileSync(file)
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=604800',
  })
  res.end(req.method === 'HEAD' ? undefined : body)
})

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key']
  if (!key) {
    socket.destroy()
    return
  }
  const accept = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64')
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  )
  socket.setNoDelay(true)

  let space = DEFAULT_SPACE
  try {
    space = normalizeSpace(new URL(req.url, 'http://x').searchParams.get('space'))
  } catch {
    // 解析失败按默认空间处理
  }
  const client = { socket, buf: Buffer.alloc(0), space }
  spaceData(space) // 启动时即加载该空间数据
  clients.add(client)
  socket.on('data', (chunk) => {
    client.buf = Buffer.concat([client.buf, chunk])
    for (;;) {
      const frame = readFrame(client.buf)
      if (!frame) break
      client.buf = frame.rest
      if (frame.opcode === 0x8) {
        sendFrame(socket, 0x8, Buffer.alloc(0))
        clients.delete(client)
        socket.end()
        return
      }
      if (frame.opcode === 0x9) {
        sendFrame(socket, 0xa, frame.payload)
        continue
      }
      if (frame.opcode === 0x1 && frame.fin) {
        handleSyncMessage(client, frame.payload.toString('utf8'))
      }
      // 不支持分片消息；遇到分片直接断开，客户端会重连重发。
      if (!frame.fin) {
        clients.delete(client)
        socket.destroy()
        return
      }
    }
  })
  const drop = () => {
    clients.delete(client)
  }
  socket.on('close', drop)
  socket.on('error', () => {
    drop()
    socket.destroy()
  })
})

server.listen(PORT, '0.0.0.0', () => {
  console.log('得练得练 · 电脑端同步服务已启动')
  console.log(`  本机使用   http://localhost:${PORT}/`)
  const nets = os.networkInterfaces()
  for (const list of Object.values(nets)) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`  手机访问   http://${net.address}:${PORT}/  （同一 Wi-Fi，可添加到主屏幕）`)
      }
    }
  }
  console.log('  关闭本窗口（或 Ctrl+C）即停止服务。')
  let total = 0
  for (const { data } of spaces.values()) total += data.size
  console.log(`  已有记录 ${total} 条；默认空间存 sync-data.json，其他空间存 sync-data-<空间名>.json`)
})
