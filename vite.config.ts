import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vite'
import { copyFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 部署基路径：
 * - 本地 / 自定义域名根部署：默认 '/'
 * - GitHub Pages 项目站：设为 '/仓库名/'（在 Actions 或 .env 中注入 BASE_PATH）
 * 资源引用全部走此前缀，子路径用户（/alice/）用 404.html 回退到同一份应用。
 */
const base = process.env.BASE_PATH || '/'

/** 构建后把 index.html 复制为 404.html：GitHub Pages 对 /repo/alice/ 等路径返回它，
 *  从而让每个用户子路径都能加载同一份应用，再由 space.ts 按路径隔离数据。 */
function spaFallback() {
  return {
    name: 'spa-fallback',
    apply: 'build' as const,
    closeBundle() {
      const dir = resolve(import.meta.dirname, 'dist')
      const from = resolve(dir, 'index.html')
      const to = resolve(dir, '404.html')
      if (existsSync(from)) copyFileSync(from, to)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base,
  // 构建版本：注入构建时刻（本地时区），设置页显示，便于核对设备是否跑的新版
  define: {
    __BUILD_ID__: JSON.stringify((() => {
      const d = new Date()
      const p = (n: number) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())} 构建`
    })()),
  },
  plugins: [
    vue(),
    spaFallback(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: '练声助手还没取名字',
        short_name: '练声助手还没取名字',
        description: '每日练声打卡与跟练',
        lang: 'zh-CN',
        theme_color: '#f2f2f7',
        background_color: '#f2f2f7',
        display: 'standalone',
        // 相对 manifest 所在目录；运行时由 pwaSetup 按当前子路径动态改写。
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icon-192.png?v=2', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png?v=2', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        // 默认静态资源 + 用户要求的 audio/** 与 images/**
        globPatterns: [
          '**/*.{js,css,html,ico,svg,png,webp,woff2}',
          'audio/**',
          'images/**',
        ],
        // 子路径直接访问时回退到应用入口（SPA）。
        navigateFallback: 'index.html',
        // sovt.mp3 约 2.4MB，超过 Workbox 默认 2MiB；调高上限保证全部预缓存。
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
    }),
  ],
})
