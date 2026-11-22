/// <reference types="vite/client" />

/** 语义化版本号（vite.config.ts 注入，来源 package.json "version"），如 "v1.0.0"。 */
declare const __APP_VERSION__: string

/** 构建信息：本地时区时间 · 短 commit hash，如 "2026-11-22 18:35 · a1b2c3d"。 */
declare const __BUILD_ID__: string
