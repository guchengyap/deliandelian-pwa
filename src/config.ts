/**
 * 全局配置常量：云端后端地址与限额。
 *
 * CLOUD_API_BASE 三种状态：
 * - ''  （空串）= 未接入后端，应用运行纯本地模式（一切功能照旧，仅无账号体系）。
 *   当前处于此状态：后端已部署但 workers.dev 域名在中国大陆被 DNS 污染，
 *   待绑定自有域名后，把地址填进来并推送即可启用云端账号体系。
 * - 接入后填自有域名（推荐，大陆可访问）：
 *     export const CLOUD_API_BASE = 'https://api.你的域名.com'
 * - 或（仅境外可用）workers.dev 地址：
 *     export const CLOUD_API_BASE = 'https://liansheng-api.<你的子域>.workers.dev'
 * - 结尾不带斜杠，接口拼接形如 `${CLOUD_API_BASE}/api/login`。
 */
export const CLOUD_API_BASE: string = ''

/** 单用户云盘限额：120MB（与 Worker 端 LIMIT 保持一致）。 */
export const STORAGE_LIMIT = 120 * 1024 * 1024
