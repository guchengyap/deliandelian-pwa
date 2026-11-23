/**
 * 头像图片处理：本地裁剪压缩为 256×256 JPEG dataURL（约 ≤100KB）。
 * 供注册与设置页「更换头像」共用；源文件支持 JPG / PNG / WEBP，上限 5MB。
 */

const TARGET_SIDE = 256
const MAX_SOURCE_BYTES = 5 * 1024 * 1024
const TARGET_BYTES = 100 * 1024
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

/** 把 File 压缩为 256×256 居中裁方的 JPEG dataURL，逐档降质直至二进制 ≤100KB。 */
export function compressAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      reject(new Error('仅支持 JPG / PNG / WEBP 图片'))
      return
    }
    if (file.size > MAX_SOURCE_BYTES) {
      reject(new Error('图片不能超过 5MB'))
      return
    }
    const img = new Image()
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = TARGET_SIDE
        canvas.height = TARGET_SIDE
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          URL.revokeObjectURL(img.src)
          reject(new Error('当前浏览器不支持图片处理'))
          return
        }
        const side = Math.min(img.width, img.height)
        ctx.drawImage(
          img,
          (img.width - side) / 2,
          (img.height - side) / 2,
          side,
          side,
          0,
          0,
          TARGET_SIDE,
          TARGET_SIDE,
        )
        URL.revokeObjectURL(img.src)
        // 逐档降质，确保二进制体积 ≤100KB（base64 每 4 字符 ≈ 3 字节）
        for (const q of [0.85, 0.75, 0.62, 0.5, 0.4]) {
          const url = canvas.toDataURL('image/jpeg', q)
          const b64 = url.slice(url.indexOf(',') + 1)
          const bytes = Math.round((b64.length * 3) / 4)
          if (bytes <= TARGET_BYTES) {
            resolve(url)
            return
          }
        }
        resolve(canvas.toDataURL('image/jpeg', 0.4))
      } catch (e) {
        reject(e instanceof Error ? e : new Error('图片处理失败'))
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(img.src)
      reject(new Error('图片读取失败，请换一张试试'))
    }
    img.src = URL.createObjectURL(file)
  })
}
