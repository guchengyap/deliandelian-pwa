/**
 * 跨环境安全的 UUID 生成（全局唯一入口，新代码禁止直接用 crypto.randomUUID）。
 *
 * 为什么不能直接调 crypto.randomUUID()：
 * 它只在「安全上下文」（HTTPS / localhost）暴露。手机经局域网 HTTP 访问电脑
 * （如 http://192.168.31.205:3456）时该 API 不存在，首次打卡生成 record_id、
 * 维护模式新增练习项目/分组/上传文件生成 id 时都会抛
 * "crypto.randomUUID is not a function"，表现为打卡失败、无法新增内容。
 *
 * 兜底链：原生 randomUUID → getRandomValues 手写 RFC 4122 v4（getRandomValues
 * 在非安全上下文同样可用，iOS 7.1+/Android 全支持）→ 时间戳+随机数极端兜底。
 */
export function uuid(): string {
  const c: Crypto | undefined = typeof crypto !== 'undefined' ? crypto : undefined
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()

  if (c && typeof c.getRandomValues === 'function') {
    const buf = new Uint8Array(16)
    c.getRandomValues(buf)
    buf[6] = (buf[6] & 0x0f) | 0x40 // version 4
    buf[8] = (buf[8] & 0x3f) | 0x80 // variant 10x
    const hex = Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }

  // 极端环境兜底：唯一性对打卡/目录 id 而言足够
  const t = Date.now().toString(16).padStart(12, '0')
  const r = (): string => Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0')
  return `${t.slice(0, 8)}-${t.slice(8)}-${r()}-${r()}-${r()}${r()}`
}
