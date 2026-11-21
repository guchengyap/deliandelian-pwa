/**
 * 全局配置常量：云端后端地址与限额。
 *
 * CLOUD_API_BASE 三种状态：
 * - ''  （空串）= 未部署后端，应用自动回退纯本地模式（一切功能照旧，仅无账号体系）
 * - 部署 Worker 后，把返回的 workers.dev 地址（或自定义域名）填到这里，例如：
 *     export const CLOUD_API_BASE = 'https://deliandelian-api.<你的子域>.workers.dev'
 * - 结尾不带斜杠，接口拼接形如 `${CLOUD_API_BASE}/api/login`。
 */
export const CLOUD_API_BASE: string = ''

/** 单用户云盘限额：120MB（与 Worker 端 LIMIT 保持一致）。 */
export const STORAGE_LIMIT = 120 * 1024 * 1024
