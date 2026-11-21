/**
 * PWA 清单运行时适配：
 * 静态 manifest 的 start_url 是相对值（'.'），但用户从 /alice/ 或 /bob/ 子路径
 * 添加到主屏幕时，希望启动后仍回到各自空间。这里在应用启动时读取静态清单，
 * 把 start_url / scope 改写为当前路径，再用 Blob URL 替换 <link rel="manifest">。
 *
 * 全部数据来自已随应用打包的静态清单，不请求任何外部网络。
 */

interface Manifest {
  name?: string
  short_name?: string
  description?: string
  lang?: string
  theme_color?: string
  background_color?: string
  display?: string
  start_url?: string
  scope?: string
  icons?: { src: string; sizes: string; type: string }[]
  [key: string]: unknown
}

export async function setupPwaManifest(): Promise<void> {
  const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
  if (!link?.href) return
  try {
    const res = await fetch(link.href)
    if (!res.ok) return
    const manifest = (await res.json()) as Manifest

    // 当前路径（保证以 / 结尾），作为该用户空间的主屏幕启动地址。
    const path = location.pathname.endsWith('/') ? location.pathname : `${location.pathname}/`
    manifest.start_url = path + location.search.replace(/[?&]space=[^&]*/g, '').replace(/^\?&?/, '')
    if (manifest.start_url.endsWith('?')) manifest.start_url = manifest.start_url.slice(0, -1)
    // scope 设为站点基路径，保证 sw 能控制所有用户子路径。
    const base = import.meta.env.BASE_URL || '/'
    manifest.scope = base

    // 图标 src 在静态清单里是相对名；Blob URL 下相对路径会失效，补成绝对地址。
    manifest.icons = manifest.icons?.map((icon) => ({
      ...icon,
      src: new URL(icon.src.replace(/^\.\//, ''), new URL(base, location.origin)).href,
    }))

    const blob = new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' })
    const url = URL.createObjectURL(blob)
    link.href = url
    // 旧 URL 由浏览器自行回收；此处不 revoke，避免主屏幕安装时取不到。
  } catch {
    // 清单读取失败时保留静态清单，不影响应用使用。
  }
}

/**
 * 按当前页面路径规范化 URL：若访问 /alice（无尾斜杠），补成 /alice/ 以稳定空间解析。
 * 不做 history 跳转，只是保证后续 API（manifest、SW scope）基于规范路径。
 */
export function normalizeSpaceUrl(): void {
  const p = location.pathname
  if (p !== '/' && !p.endsWith('/') && !p.split('/').pop()?.includes('.')) {
    history.replaceState(null, '', p + '/' + location.search + location.hash)
  }
}
