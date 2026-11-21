/** 纯日期工具：全部按本地时区，返回 YYYY-MM-DD 字符串。 */

export function addDays(d: Date, n: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  x.setDate(x.getDate() + n)
  return x
}

export function parseKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** 周一作为一周起点（国内习惯），返回该周周一的 Date。 */
export function startOfWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const dow = (x.getDay() + 6) % 7 // 周一=0 … 周日=6
  return addDays(x, -dow)
}

/** 当前周的 7 个日期键（周一 → 周日）。 */
export function weekKeys(base: Date = new Date()): string[] {
  const monday = startOfWeek(base)
  return Array.from({ length: 7 }, (_, i) => fmt(addDays(monday, i)))
}

/** 月历网格：前置占位 null 补齐到周一开头，尾部补 null 到整周。 */
export function monthGrid(base: Date = new Date()): (string | null)[] {
  const y = base.getFullYear()
  const m = base.getMonth()
  const first = new Date(y, m, 1)
  const lead = (first.getDay() + 6) % 7
  const days = new Date(y, m + 1, 0).getDate()
  const cells: (string | null)[] = Array.from({ length: lead }, () => null)
  for (let i = 1; i <= days; i++) cells.push(fmt(new Date(y, m, i)))
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

export const WEEKDAY_CN = ['一', '二', '三', '四', '五', '六', '日']

export interface HeatWeek {
  /** 7 个日期键，周一 → 周日 */
  days: string[]
  /** 日期晚于今天时为 true，仅占位不渲染 */
  future: boolean[]
}

export interface HeatmapData {
  weeks: HeatWeek[]
  /** 每个列位置的月份标签，空串表示无 */
  months: string[]
}

/**
 * GitHub 风格年历：从「今天往前 364 天」所在周的周一开始，到本周日结束，
 * 保证 7 行 × 约 53 列，可横向滚动。
 */
export function yearHeatmap(base: Date = new Date()): HeatmapData {
  const today = fmt(base)
  const start = startOfWeek(addDays(base, -364))
  const weeks: HeatWeek[] = []
  const months: string[] = []

  let cursor = start
  let prevMonth = -1
  // 上限保护：最多 54 周；某一周的周一已晚于今天则不再渲染整周。
  for (let w = 0; w < 54 && cursor <= base; w++) {
    const days: string[] = []
    const future: boolean[] = []
    for (let i = 0; i < 7; i++) {
      const key = fmt(addDays(cursor, i))
      days.push(key)
      future.push(key > today)
    }
    const firstMonth = parseKey(days[0]).getMonth()
    months.push(firstMonth !== prevMonth ? `${firstMonth + 1}月` : '')
    prevMonth = firstMonth
    weeks.push({ days, future })
    cursor = addDays(cursor, 7)
  }
  return { weeks, months }
}

function fmt(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
