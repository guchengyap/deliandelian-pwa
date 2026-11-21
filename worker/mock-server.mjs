// 前端联调用 mock 云端服务器：真实 Worker 代码 + 内存 D1，监听 127.0.0.1:8787
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

const src = readFileSync('./src/index.js', 'utf8')
const seed = readFileSync('./src/seed.json', 'utf8')
writeFileSync('worker/_compiled.mjs', src.replace("import seed from './seed.json'", `const seed = ${seed}`))
const mod = await import('./_compiled.mjs')
unlinkSync('worker/_compiled.mjs')

// 简易持久 D1（内存即可，联调用）
function mockD1() {
  const users = new Map()
  const usersByName = new Map()
  const spaces = new Map()
  const files = new Map()
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
          const id = usersByName.get(String(api._p[0]).toLowerCase())
          return id ? users.get(id) : null
        }
        if (like(sql, 'sum(size)')) {
          let s = 0
          for (const f of files.values()) if (f.user_id === api._p[0]) s += f.size
          return { s }
        }
        if (like(sql, 'select name, mime, size, data')) return files.get(api._p[0]) ?? null
        if (like(sql, 'select user_id from user_files')) {
          const f = files.get(api._p[0])
          return f ? { user_id: f.user_id } : null
        }
        throw new Error('first: ' + sql)
      },
      async run() {
        if (like(sql, 'insert into users')) {
          const [id, username, email, phone] = api._p
          for (const k of [username, email, phone]) {
            if (usersByName.has(String(k).toLowerCase())) throw new Error('UNIQUE constraint failed')
          }
          users.set(id, { id, username, email, phone, pass_hash: api._p[4], avatar: api._p[5], role: api._p[6], created_at: api._p[7] })
          for (const k of [username, email, phone]) usersByName.set(String(k).toLowerCase(), id)
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
        throw new Error('run: ' + sql)
      },
      async all() {
        const rows = [...files.values()]
          .filter((f) => f.user_id === api._p[0])
          .sort((a, b) => b.created_at - a.created_at)
          .map(({ data, ...rest }) => rest)
        return { results: rows }
      },
    }
    return api
  }
  return { prepare }
}

const env = { DB: mockD1(), JWT_SECRET: 'mock-secret', ALLOWED_ORIGINS: '*' }

createServer(async (req, res) => {
  const chunks = []
  for await (const c of req) chunks.push(c)
  const body = chunks.length ? Buffer.concat(chunks) : undefined
  const request = new Request(`http://127.0.0.1:8787${req.url}`, {
    method: req.method,
    headers: Object.entries(req.headers).filter(([k]) => !['host', 'connection', 'content-length'].includes(k)),
    body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : body,
  })
  try {
    const resp = await mod.default.fetch(request, env, {})
    res.writeHead(resp.status, Object.fromEntries(resp.headers))
    res.end(resp.body ? Buffer.from(await resp.arrayBuffer()) : undefined)
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: String(e) }))
  }
}).listen(8787, () => console.log('mock cloud on http://127.0.0.1:8787'))
