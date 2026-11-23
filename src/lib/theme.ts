import { db } from '../db/db'

/** 应用主题：液态冰蓝（默认）/ 落日橙。选择持久化到 Dexie config 表。 */
export type ThemeName = 'theme-ice' | 'theme-sunset'

const THEME_KEY = 'theme'
const DEFAULT_THEME: ThemeName = 'theme-ice'

/** 状态栏颜色随主题联动（iOS 添加到主屏幕后的观感）。 */
const STATUS_COLORS: Record<ThemeName, string> = {
  'theme-ice': '#e9f0f8',
  'theme-sunset': '#fdf8f5',
}

export function applyTheme(name: ThemeName): void {
  const body = document.body
  body.classList.remove('theme-ice', 'theme-sunset')
  body.classList.add(name)
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', STATUS_COLORS[name])
}

/** 应用启动时调用：读库恢复主题，无配置则默认冰蓝。 */
export async function loadTheme(): Promise<ThemeName> {
  let name = DEFAULT_THEME
  try {
    const entry = await db.config.get(THEME_KEY)
    if (entry?.value === 'theme-sunset' || entry?.value === 'theme-ice') {
      name = entry.value
    }
  } catch {
    // 库不可用时保持默认主题，不阻塞启动。
  }
  applyTheme(name)
  return name
}

/** 切换并持久化。 */
export async function setTheme(name: ThemeName): Promise<void> {
  applyTheme(name)
  try {
    await db.config.put({ key: THEME_KEY, value: name })
  } catch {
    // 持久化失败不中断：本次会话内主题已生效。
  }
}

export function currentTheme(): ThemeName {
  return document.body.classList.contains('theme-sunset') ? 'theme-sunset' : 'theme-ice'
}
