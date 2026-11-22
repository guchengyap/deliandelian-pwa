/**
 * 全局配置常量：云端后端地址与限额。
 *
 * CLOUD_API_BASE：已接入自有域名（线上正式环境，大陆可访问）：
 *     https://api.guchengyapls.dpdns.org
 * 结尾不带斜杠，接口拼接形如 `${CLOUD_API_BASE}/api/login`。
 *
 * 本地联调可建 `.env.local`（已被 .gitignore 忽略）覆盖：
 *     VITE_CLOUD_API_BASE=http://127.0.0.1:8787
 * 配合 `node worker/mock-server.mjs` 即可跑通注册/上传/删除全流程。
 */
export const CLOUD_API_BASE: string =
  import.meta.env.VITE_CLOUD_API_BASE ?? 'https://api.guchengyapls.dpdns.org'

/** 单用户云盘限额：120MB（与 Worker 端 LIMIT 保持一致）。 */
export const STORAGE_LIMIT = 120 * 1024 * 1024
