// Worker 业务逻辑全流程测试：内存版 D1 mock，直接调用 worker fetch()
// 覆盖：健康检查/注册/登录(三种账号)/JWT/空间复制与保存/文件上传直链删除/120MB 限额/CORS
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

// 内联 seed，绕开 Node 对 JSON import attribute 的要求（Wrangler/esbuild 无此限制）
const src = readFileSync('./src/index.js', 'utf8')
const seed = readFileSync('./src/seed.json', 'utf8')
const compiled = src.replace("import seed from './seed.json'", `const seed = ${seed}`)
writeFileSync('./_compiled.mjs', compiled)
const mod = await import('./_compiled.mjs')
unlinkSync('./_compiled.mjs')
console.log('✓ worker 模块加载成功')

// ── 内存版 D1（按本项目实际用到的 SQL 形状路由）──
function mockD1() {
  const users = new Map()
  const usersByName = new Map() // username/email/phone(lower) -> id
  const spaces = new Map()
  const files = new Map()
  const records = new Map() // `${user_id}|${record_id}` -> record row
  const like = (sql, s) => sql.toLowerCase().includes(s)

  function prepare(sql) {
    const api = {
      bind(...p) {
        api._p = p
        return api
      },
      async first() {
        if (like(sql, 'from users where id')) return users.get(api._p[0]) ?? null
        if (like(sql, "role = 'admin'")) {
          const admins = [...users.values()].filter((u) => u.role === 'admin').sort((a, b) => a.created_at - b.created_at)
          return admins[0] ?? null
        }
        if (like(sql, 'from user_spaces')) return spaces.get(api._p[0]) ?? null
        if (like(sql, 'count(*)')) return { c: users.size }
        if (like(sql, 'username = ?1')) {
          const k = String(api._p[0]).toLowerCase()
          const id = usersByName.get(k)
          return id ? users.get(id) : null
        }
        if (like(sql, 'sum(size)')) {
          let s = 0
          for (const f of files.values()) if (f.user_id === api._p[0]) s += f.size
          return { s }
        }
        if (like(sql, 'from user_records')) {
          // 双键查询：WHERE user_id = ? AND date = ? AND practice_item_id = ?
          const [uid, date, itemId] = api._p
          const row = [...records.values()].find(
            (r) => r.user_id === uid && r.date === date && r.practice_item_id === itemId,
          )
          return row ? { record_id: row.record_id, updated_at: row.updated_at } : null
        }
        if (like(sql, 'select id, name, mime, size, created_at')) return null
        if (like(sql, 'select name, mime, size, data')) return files.get(api._p[0]) ?? null
        if (like(sql, 'from user_files where id')) {
          const f = files.get(api._p[0])
          return f ? { user_id: f.user_id, size: f.size } : null
        }
        throw new Error('mockD1 未实现的 first: ' + sql)
      },
      async run() {
        if (like(sql, 'insert into users')) {
          const [id, username, email, phone] = api._p
          for (const key of [username, email, phone]) {
            const k = String(key).toLowerCase()
            if (usersByName.has(k)) throw new Error('UNIQUE constraint failed')
          }
          users.set(id, { id, username, email, phone, pass_hash: api._p[4], avatar: api._p[5], role: api._p[6], token_version: 0, created_at: api._p[7] })
          for (const key of [username, email, phone]) usersByName.set(String(key).toLowerCase(), id)
          return { success: true }
        }
        if (like(sql, 'update users')) {
          if (like(sql, 'token_version')) {
            // UPDATE users SET pass_hash = ?, token_version = ? WHERE id = ?
            const u = users.get(api._p[2])
            if (u) {
              u.pass_hash = api._p[0]
              u.token_version = api._p[1]
            }
          } else {
            // UPDATE users SET pass_hash = ? WHERE id = ?
            const u = users.get(api._p[1])
            if (u) u.pass_hash = api._p[0]
          }
          return { success: true }
        }
        if (like(sql, 'into user_spaces')) {
          const [uid, data, ts] = api._p
          if (sql.includes('ON CONFLICT DO NOTHING') && spaces.has(uid)) return { success: false }
          spaces.set(uid, { user_id: uid, data, updated_at: ts })
          return { success: true }
        }
        if (like(sql, 'insert into user_files')) {
          const [id, user_id, name, mime, size, data, created_at] = api._p
          files.set(id, { id, user_id, name, mime, size, data, created_at })
          return { success: true }
        }
        if (like(sql, 'delete from user_files')) {
          files.delete(api._p[0])
          return { success: true }
        }
        if (like(sql, 'insert into user_records')) {
          const [user_id, record_id, date, practice_item_id, completed, updated_at] = api._p
          records.set(`${user_id}|${record_id}`, { user_id, record_id, date, practice_item_id, completed, updated_at })
          return { success: true }
        }
        if (like(sql, 'delete from user_records')) {
          // DELETE FROM user_records WHERE user_id = ? AND record_id = ?
          records.delete(`${api._p[0]}|${api._p[1]}`)
          return { success: true }
        }
        throw new Error('mockD1 未实现的 run: ' + sql)
      },
      async all() {
        if (like(sql, 'from users')) {
          // 管理员重置密码定位查询：用户名 / 邮箱 / 手机号任一，做歧义判定
          const k = String(api._p[0]).toLowerCase()
          const matches = [...users.values()].filter(
            (u) => u.username.toLowerCase() === k || u.email.toLowerCase() === k || u.phone === k,
          )
          return { results: matches }
        }
        if (like(sql, 'from user_files where user_id')) {
          const rows = [...files.values()]
            .filter((f) => f.user_id === api._p[0])
            .sort((a, b) => b.created_at - a.created_at)
            .map(({ data, ...rest }) => rest)
          return { results: rows }
        }
        if (like(sql, 'from user_records')) {
          const rows = [...records.values()]
            .filter((r) => r.user_id === api._p[0])
            .sort((a, b) => a.updated_at - b.updated_at)
          return { results: rows }
        }
        throw new Error('mockD1 未实现的 all: ' + sql)
      },
    }
    return api
  }
  return { prepare, _files: files, _spaces: spaces, _users: users, _records: records }
}

const env = { DB: mockD1(), JWT_SECRET: 'test-secret-123', ALLOWED_ORIGINS: 'https://guchengyap.github.io' }
const call = async (path, init = {}) => {
  const resp = await mod.default.fetch(new Request(`https://api.example.com${path}`, init), env, {})
  const cors = resp.headers.get('access-control-allow-origin')
  return { status: resp.status, cors, body: resp.headers.get('content-type')?.includes('json') ? await resp.json() : await resp.arrayBuffer() }
}
const json = (path, body, token) =>
  call(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })

let pass = 0
let failed = 0
function check(name, cond, extra = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.log(`  ✗ ${name} ${extra}`)
  }
}

// ── 用例 ──
console.log('T1 健康检查')
{
  const r = await call('/api/health')
  check('ok', r.status === 200 && r.body.ok === true)
  check('CORS 反射白名单', r.cors === 'https://guchengyap.github.io', String(r.cors))
}

console.log('T2 注册：第一个用户自动成为 admin')
let adminToken = ''
let admin = null
{
  const r = await json('/api/register', {
    username: 'admin',
    email: 'admin@test.com',
    phone: '13800000001',
    password: 'secret66',
  })
  check('200', r.status === 200, JSON.stringify(r.body))
  check('role=admin', r.body?.user?.role === 'admin')
  check('token 返回', typeof r.body?.token === 'string' && r.body.token.split('.').length === 3)
  adminToken = r.body?.token
  admin = r.body?.user
}

console.log('T3 重复注册被拒（密码哈希不可逆验证不影响唯一性）')
{
  const r = await json('/api/register', {
    username: 'admin2',
    email: 'ADMIN@test.com', // 大小写不同也应视为重复
    phone: '13800000002',
    password: 'secret66',
  })
  check('409', r.status === 409, String(r.status))
}

console.log('T4 登录：用户名/邮箱/手机号任一 + 密码校验')
{
  for (const account of ['admin', 'admin@test.com', '13800000001']) {
    const r = await json('/api/login', { account, password: 'secret66' })
    check(`登录(${account})`, r.status === 200 && r.body?.user?.id === admin.id)
  }
  const bad = await json('/api/login', { account: 'admin', password: 'wrong!!' })
  check('错误密码 401', bad.status === 401)
}

console.log('T5 默认模板空间：未播种时自动用内置 seed')
{
  const r = await call('/api/space/admin')
  check('200 + level1=3 组', r.status === 200 && r.body.data.level1.length === 3)
  check('level2 13 项', r.body.data.level2.length === 13)
}

console.log('T6 admin 保存模板空间')
{
  const cur = (await call('/api/space/admin')).body.data
  cur.level1[0].title = '气息(改)'
  const put = await call('/api/space/admin', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ data: cur }),
  })
  check('200', put.status === 200)
  const again = (await call('/api/space/admin')).body.data
  check('修改生效', again.level1[0].title === '气息(改)')
}

console.log('T7 第二个用户：role=user + 首次读空间自动复制模板')
let user2Token = ''
{
  const reg = await json('/api/register', {
    username: '小明',
    email: 'xm@test.com',
    phone: '13800000003',
    password: 'pass123',
  })
  check('role=user', reg.body?.user?.role === 'user')
  user2Token = reg.body?.token
  const space = await call('/api/space', { headers: { Authorization: `Bearer ${user2Token}` } })
  check('copied=true', space.body?.copied === true)
  check('内容=admin 模板', space.body?.data?.level1?.[0]?.title === '气息(改)')
}

console.log('T8 用户保存自己的空间，与模板互不影响')
{
  const space = (await call('/api/space', { headers: { Authorization: `Bearer ${user2Token}` } })).body.data
  space.level2[0].title = '小明的专属练法'
  const put = await call('/api/space', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user2Token}` },
    body: JSON.stringify({ data: space }),
  })
  check('200', put.status === 200)
  const adminTpl = (await call('/api/space/admin')).body.data
  check('模板未被波及', adminTpl.level2[0].title !== '小明的专属练法')
}

console.log('T9 文件上传 / 直链 / 列表 / 容量')
let fileId = ''
{
  const form = new FormData()
  const bytes = new Uint8Array(1024 * 100).fill(65)
  form.append('file', new Blob([bytes], { type: 'audio/mpeg' }), 'test.mp3')
  const up = await call('/api/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${user2Token}` },
    body: form,
  })
  check('200 + size=102400', up.status === 200 && up.body?.size === 102400, JSON.stringify(up.body))
  check('usage 累加（文件 + 空间 JSON）', up.body?.usedBytes >= 102400, String(up.body?.usedBytes))
  check('返回 quotaBytes=120MB', up.body?.quotaBytes === 120 * 1024 * 1024)
  fileId = up.body?.id
  const dl = await call(`/api/files/${fileId}`)
  check('公开直链 200', dl.status === 200)
  check('内容一致', dl.body instanceof ArrayBuffer && dl.body.byteLength === 102400)
  const list = await call('/api/files', { headers: { Authorization: `Bearer ${user2Token}` } })
  check('列表 1 条', list.body?.files?.length === 1)
  const f = list.body?.files?.[0] ?? {}
  check(
    '列表字段完整（id/name/mime/size/created_at）',
    !!f.id && f.name === 'test.mp3' && f.mime === 'audio/mpeg' && f.size === 102400 && typeof f.created_at === 'number',
    JSON.stringify(f),
  )
  check('列表带实时用量', typeof list.body?.usedBytes === 'number' && list.body?.quotaBytes === 120 * 1024 * 1024)
}

console.log('T10 120MB 限额：写入前拦截并返回结构化用量')
{
  const payload = JSON.parse(Buffer.from(user2Token.split('.')[1], 'base64').toString())
  // 向 mock 注入 119MB 占位文件，模拟"已接近上限"（避免真造 119MB 数据）
  env.DB._files.set('inject-119', {
    id: 'inject-119',
    user_id: payload.uid,
    name: 'old-big.mp3',
    mime: 'audio/mpeg',
    size: 119 * 1024 * 1024,
    data: new Uint8Array(0),
    created_at: 1,
  })
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(1024 * 1024).fill(1)], { type: 'audio/mpeg' }), 'more.mp3')
  const up = await call('/api/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${user2Token}` },
    body: form,
  })
  check('413', up.status === 413, String(up.status))
  check('code=QUOTA_EXCEEDED', up.body?.code === 'QUOTA_EXCEEDED', JSON.stringify(up.body))
  check('返回 usedBytes', up.body?.usedBytes >= 119 * 1024 * 1024, String(up.body?.usedBytes))
  check('返回 quotaBytes', up.body?.quotaBytes === 120 * 1024 * 1024)
  check('返回 incomingBytes', up.body?.incomingBytes === 1024 * 1024)
  check('remainingBytes = 配额 − 已用', up.body?.remainingBytes === 120 * 1024 * 1024 - up.body?.usedBytes)
  check('超额请求未落库', env.DB._files.size === 2)
  env.DB._files.delete('inject-119')
}

console.log('T11 删除权限：非 owner 403')
{
  const del = await call(`/api/files/${fileId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${adminToken}` },
  })
  check('403', del.status === 403)
  const own = await call(`/api/files/${fileId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${user2Token}` },
  })
  check('owner 删除 ok', own.status === 200)
  check('返回删除后 usedBytes/quotaBytes', typeof own.body?.usedBytes === 'number' && own.body?.quotaBytes === 120 * 1024 * 1024)
  check('freedBytes=文件大小', own.body?.freedBytes === 102400, String(own.body?.freedBytes))
  const again = await call(`/api/files/${fileId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${user2Token}` },
  })
  check('重复删除幂等', again.status === 200 && again.body?.freedBytes === 0)
}

console.log('T12 未登录访问受保护接口')
{
  const r = await call('/api/space')
  check('401', r.status === 401)
  const bad = await call('/api/space', { headers: { Authorization: 'Bearer fake.token.sig' } })
  check('伪造 token 401', bad.status === 401)
}

console.log('T13 reset 恢复默认模板')
{
  const r = await call('/api/space/reset', { method: 'POST', headers: { Authorization: `Bearer ${user2Token}` } })
  check('200 + 回到模板', r.status === 200 && r.body?.data?.level2?.[0]?.title !== '小明的专属练法')
}

console.log('T14 空间数据格式校验')
{
  const r = await call('/api/space', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user2Token}` },
    body: JSON.stringify({ data: { foo: 1 } }),
  })
  check('400', r.status === 400)
}

console.log('T15 admin 删除模板文件时同步清理公共记录引用')
{
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(2048).fill(7)], { type: 'image/png' }), 'tpl.png')
  const up = await call('/api/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: form,
  })
  check('admin 上传 200', up.status === 200, JSON.stringify(up.body))
  const tplFileId = up.body?.id

  const tpl = (await call('/api/space/admin')).body.data
  const target = tpl.level2.find((i) => Array.isArray(i.files))
  target.files.push({ id: 'local-x', name: 'tpl.png', type: 'image', path: '', mime: 'image/png', cloud_id: tplFileId })
  target.config = { ...(target.config ?? {}), sequence: ['local-x'] }
  const put = await call('/api/space/admin', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ data: tpl }),
  })
  check('模板写入引用', put.status === 200)

  const del = await call(`/api/files/${tplFileId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${adminToken}` } })
  check('admin 删除 200', del.status === 200)
  check('templateUpdated=true', del.body?.templateUpdated === true, JSON.stringify(del.body))
  check('返回最新 usedBytes', typeof del.body?.usedBytes === 'number')

  const after = (await call('/api/space/admin')).body.data
  const stillThere = after.level2.some((i) => (i.files ?? []).some((f) => f.cloud_id === tplFileId))
  check('模板中已无该文件引用', !stillThere)
  const seqClean = !after.level2.some((i) => (i.config?.sequence ?? []).includes('local-x'))
  check('config.sequence 同步清理', seqClean)
}

console.log('T16 打卡记录：云端同步 / 双键去重 / 多用户隔离')
{
  // 未登录被拒
  const noAuth = await call('/api/records')
  check('未登录 GET 401', noAuth.status === 401)

  // admin 上推两条打卡
  const put = await call('/api/records', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      records: [
        { record_id: 'rec-a1', date: '2026-11-22', practice_item_id: 'item-1', completed: true, updated_at: 1000 },
        { record_id: 'rec-a2', date: '2026-11-22', practice_item_id: 'item-2', completed: true, updated_at: 2000 },
      ],
    }),
  })
  check('admin PUT 200 + accepted=2', put.status === 200 && put.body?.accepted === 2, JSON.stringify(put.body))

  // 拉取 admin 记录
  const adminRecs = await call('/api/records', { headers: { Authorization: `Bearer ${adminToken}` } })
  check('admin GET 2 条', adminRecs.body?.records?.length === 2, JSON.stringify(adminRecs.body))
  check('completed 转 boolean', adminRecs.body?.records?.every((r) => r.completed === true))

  // 用户2 初始无记录（新用户不继承 admin 打卡）
  const user2Recs = await call('/api/records', { headers: { Authorization: `Bearer ${user2Token}` } })
  check('新用户不继承 admin 打卡', user2Recs.body?.records?.length === 0, JSON.stringify(user2Recs.body))

  // 用户2 上推自己的打卡，互不干扰
  await call('/api/records', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user2Token}` },
    body: JSON.stringify({
      records: [{ record_id: 'rec-u1', date: '2026-11-22', practice_item_id: 'item-1', completed: true, updated_at: 500 }],
    }),
  })
  const adminAfter = await call('/api/records', { headers: { Authorization: `Bearer ${adminToken}` } })
  check('user2 打卡不串到 admin', adminAfter.body?.records?.length === 2)
  const user2After = await call('/api/records', { headers: { Authorization: `Bearer ${user2Token}` } })
  check('user2 只见自己 1 条', user2After.body?.records?.length === 1 && user2After.body?.records?.[0]?.record_id === 'rec-u1')

  // 双键去重：admin 对 item-1 再推一条更新的（不同 record_id），应替换旧记录
  await call('/api/records', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      records: [{ record_id: 'rec-a1b', date: '2026-11-22', practice_item_id: 'item-1', completed: false, updated_at: 3000 }],
    }),
  })
  const dedup = await call('/api/records', { headers: { Authorization: `Bearer ${adminToken}` } })
  const item1 = dedup.body?.records?.filter((r) => r.practice_item_id === 'item-1')
  check('双键去重：item-1 只剩 1 条且为新版本', item1?.length === 1 && item1[0].record_id === 'rec-a1b' && item1[0].completed === false, JSON.stringify(item1))

  // 旧版本上推应被忽略（云端保留新版本）
  const stale = await call('/api/records', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      records: [{ record_id: 'rec-stale', date: '2026-11-22', practice_item_id: 'item-1', completed: true, updated_at: 1 }],
    }),
  })
  check('旧版本被忽略 accepted=0', stale.body?.accepted === 0, JSON.stringify(stale.body))
  const afterStale = await call('/api/records', { headers: { Authorization: `Bearer ${adminToken}` } })
  const item1Keep = afterStale.body?.records?.find((r) => r.practice_item_id === 'item-1')
  check('云端仍保留新版本', item1Keep?.record_id === 'rec-a1b' && item1Keep?.completed === false)

  // 非法条目被跳过，不打断整批
  const mixed = await call('/api/records', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      records: [
        { record_id: 'rec-x', date: '2026-11-23', practice_item_id: 'item-9', completed: true, updated_at: 4000 },
        { bad: true },
      ],
    }),
  })
  check('非法条目跳过、合法条目写入', mixed.status === 200 && mixed.body?.accepted === 1, JSON.stringify(mixed.body))
}

console.log('T17 忘记密码：多要素核验自助重置')
{
  // 缺字段
  const missing = await json('/api/auth/reset-password', { username: '小明', email: 'xm@test.com', phone: '13800000003' })
  check('缺新密码 400', missing.status === 400)

  // 邮箱不匹配（模糊提示，不泄露具体哪个字段错）
  const wrongEmail = await json('/api/auth/reset-password', {
    username: '小明',
    email: 'wrong@test.com',
    phone: '13800000003',
    password: 'newpass99',
  })
  check('邮箱不符 400', wrongEmail.status === 400, JSON.stringify(wrongEmail.body))
  check('模糊提示不单点指向某字段', !/邮箱不正确|手机号不正确|用户名不正确/.test(wrongEmail.body?.error ?? ''), wrongEmail.body?.error)

  // 手机号不匹配
  const wrongPhone = await json('/api/auth/reset-password', {
    username: '小明',
    email: 'xm@test.com',
    phone: '13900000000',
    password: 'newpass99',
  })
  check('手机号不符 400', wrongPhone.status === 400)

  // 新密码太短
  const shortPwd = await json('/api/auth/reset-password', {
    username: '小明',
    email: 'xm@test.com',
    phone: '13800000003',
    password: '123',
  })
  check('新密码过短 400', shortPwd.status === 400)

  // 三项全对 → 重置成功（用户名大小写不敏感）
  const ok = await json('/api/auth/reset-password', {
    username: '小明',
    email: 'XM@test.com',
    phone: '13800000003',
    password: 'newpass99',
  })
  check('三项全对重置 200', ok.status === 200, JSON.stringify(ok.body))

  // 重置后旧密码登录失败、新密码登录成功
  const oldLogin = await json('/api/login', { account: '小明', password: 'pass123' })
  check('旧密码失效 401', oldLogin.status === 401)
  const newLogin = await json('/api/login', { account: '小明', password: 'newpass99' })
  check('新密码登录成功', newLogin.status === 200 && newLogin.body?.user?.id === user2Token ? true : newLogin.body?.user?.username === '小明')

  // 禁止重置 admin
  const adminReset = await json('/api/auth/reset-password', {
    username: 'admin',
    email: 'admin@test.com',
    phone: '13800000001',
    password: 'hackadmin1',
  })
  check('禁止重置 admin 403', adminReset.status === 403, JSON.stringify(adminReset.body))
  const adminStill = await json('/api/login', { account: 'admin', password: 'secret66' })
  check('admin 原密码仍有效', adminStill.status === 200)
}

console.log('T18 管理员协助重置用户密码')
{
  // 注册一个新用户作为重置目标
  const reg3 = await json('/api/register', {
    username: '小刚',
    email: 'xg@test.com',
    phone: '13800000005',
    password: 'oldpass1',
  })
  check('注册目标用户 200', reg3.status === 200, JSON.stringify(reg3.body))
  const targetToken = reg3.body?.token
  const targetId = reg3.body?.user?.id

  // 未登录 → 401
  const noAuth = await json('/api/admin/reset-user-password', { identifier: '小刚', newPassword: 'newpass1' })
  check('未登录 401', noAuth.status === 401)

  // 普通用户 → 403（T17 已重置小明密码，重新登录取有效 token）
  const u2login = await json('/api/login', { account: '小明', password: 'newpass99' })
  check('普通用户登录成功', u2login.status === 200, JSON.stringify(u2login.body))
  const forbidden = await json('/api/admin/reset-user-password', { identifier: '小刚', newPassword: 'newpass1' }, u2login.body?.token)
  check('普通用户调用 403', forbidden.status === 403, JSON.stringify(forbidden.body))

  // 缺 identifier
  const noIdent = await json('/api/admin/reset-user-password', { newPassword: 'newpass1' }, adminToken)
  check('缺 identifier 400', noIdent.status === 400)

  // 新密码过短
  const shortPwd = await json('/api/admin/reset-user-password', { identifier: '小刚', newPassword: '123' }, adminToken)
  check('新密码过短 400', shortPwd.status === 400)

  // 定位不到
  const notFound = await json('/api/admin/reset-user-password', { identifier: '不存在的人', newPassword: 'newpass1' }, adminToken)
  check('定位不到 404', notFound.status === 404, JSON.stringify(notFound.body))

  // 歧义：注入一个 username 与目标邮箱相同的用户，同一标识命中两条 → 409
  env.DB._users.set('dup-user', {
    id: 'dup-user', username: 'xg@test.com', email: 'dup@test.com', phone: '13911111111',
    pass_hash: 'x', avatar: null, role: 'user', token_version: 0, created_at: 1,
  })
  const ambiguous = await json('/api/admin/reset-user-password', { identifier: 'xg@test.com', newPassword: 'newpass1' }, adminToken)
  check('歧义匹配 409', ambiguous.status === 409, JSON.stringify(ambiguous.body))
  env.DB._users.delete('dup-user')

  // 禁止重置 admin
  const resetAdmin = await json('/api/admin/reset-user-password', { identifier: 'admin', newPassword: 'hackadmin2' }, adminToken)
  check('禁止重置 admin 403', resetAdmin.status === 403, JSON.stringify(resetAdmin.body))

  // 成功重置（用邮箱定位）
  const ok = await json('/api/admin/reset-user-password', { identifier: 'xg@test.com', newPassword: 'newpass1' }, adminToken)
  check('成功重置 200 + 返回脱敏用户名', ok.status === 200 && typeof ok.body?.username === 'string', JSON.stringify(ok.body))
  check('脱敏含 * 且非明文', ok.body?.username?.includes('*') && ok.body?.username !== '小刚', ok.body?.username)

  // 旧密码失效、新密码可登录
  const oldLogin = await json('/api/login', { account: '小刚', password: 'oldpass1' })
  check('旧密码失效 401', oldLogin.status === 401)
  const newLogin = await json('/api/login', { account: '小刚', password: 'newpass1' })
  check('新密码登录成功', newLogin.status === 200 && newLogin.body?.user?.id === targetId, JSON.stringify(newLogin.body))

  // 目标用户旧 token 失效（token_version 递增）
  const staleToken = await call('/api/me', { headers: { Authorization: `Bearer ${targetToken}` } })
  check('目标旧 token 失效 401', staleToken.status === 401, String(staleToken.status))
}

console.log(`\n结果：${pass} 通过 / ${failed} 失败`)
process.exit(failed ? 1 : 0)
