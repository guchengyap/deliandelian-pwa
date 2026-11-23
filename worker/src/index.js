/**
 * 练声助手线上后端（Cloudflare Workers + D1）
 *
 * 接口一览（全部 JSON，除文件读取）：
 *   GET  /api/health            健康检查
 *   POST /api/register          注册 {username,email,password,phone,avatar?}
 *   POST /api/login             登录 {account,password}（用户名/邮箱/手机号任一）
 *   POST /api/auth/reset-password  忘记密码自助重置 {username,email,phone,password}（禁止重置 admin）
 *   POST /api/admin/reset-user-password  管理员协助重置用户密码 {identifier,newPassword}（仅 admin；递增 token_version）
 *   GET  /api/me                当前用户 + 已用容量（鉴权）
 *   GET  /api/space/admin       默认模板空间（公开；游客与初始模板来源）
 *   PUT  /api/space/admin       保存默认模板空间（仅 admin）
 *   GET  /api/space             我的空间（鉴权；无数据时自动复制 admin 模板）
 *   PUT  /api/space             保存我的空间（鉴权）
 *   POST /api/space/reset       我的空间重置为默认模板（鉴权）
 *   GET  /api/usage             已用容量 {usedBytes,quotaBytes}（鉴权）
 *   GET  /api/records           我的全部打卡记录（鉴权；随账户云端同步）
 *   PUT  /api/records           上推/合并打卡记录（鉴权；按 date+practice_item_id 双键、updated_at 新者胜）
 *   POST /api/files             上传文件 multipart（鉴权；写入前校验 usedBytes+size<=quotaBytes，超额 413）
 *   GET  /api/files             我的文件列表 + 实时用量（鉴权）
 *   GET  /api/files/:id         文件内容（公开直链，id 为不可猜测 uuid）
 *   DELETE /api/files/:id       删除文件（鉴权，仅 owner；返回删除后 usedBytes）
 *
 * 安全：密码 PBKDF2-SHA256(10 万迭代) 加盐；JWT(HS256, 30 天)；
 *       文件公开读依赖不可猜测 uuid；CORS 白名单反射 env.ALLOWED_ORIGINS。
 *
 * 数据隔离（多用户不串号的根基）：
 * - 所有用户数据查询/写入的 user_id 一律取自 JWT（requireAuth），不信任客户端；
 * - user_spaces 只存 {level1, level2} 模板结构（validateSpaceData 白名单校验），
 *   新用户首次 GET /api/space 仅复制 __admin__ 模板（level1/level2），不携带任何人的打卡；
 * - 打卡记录单独存 user_records，严格按 user_id 隔离：admin 的个人打卡只属 admin，
 *   游客读取的默认模板（user_spaces.__admin__）不含任何人的打卡状态；
 *   未登录游客无 token，无法读写 user_records——游客本地打卡仅当前设备试用，不回写云端。
 */

import seed from './seed.json'

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    const cors = corsHeaders(request, env)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

    try {
      const resp = await route(request, env, url)
      return resp
    } catch (err) {
      const status = err?.status ?? 500
      // extra 用于配额类错误携带结构化字段（usedBytes / quotaBytes / incomingBytes 等）
      return json({ error: err?.message ?? '服务器内部错误', ...(err?.extra ?? {}) }, status, cors)
    }
  },
}

// ── 基础设施 ─────────────────────────────────────────────

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') ?? ''
  const allowed = String(env.ALLOWED_ORIGINS ?? '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const allow = allowed.includes('*') || allowed.includes(origin) ? origin || '*' : allowed[0]
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type',
    'Access-Control-Max-Age': '86400',
  }
}

function json(obj, status = 200, cors = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors },
  })
}

function fail(status, message, extra) {
  const err = new Error(message)
  err.status = status
  if (extra) err.extra = extra
  throw err
}

const enc = new TextEncoder()

function b64urlFromBuffer(buf) {
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(str) {
  const pad = str.length % 4 ? '='.repeat(4 - (str.length % 4)) : ''
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad)
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
}

async function signToken(payload, secret) {
  const head = b64urlFromBuffer(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const body = b64urlFromBuffer(enc.encode(JSON.stringify(payload)))
  const key = await hmacKey(secret)
  const sig = b64urlFromBuffer(await crypto.subtle.sign('HMAC', key, enc.encode(`${head}.${body}`)))
  return `${head}.${body}.${sig}`
}

async function verifyToken(token, secret) {
  const parts = String(token).split('.')
  if (parts.length !== 3) fail(401, '登录状态无效')
  const key = await hmacKey(secret)
  const expect = b64urlFromBuffer(await crypto.subtle.sign('HMAC', key, enc.encode(`${parts[0]}.${parts[1]}`)))
  if (expect !== parts[2]) fail(401, '登录状态无效')
  const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])))
  if (!payload.uid || payload.exp < Date.now()) fail(401, '登录已过期，请重新登录')
  return payload
}

/** 从 Authorization: Bearer 取 token 并校验，返回 {uid, role}（role 取自数据库最新值）。 */
async function requireAuth(request, env) {
  const raw = request.headers.get('Authorization') ?? ''
  const token = raw.startsWith('Bearer ') ? raw.slice(7) : ''
  if (!token) fail(401, '请先登录')
  const payload = await verifyToken(token, env.JWT_SECRET)
  const user = await getUserById(env, payload.uid)
  if (!user) fail(401, '用户不存在')
  // token_version 校验：密码被重置（自助或管理员协助）后旧 JWT 立即失效。
  // 历史 token 无 tv 字段视作 0，与旧库默认值一致，避免升级时误踢所有已登录用户。
  const tokenTv = typeof payload.tv === 'number' ? payload.tv : 0
  const curTv = typeof user.token_version === 'number' ? user.token_version : 0
  if (tokenTv !== curTv) fail(401, '登录已失效，请重新登录')
  return { uid: payload.uid, role: user.role }
}

/** PBKDF2-SHA256 加盐哈希，返回 "salt.hex:hash.hex"。 */
async function hashPassword(password, saltHex) {
  const salt = saltHex ? Uint8Array.from(saltHex.match(/../g).map((h) => parseInt(h, 16))) : crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 },
    key,
    256,
  )
  return `${hex(salt)}:${hex(bits)}`
}

async function verifyPassword(password, stored) {
  const [saltHex] = stored.split(':')
  return (await hashPassword(password, saltHex)) === stored
}

function uuid() {
  return crypto.randomUUID()
}

const now = () => Date.now()

// ── 校验 ─────────────────────────────────────────────────

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const RE_PHONE = /^\d{6,20}$/
const RE_USERNAME = /^[\u4e00-\u9fa5A-Za-z0-9_-]{2,32}$/

function validateReg({ username, email, password, phone }) {
  if (!username || !RE_USERNAME.test(username)) fail(400, '用户名需 2~32 位（中文/字母/数字/下划线/连字符）')
  if (!email || !RE_EMAIL.test(email)) fail(400, '邮箱格式不正确')
  if (!password || password.length < 6) fail(400, '密码至少 6 位')
  if (!phone || !RE_PHONE.test(phone)) fail(400, '手机号格式不正确')
}

function validateSpaceData(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.level1) || !Array.isArray(data.level2)) {
    fail(400, '空间数据格式不正确')
  }
  if (JSON.stringify(data).length > 2 * 1024 * 1024) fail(413, '空间数据过大（上限 2MB）')
}

/** 用户名脱敏：保留首尾字符，中间用 * 填充（如「张三」→「张*」，「小明同学」→「小**学」）。 */
function maskUsername(name) {
  const s = String(name ?? '')
  if (s.length <= 1) return s
  if (s.length === 2) return s[0] + '*'
  return s[0] + '*'.repeat(s.length - 2) + s[s.length - 1]
}

// ── D1 助手 ──────────────────────────────────────────────

const getUserById = (env, id) => env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first()
const getAdminUser = (env) =>
  env.DB.prepare("SELECT * FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1").first()

async function spaceRow(env, userId) {
  return env.DB.prepare('SELECT user_id, data, updated_at FROM user_spaces WHERE user_id = ?').bind(userId).first()
}

/** 默认模板空间行：admin 用户维护的空间 __admin__；没有则用内置 seed 播种。 */
async function adminSpaceRow(env) {
  let row = await spaceRow(env, '__admin__')
  if (!row) {
    const data = JSON.stringify({ level1: seed.level1, level2: seed.level2 })
    await env.DB
      .prepare('INSERT INTO user_spaces (user_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
      .bind('__admin__', data, now())
      .run()
    row = await spaceRow(env, '__admin__')
  }
  return row
}

/** 读取（必要时复制模板）用户空间。 */
async function ensureUserSpace(env, userId) {
  let row = await spaceRow(env, userId)
  let copied = false
  if (!row) {
    const tpl = await adminSpaceRow(env)
    const inserted = await env.DB
      .prepare('INSERT INTO user_spaces (user_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
      .bind(userId, tpl.data, now())
      .run()
    copied = inserted.success
    row = (await spaceRow(env, userId)) ?? tpl
  }
  return { row, copied }
}

/** 已用容量 = 文件字节总和 + 空间 JSON 字节数。 */
async function usedBytes(env, userId) {
  const files = await env.DB
    .prepare('SELECT COALESCE(SUM(size), 0) AS s FROM user_files WHERE user_id = ?')
    .bind(userId)
    .first()
  const space = await spaceRow(env, userId)
  return (files?.s ?? 0) + new TextEncoder().encode(space?.data ?? '').length
}

async function saveSpaceRow(env, userId, data) {
  validateSpaceData(data)
  const json = JSON.stringify({ level1: data.level1, level2: data.level2 })
  await env.DB
    .prepare(
      'INSERT INTO user_spaces (user_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at',
    )
    .bind(userId, json, now())
    .run()
}

/** 统一的容量视图：{usedBytes, quotaBytes}（前端圆环与提示都用这两个字段）。 */
async function quotaView(env, userId) {
  return { usedBytes: await usedBytes(env, userId), quotaBytes: LIMIT }
}

/**
 * 从某个空间 JSON 中摘除对指定云端文件的引用。
 * admin 删除默认模板文件时调用：模板是所有用户首次进入时的复制源，
 * 留着悬空 cloud_id 会让所有人看到失效素材，因此同步清理这条"公共记录"。
 * 返回是否真的改动了内容。
 */
async function stripFileFromSpace(env, userId, fileId) {
  const row = await spaceRow(env, userId)
  if (!row) return false
  let data
  try {
    data = JSON.parse(row.data)
  } catch {
    return false
  }
  if (!Array.isArray(data?.level2)) return false
  let changed = false
  for (const item of data.level2) {
    if (!Array.isArray(item?.files)) continue
    const removedLocalIds = new Set()
    const kept = item.files.filter((f) => {
      if (f && f.cloud_id === fileId) {
        removedLocalIds.add(f.id)
        return false
      }
      return true
    })
    if (kept.length === item.files.length) continue
    item.files = kept
    changed = true
    // config.sequence 里保存的是本地 file.id，一并移除，避免播放序列指向空文件
    if (Array.isArray(item.config?.sequence)) {
      item.config.sequence = item.config.sequence.filter((id) => !removedLocalIds.has(id))
    }
  }
  if (!changed) return false
  await saveSpaceRow(env, userId, data)
  return true
}

// ── 路由 ─────────────────────────────────────────────────

async function route(request, env, url) {
  const cors = corsHeaders(request, env)
  const path = url.pathname.replace(/\/+$/, '')
  const method = request.method

  if (path === '/api/health') return json({ ok: true, time: now() }, 200, cors)

  // ── 注册 ──
  if (path === '/api/register' && method === 'POST') {
    const body = await request.json().catch(() => null)
    if (!body) fail(400, '请求体不是合法 JSON')
    validateReg(body)
    const count = await env.DB.prepare('SELECT COUNT(*) AS c FROM users').first()
    const role = count.c === 0 ? 'admin' : 'user' // 第一个注册的用户自动成为管理员
    const id = uuid()
    const passHash = await hashPassword(body.password)
    const avatar = typeof body.avatar === 'string' && body.avatar.length <= 300_000 ? body.avatar : null
    try {
      await env.DB
        .prepare('INSERT INTO users (id, username, email, phone, pass_hash, avatar, role, created_at) VALUES (?,?,?,?,?,?,?,?)')
        .bind(id, body.username.trim(), body.email.trim(), body.phone.trim(), passHash, avatar, role, now())
        .run()
    } catch (e) {
      if (String(e).includes('UNIQUE')) fail(409, '用户名 / 邮箱 / 手机号已被注册')
      throw e
    }
    const token = await signToken({ uid: id, role, tv: 0, exp: now() + 30 * 864e5 }, env.JWT_SECRET)
    return json({ token, user: publicUser(await getUserById(env, id)) }, 200, cors)
  }

  // ── 登录：用户名 / 邮箱 / 手机号任一 ──
  if (path === '/api/login' && method === 'POST') {
    const body = await request.json().catch(() => null)
    if (!body?.account || !body?.password) fail(400, '请输入账号与密码')
    const account = String(body.account).trim()
    const user = await env.DB
      .prepare('SELECT * FROM users WHERE username = ?1 OR email = ?1 OR phone = ?1')
      .bind(account)
      .first()
    if (!user || !(await verifyPassword(body.password, user.pass_hash))) fail(401, '账号或密码不正确')
    const token = await signToken({ uid: user.id, role: user.role, tv: user.token_version ?? 0, exp: now() + 30 * 864e5 }, env.JWT_SECRET)
    return json({ token, user: publicUser(user) }, 200, cors)
  }

  // ── 忘记密码：自助重置（免第三方发信，零成本）──
  // 多要素核验：username + email + phone 三项完全一致才允许重置；
  // 出于安全，禁止通过前端自助重置 admin 账号密码（提示联系管理员/控制台重置）。
  if (path === '/api/auth/reset-password' && method === 'POST') {
    const body = await request.json().catch(() => null)
    if (!body?.username || !body?.email || !body?.phone || !body?.password) {
      fail(400, '请填写用户名、注册邮箱、注册手机号与新密码')
    }
    const username = String(body.username).trim()
    const email = String(body.email).trim()
    const phone = String(body.phone).trim()
    const password = String(body.password)
    if (password.length < 6) fail(400, '新密码至少 6 位')
    const user = await env.DB
      .prepare('SELECT * FROM users WHERE username = ?1 COLLATE NOCASE')
      .bind(username)
      .first()
    // 三项全对才通过；任一不匹配都返回同一模糊提示，避免泄露「哪个字段错了」。
    if (
      !user ||
      user.email.toLowerCase() !== email.toLowerCase() ||
      user.phone !== phone
    ) {
      fail(400, '用户名、注册邮箱或注册手机号不匹配，无法重置')
    }
    if (user.role === 'admin') {
      fail(403, '管理员账号不支持自助重置密码，请联系管理员或到控制台重置')
    }
    const passHash = await hashPassword(password)
    const nextTv = (user.token_version ?? 0) + 1
    await env.DB
      .prepare('UPDATE users SET pass_hash = ?, token_version = ? WHERE id = ?')
      .bind(passHash, nextTv, user.id)
      .run()
    return json({ ok: true }, 200, cors)
  }

  // ── 管理员协助重置用户密码 ──
  // 场景：用户遗忘邮箱/手机号无法自助找回，联系作者（admin）代为其重置为临时密码。
  // 严格鉴权：仅 role==='admin' 可调用；禁止重置 admin 自身；递增 token_version 踢下线。
  if (path === '/api/admin/reset-user-password' && method === 'POST') {
    const auth = await requireAuth(request, env)
    if (auth.role !== 'admin') fail(403, '仅管理员可执行此操作')
    const body = await request.json().catch(() => null)
    if (!body) fail(400, '请求体不是合法 JSON')
    const identifier = typeof body.identifier === 'string' ? body.identifier.trim() : ''
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : ''
    if (!identifier) fail(400, '请输入用户标识（用户名 / 邮箱 / 手机号）')
    if (newPassword.length < 6) fail(400, '新密码至少 6 位')
    // 用户名 / 邮箱 / 手机号任一匹配；三者全局唯一，但同一串可能命中不同用户的
    // 不同字段（如某用户名恰为另一人的邮箱），故取全部结果做歧义判定。
    const { results } = await env.DB
      .prepare('SELECT * FROM users WHERE username = ?1 COLLATE NOCASE OR email = ?1 COLLATE NOCASE OR phone = ?1')
      .bind(identifier)
      .all()
    if (!results || results.length === 0) {
      fail(404, '未找到匹配的用户，请核对用户名 / 邮箱 / 手机号')
    }
    if (results.length > 1) {
      fail(409, '该标识匹配到多个账号，请改用更精确的用户名 / 邮箱 / 手机号')
    }
    const target = results[0]
    if (target.role === 'admin') {
      fail(403, '禁止通过此接口修改管理员账号密码')
    }
    const passHash = await hashPassword(newPassword)
    const nextTv = (target.token_version ?? 0) + 1
    await env.DB
      .prepare('UPDATE users SET pass_hash = ?, token_version = ? WHERE id = ?')
      .bind(passHash, nextTv, target.id)
      .run()
    return json({ ok: true, username: maskUsername(target.username) }, 200, cors)
  }

  // ── 当前用户 ──
  if (path === '/api/me' && method === 'GET') {
    const auth = await requireAuth(request, env)
    const user = await getUserById(env, auth.uid)
    if (!user) fail(401, '用户不存在')
    const q = await quotaView(env, auth.uid)
    return json(
      { user: publicUser(user), usage: { ...q, used: q.usedBytes, limit: q.quotaBytes } },
      200,
      cors,
    )
  }

  // ── 默认模板空间 ──
  if (path === '/api/space/admin' && method === 'GET') {
    const row = await adminSpaceRow(env)
    return json({ data: JSON.parse(row.data), updated_at: row.updated_at }, 200, cors)
  }
  if (path === '/api/space/admin' && method === 'PUT') {
    const auth = await requireAuth(request, env)
    if (auth.role !== 'admin') fail(403, '仅管理员可修改默认模板空间')
    const body = await request.json().catch(() => null)
    await saveSpaceRow(env, '__admin__', body?.data)
    return json({ ok: true }, 200, cors)
  }

  // ── 我的空间 ──
  if (path === '/api/space' && method === 'GET') {
    const auth = await requireAuth(request, env)
    const { row, copied } = await ensureUserSpace(env, auth.uid)
    return json({ data: JSON.parse(row.data), updated_at: row.updated_at, copied }, 200, cors)
  }
  if (path === '/api/space' && method === 'PUT') {
    const auth = await requireAuth(request, env)
    const body = await request.json().catch(() => null)
    await saveSpaceRow(env, auth.uid, body?.data)
    return json({ ok: true, updated_at: now() }, 200, cors)
  }
  if (path === '/api/space/reset' && method === 'POST') {
    const auth = await requireAuth(request, env)
    const tpl = await adminSpaceRow(env)
    await env.DB
      .prepare(
        'INSERT INTO user_spaces (user_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at',
      )
      .bind(auth.uid, tpl.data, now())
      .run()
    return json({ ok: true, data: JSON.parse(tpl.data) }, 200, cors)
  }

  // ── 容量 ──
  if (path === '/api/usage' && method === 'GET') {
    const auth = await requireAuth(request, env)
    const q = await quotaView(env, auth.uid)
    return json({ ...q, used: q.usedBytes, limit: q.quotaBytes }, 200, cors)
  }

  // ── 打卡记录（随账户云端同步，换设备可恢复）──
  if (path === '/api/records' && method === 'GET') {
    const auth = await requireAuth(request, env)
    const { results } = await env.DB
      .prepare('SELECT record_id, date, practice_item_id, completed, updated_at FROM user_records WHERE user_id = ? ORDER BY updated_at ASC')
      .bind(auth.uid)
      .all()
    const records = (results ?? []).map((r) => ({ ...r, completed: !!r.completed }))
    return json({ records }, 200, cors)
  }
  if (path === '/api/records' && method === 'PUT') {
    const auth = await requireAuth(request, env)
    const body = await request.json().catch(() => null)
    const list = body?.records
    if (!Array.isArray(list)) fail(400, 'records 需为数组')
    if (list.length > 5000) fail(413, '单次同步记录过多')
    let accepted = 0
    for (const r of list) {
      if (
        !r ||
        typeof r.record_id !== 'string' ||
        typeof r.date !== 'string' ||
        typeof r.practice_item_id !== 'string' ||
        typeof r.updated_at !== 'number'
      ) {
        continue // 跳过非法条目，不打断整批
      }
      const completed = r.completed ? 1 : 0
      // 双键 (date, practice_item_id) 全局唯一：同一练习项同一天只留一条，
      // 与前端 mergeRemoteEntries 的决胜规则一致（updated_at 新者胜，同刻 record_id 小者胜）。
      const twin = await env.DB
        .prepare('SELECT record_id, updated_at FROM user_records WHERE user_id = ? AND date = ? AND practice_item_id = ?')
        .bind(auth.uid, r.date, r.practice_item_id)
        .first()
      if (!twin) {
        await env.DB
          .prepare('INSERT INTO user_records (user_id, record_id, date, practice_item_id, completed, updated_at) VALUES (?,?,?,?,?,?)')
          .bind(auth.uid, r.record_id, r.date, r.practice_item_id, completed, r.updated_at)
          .run()
        accepted += 1
      } else if (r.updated_at > twin.updated_at || (r.updated_at === twin.updated_at && r.record_id < twin.record_id)) {
        // 本地记录更新（或跨设备双胞胎裁决胜出）：替换旧记录
        await env.DB
          .prepare('DELETE FROM user_records WHERE user_id = ? AND record_id = ?')
          .bind(auth.uid, twin.record_id)
          .run()
        await env.DB
          .prepare('INSERT INTO user_records (user_id, record_id, date, practice_item_id, completed, updated_at) VALUES (?,?,?,?,?,?)')
          .bind(auth.uid, r.record_id, r.date, r.practice_item_id, completed, r.updated_at)
          .run()
        accepted += 1
      }
      // 否则：云端已有更新版本，忽略本条
    }
    return json({ ok: true, accepted }, 200, cors)
  }

  // ── 文件 ──
  if (path === '/api/files' && method === 'POST') {
    const auth = await requireAuth(request, env)
    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File)) fail(400, '缺少文件字段 file')
    if (!/^audio\//.test(file.type) && !/^image\//.test(file.type)) fail(415, '仅支持音频和图片')
    if (file.size > MAX_FILE_BYTES) {
      fail(413, `单个文件不能超过 ${mb(MAX_FILE_BYTES)}`, {
        code: 'FILE_TOO_LARGE',
        incomingBytes: file.size,
        quotaBytes: LIMIT,
      })
    }
    // 写入前严格校验：已用 + 本次 <= 配额
    const used = await usedBytes(env, auth.uid)
    if (used + file.size > LIMIT) {
      const remaining = Math.max(0, LIMIT - used)
      fail(
        413,
        `云盘空间不足：剩余 ${mb(remaining)}，当前文件 ${mb(file.size)}，已用 ${mb(used)} / ${mb(LIMIT)}。请先删除不需要的旧文件`,
        {
          code: 'QUOTA_EXCEEDED',
          usedBytes: used,
          quotaBytes: LIMIT,
          incomingBytes: file.size,
          remainingBytes: remaining,
        },
      )
    }
    const id = uuid()
    const buf = await file.arrayBuffer()
    await env.DB
      .prepare('INSERT INTO user_files (id, user_id, name, mime, size, data, created_at) VALUES (?,?,?,?,?,?,?)')
      .bind(id, auth.uid, file.name, file.type, file.size, buf, now())
      .run()
    const q = { usedBytes: used + file.size, quotaBytes: LIMIT }
    return json(
      { id, name: file.name, mime: file.type, size: file.size, ...q, used: q.usedBytes, limit: q.quotaBytes },
      200,
      cors,
    )
  }
  if (path === '/api/files' && method === 'GET') {
    const auth = await requireAuth(request, env)
    const { results } = await env.DB
      .prepare('SELECT id, name, mime, size, created_at FROM user_files WHERE user_id = ? ORDER BY created_at DESC')
      .bind(auth.uid)
      .all()
    const q = await quotaView(env, auth.uid)
    return json({ files: results ?? [], ...q, used: q.usedBytes, limit: q.quotaBytes }, 200, cors)
  }
  const fileMatch = path.match(/^\/api\/files\/([A-Za-z0-9-]+)$/)
  if (fileMatch && method === 'GET') {
    // 公开直链读：id 为不可猜测 uuid（练习内容对游客可见所必需）。
    const row = await env.DB
      .prepare('SELECT name, mime, size, data FROM user_files WHERE id = ?')
      .bind(fileMatch[1])
      .first()
    if (!row) fail(404, '文件不存在')
    return new Response(row.data, {
      headers: {
        'Content-Type': row.mime || 'application/octet-stream',
        'Content-Length': String(row.size),
        'Cache-Control': 'public, max-age=31536000, immutable',
        ...corsHeaders(request, env),
      },
    })
  }
  if (fileMatch && method === 'DELETE') {
    const auth = await requireAuth(request, env)
    const row = await env.DB.prepare('SELECT user_id, size FROM user_files WHERE id = ?').bind(fileMatch[1]).first()
    if (!row) {
      // 已不存在：幂等返回当前用量，前端无需特殊处理
      return json({ ok: true, freedBytes: 0, ...(await quotaView(env, auth.uid)) }, 200, cors)
    }
    if (row.user_id !== auth.uid) fail(403, '只能删除自己的文件')
    await env.DB.prepare('DELETE FROM user_files WHERE id = ?').bind(fileMatch[1]).run()
    // admin 的文件是默认模板（公共记录）的素材来源，删除后同步摘除模板引用
    let templateUpdated = false
    if (auth.role === 'admin') {
      try {
        templateUpdated = await stripFileFromSpace(env, '__admin__', fileMatch[1])
      } catch {
        // 模板清理失败不应阻塞删除主流程
      }
    }
    const q = await quotaView(env, auth.uid)
    return json(
      { ok: true, freedBytes: row.size ?? 0, templateUpdated, ...q, used: q.usedBytes, limit: q.quotaBytes },
      200,
      cors,
    )
  }

  fail(404, '接口不存在')
}

// ── 常量与小工具 ─────────────────────────────────────────

/** 单用户云盘限额：120MB。 */
const LIMIT = 120 * 1024 * 1024

/** 单文件上限：10MB（受 Cloudflare 请求体限制与使用场景约束）。 */
const MAX_FILE_BYTES = 10 * 1024 * 1024

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

function publicUser(u) {
  return { id: u.id, username: u.username, email: u.email, phone: u.phone, role: u.role, avatar: u.avatar, created_at: u.created_at }
}
