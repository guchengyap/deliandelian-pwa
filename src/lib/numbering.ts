const CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']

/** 阿拉伯数字转中文数字，供一级项按 order 自动编号使用。 */
export function toChineseNumber(n: number): string {
  if (!Number.isInteger(n) || n < 1) return String(n)
  if (n < 10) return CN[n]!
  if (n === 10) return '十'
  if (n < 20) return '十' + CN[n - 10]!
  const tens = Math.floor(n / 10)
  const ones = n % 10
  return CN[tens]! + '十' + (ones ? CN[ones]! : '')
}

/** 二级项直接用阿拉伯数字展示 order。 */
export function toArabicNumber(n: number): string {
  return String(n)
}
