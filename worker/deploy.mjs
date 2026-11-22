#!/usr/bin/env node
/**
 * 练声助手 · Cloudflare 后端一键部署脚本
 *
 * 前置：本机已登录 Cloudflare（npx wrangler login，浏览器点 Allow）
 * 运行：node worker/deploy.mjs            完整流程（含 git 提交推送）
 *       node worker/deploy.mjs --skip-push 只部署，不提交推送
 *
 * 做的事（顺序）：
 *   1. 检查 wrangler 登录状态
 *   2. 创建 D1 数据库 liansheng-db（已存在则复用），回填 wrangler.toml 的 database_id
 *   3. 导入 schema.sql 建表（幂等，可重复执行）
 *   4. 部署 Worker，拿到 workers.dev 地址
 *   5. 生成并写入 JWT_SECRET（已存在则保留，避免把已登录用户踢下线）
 *   6. 回填前端 src/config.ts 的 CLOUD_API_BASE
 *   7. 构建前端验证 + 从本机实测后端 /api/health
 *   8. 提交并推送到 GitHub（Pages 自动重新部署）
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import crypto from 'node:crypto'

const WORKER_DIR = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(WORKER_DIR, '..')
const TOML_PATH = path.join(WORKER_DIR, 'wrangler.toml')
const CONFIG_PATH = path.join(ROOT, 'src', 'config.ts')
const DB_NAME = 'liansheng-db'
const SKIP_PUSH = process.argv.includes('--skip-push')

// ── 凭据：优先用 API Token（worker/.cf-token），否则走 wrangler login 的 OAuth ──
// 授权页异常（权限列表加载失败、按钮灰色）时的备用通道。
const TOKEN_PATH = path.join(WORKER_DIR, '.cf-token')
const ACCOUNT_PATH = path.join(WORKER_DIR, '.cf-account')
let authMode = 'OAuth（wrangler login）'
try {
  const t = readFileSync(TOKEN_PATH, 'utf8').trim()
  if (t) {
    process.env.CLOUDFLARE_API_TOKEN = t
    authMode = 'API Token（worker/.cf-token）'
  }
} catch {
  /* 无 token 文件，走 OAuth */
}
try {
  const a = readFileSync(ACCOUNT_PATH, 'utf8').trim()
  if (a) process.env.CLOUDFLARE_ACCOUNT_ID = a
} catch {
  /* Account ID 可省略，wrangler 会从 token 自动推断 */
}

let step = 0
const log = (msg) => console.log(`\n▶ ${++step}. ${msg}`)
const ok = (msg) => console.log(`   ✓ ${msg}`)
const warn = (msg) => console.log(`   ! ${msg}`)

function fail(msg) {
  console.error(`\n✗ 失败：${msg}`)
  process.exit(1)
}

/** 执行 wrangler 命令，返回 { code, out }（stdout+stderr 合并）。 */
function wr(args, { cwd = WORKER_DIR, input } = {}) {
  const r = spawnSync('npx', ['wrangler', ...args], {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    input,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    maxBuffer: 32 * 1024 * 1024,
  })
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

/** 从混杂横幅（如 "[WARNING] ..."）的输出中提取第一个合法 JSON 值（括号配对，字符串感知）。 */
function parseJsonLoose(text) {
  const cleaned = text.replace(/\x1b\[[0-9;]*m/g, '')
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i]
    if (ch !== '[' && ch !== '{') continue
    let depth = 0
    let inStr = false
    let esc = false
    for (let j = i; j < cleaned.length; j++) {
      const c = cleaned[j]
      if (inStr) {
        if (esc) esc = false
        else if (c === '\\') esc = true
        else if (c === '"') inStr = false
        continue
      }
      if (c === '"') inStr = true
      else if (c === '[' || c === '{') depth++
      else if (c === ']' || c === '}') {
        depth--
        if (depth === 0) {
          try {
            return JSON.parse(cleaned.slice(i, j + 1))
          } catch {
            break // 这不是 JSON，换下一个起点
          }
        }
      }
    }
  }
  return null
}

// ── 1. 登录检查 ──────────────────────────────────────────────
log(`检查 Cloudflare 登录状态（凭据来源：${authMode}）`)
const who = wr(['whoami'])
const authBroken =
  /not authenticated|Authentication error|Invalid API Token|10000/i.test(who.out) || who.code !== 0
if (authBroken) {
  fail(
    '未获得有效的 Cloudflare 凭据。两种方式任选其一：\n' +
      '\n  A) OAuth 登录（推荐，只要授权页正常）\n' +
      '     1) 浏览器注册账号：https://dash.cloudflare.com/sign-up\n' +
      '     2) 执行：npx wrangler login（浏览器弹出后点 Allow，2 分钟内完成）\n' +
      '\n  B) API Token（授权页按钮灰色时用这个）\n' +
      '     1) Cloudflare → 头像 → My Profile → API Tokens → Create Token\n' +
      '     2) 模板选 Edit Cloudflare Workers，追加权限：D1:Edit、Account Settings:Read\n' +
      '     3) 复制令牌，粘贴保存到 worker/.cf-token（已 gitignore，不会提交）\n' +
      '\n  完成后重新运行：node worker/deploy.mjs',
  )
}
const whoLine = who.out.split('\n').find((l) => /@|associated|logged in/i.test(l)) ?? ''
ok(`凭据有效 ${whoLine.trim() ? '· ' + whoLine.trim() : ''}`)

// ── 2. 准备 D1 数据库（先查现有，没有才创建）─────────────────
log(`准备 D1 数据库 ${DB_NAME}`)
let dbId = null
const list = wr(['d1', 'list', '--json'])
const arr = parseJsonLoose(list.out)
const hit = Array.isArray(arr) ? arr.find((d) => d.name === DB_NAME) : null
if (hit && (hit.uuid || hit.id)) {
  dbId = hit.uuid ?? hit.id
  ok(`已存在：database_id = ${dbId}`)
} else {
  const createOut = wr(['d1', 'create', DB_NAME])
  const mId = createOut.out.match(/database_id\s*=\s*"([0-9a-fA-F-]{36})"/)
  if (mId) {
    dbId = mId[1]
    ok(`已创建：database_id = ${dbId}`)
  } else {
    fail(`创建 D1 数据库失败：\n${createOut.out.slice(-900)}`)
  }
}

// 回填 wrangler.toml
let toml = readFileSync(TOML_PATH, 'utf8')
if (toml.includes('REPLACE_WITH_YOUR_D1_DATABASE_ID')) {
  writeFileSync(TOML_PATH, toml.replace('REPLACE_WITH_YOUR_D1_DATABASE_ID', dbId))
  ok('已回填 worker/wrangler.toml 的 database_id')
} else {
  const cur = toml.match(/database_id\s*=\s*"([^"]+)"/)?.[1]
  if (cur === dbId) {
    ok('wrangler.toml 的 database_id 已是目标值')
  } else {
    writeFileSync(TOML_PATH, toml.replace(/database_id\s*=\s*"[^"]+"/, `database_id = "${dbId}"`))
    warn(`wrangler.toml 的 database_id 由 ${cur ?? '(空)'} 更新为 ${dbId}`)
  }
}

// ── 3. 建表 ──────────────────────────────────────────────────
log('导入 schema.sql 建表（幂等）')
const schemaOut = wr(['d1', 'execute', DB_NAME, '--remote', '--file=./schema.sql', '-y'])
if (schemaOut.code !== 0 || /error|failed/i.test(schemaOut.out)) {
  fail(`建表失败：\n${schemaOut.out.slice(-1200)}`)
}
ok('users / user_spaces / user_files 三表就绪')

// ── 4. 部署 Worker ───────────────────────────────────────────
log('部署 Worker')
const depOut = wr(['deploy'])
const mUrl = depOut.out.match(/https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.workers\.dev/i)
if (!mUrl) {
  fail(`部署失败或无法解析地址：\n${depOut.out.slice(-1500)}`)
}
const API_BASE = mUrl[0].replace(/\/+$/, '')
ok(`已上线：${API_BASE}`)

// ── 5. JWT_SECRET ───────────────────────────────────────────
log('配置 JWT_SECRET')
let hasSecret = false
const sl = wr(['secret', 'list'])
const slJson = parseJsonLoose(sl.out)
if (Array.isArray(slJson)) hasSecret = slJson.some((s) => s?.name === 'JWT_SECRET')
if (hasSecret) {
  warn('JWT_SECRET 已存在，保留原值（更换会让所有已登录用户失效）')
} else {
  const secret = crypto.randomBytes(32).toString('hex')
  const put = wr(['secret', 'put', 'JWT_SECRET'], { input: `${secret}\n` })
  if (put.code !== 0 || /error|failed/i.test(put.out)) {
    fail(`写入 JWT_SECRET 失败：\n${put.out.slice(-800)}`)
  }
  ok('已生成并写入（运行时立即生效，无需重新部署）')
}

// ── 6. 回填前端地址 ─────────────────────────────────────────
log('回填前端 src/config.ts 的 CLOUD_API_BASE')
let cfg = readFileSync(CONFIG_PATH, 'utf8')
const before = cfg
cfg = cfg.replace(
  /export const CLOUD_API_BASE: string = '[^']*'/,
  `export const CLOUD_API_BASE: string = '${API_BASE}'`,
)
if (cfg === before) fail('config.ts 未匹配到 CLOUD_API_BASE 占位行，请手动填写：' + API_BASE)
writeFileSync(CONFIG_PATH, cfg)
ok(`CLOUD_API_BASE = ${API_BASE}`)

// ── 7. 健康检查 + 前端构建 ──────────────────────────────────
log('实测后端健康检查')
try {
  const r = await fetch(`${API_BASE}/api/health`, { signal: AbortSignal.timeout(15000) })
  const body = await r.text()
  ok(`HTTP ${r.status} · ${body.slice(0, 120)}`)
} catch (e) {
  warn(`从本机访问不通：${e?.message ?? e}`)
  warn('若你的用户主要在中国大陆，这通常意味着 workers.dev 被阻断，需要绑定自定义域名')
}

log('构建前端验证（含类型检查）')
const build = spawnSync('npm', ['run', 'build'], {
  cwd: ROOT,
  encoding: 'utf8',
  shell: process.platform === 'win32',
  maxBuffer: 32 * 1024 * 1024,
})
if (build.status !== 0) {
  fail(`前端构建失败：\n${`${build.stdout}${build.stderr}`.slice(-1200)}`)
}
ok('构建通过')

// ── 8. 提交推送 ─────────────────────────────────────────────
if (SKIP_PUSH) {
  log('跳过 git 提交推送（--skip-push）')
} else {
  log('提交并推送到 GitHub')
  const git = (args) =>
    spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', shell: false }).status ?? 1
  git(['add', 'src/config.ts', 'worker/wrangler.toml'])
  const committed = git([
    'commit',
    '-m',
    `deploy: 接入 Cloudflare Workers 后端（${API_BASE}）`,
  ])
  if (committed !== 0) warn('没有需要提交的变更，或提交失败（可手动检查）')
  const pushed = git(['push'])
  if (pushed !== 0) warn('推送失败，请手动 git push（Pages 需推送后才会更新线上前端）')
  else ok('已推送，GitHub Pages 将自动重新部署')
}

console.log(`
──────────────────────────────────────────────
✅ 全部完成

后端地址：${API_BASE}
前端配置：src/config.ts 已回填
下一步：
  1. 等 1~2 分钟让 GitHub Pages 完成重新部署
  2. 打开 https://guchengyap.github.io/liansheng/ ，设置页点「登录 / 注册」
  3. 立即注册的第一个账号自动成为管理员（admin），其维护内容 = 全站默认模板
  4. 在中国大陆网络下如无法访问后端，请在 Cloudflare 控制台给 Worker 绑定自定义域名
──────────────────────────────────────────────`)
