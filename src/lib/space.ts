/**
 * 多用户「空间」隔离。
 *
 * 同一站点的 /alice/、/bob/ 属于同一个 Origin，浏览器原生存储（IndexedDB / OPFS）
 * 并不会按路径分开。这里按 URL 子路径推导出一个空间名，用它给数据库名和 OPFS
 * 目录加前缀，从而在应用层实现互相隔离。
 *
 * 规则：
 * - 取 pathname 最后一段合法路径段作为空间名（小写字母/数字/下划线/连字符，1–32 位）；
 * - 根路径、index.html、无合法段一律回退到 'default'；
 * - 'default' 是老用户空间，库名统一为 liansheng，OPFS 目录沿用 files。
 *
 * 注意：这不是安全边界——同一 Origin 下的脚本理论上都能访问彼此的库，
 * 它只是让两个独立部署路径的日常数据互不覆盖。
 */

export const DEFAULT_SPACE = 'default'

const SEGMENT = /^[a-z0-9][a-z0-9_-]{0,31}$/i

/**
 * 已登录用户的本地隔离空间：u-<uid 前 8 位>。
 * 同步读 localStorage（无网络、无依赖），保证 db.ts 模块加载时即可确定库名。
 */
function loggedInUid(): string | null {
  try {
    const token = localStorage.getItem('auth_token')
    if (!token) return null
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return typeof payload?.uid === 'string' && payload.uid ? (payload.uid as string) : null
  } catch {
    return null
  }
}

export function currentSpace(): string {
  // 登录用户优先：本地库与 OPFS 目录按用户隔离，互不干扰。
  const uid = loggedInUid()
  if (uid) return `u-${uid.slice(0, 8).toLowerCase()}`
  try {
    const parts = location.pathname.split('/').filter(Boolean)
    const last = parts[parts.length - 1]
    if (!last || last.toLowerCase() === 'index.html') return DEFAULT_SPACE
    if (!SEGMENT.test(last) || last.toLowerCase() === DEFAULT_SPACE) return DEFAULT_SPACE
    return last.toLowerCase()
  } catch {
    return DEFAULT_SPACE
  }
}

/** Dexie 数据库名：默认空间用项目名，其余加空间后缀。 */
export function dbName(space: string): string {
  return space === DEFAULT_SPACE ? 'liansheng' : `liansheng-${space}`
}

/** OPFS 文件目录名：默认空间保留原名，其余加后缀。 */
export function opfsDirName(space: string): string {
  return space === DEFAULT_SPACE ? 'files' : `files-${space}`
}

/** 供 Worker 使用的当前空间（模块加载时确定，运行期 URL 不会变）。 */
export const SPACE = currentSpace()
