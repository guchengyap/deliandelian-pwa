# Cloudflare Workers + D1 后端部署指引

> 前端（GitHub Pages）已自动部署；本文把后端跑起来并接通。
> 全程约 10 分钟。**第 1 步需要在浏览器完成 Cloudflare 账号注册**，其余都在命令行。

---

## 0. 架构速览

```
GitHub Pages（前端 PWA，已上线）
        │  HTTPS + Bearer Token
        ▼
Cloudflare Worker（本仓库 worker/ 目录：注册/登录/空间读写/文件上传，全球边缘节点，国内可达性远好于 github.io）
        │  D1 绑定
        ▼
Cloudflare D1（SQLite：users / user_spaces / user_files 三张表）
```

- 单用户云盘限额 **120 MB**，前后端双重校验。
- 第一个注册的账号自动成为 **管理员（admin）**，其维护内容即「默认模板空间」；游客与所有新用户都从它复制初始数据。

---

## 1. 注册 Cloudflare 账号（浏览器）

1. 打开 <https://dash.cloudflare.com/sign-up>，用邮箱注册（免费计划即可，Workers 免费额度每天 10 万次请求，个人使用绰绰有余）。
2. 注册后无需添加域名/信用卡，直接进入控制台。

## 2. 命令行准备（在项目根目录执行）

```bash
# 安装项目依赖（wrangler 已写进 devDependencies，无需单独安装）
npm install

# 登录 Cloudflare：会自动打开浏览器授权，点 Allow
npx wrangler login

# 验证登录成功（应显示你的账号邮箱）
npx wrangler whoami
```

> 若 `npx wrangler` 报找不到命令（例如 node_modules 被清理过），单独补装一次即可：
> `npm install -D wrangler`（含 workerd 本地运行时约 100MB，网络慢请耐心）。

> 如果浏览器没弹出来，把终端里的 URL 复制到浏览器打开即可。

## 3. 创建 D1 数据库并建表

```bash
# 创建数据库（记住输出里的 database_id）
npx wrangler d1 create deliandelian
```

把输出的 `database_id` 填进 `worker/wrangler.toml`：

```toml
[[d1_databases]]
binding = "DB"
database_name = "deliandelian"
database_id = "把这一行替换为刚才的 database_id"
```

然后建表：

```bash
npx wrangler d1 execute deliandelian --remote --file=worker/schema.sql
```

## 4. 设置 JWT 签名密钥（敏感信息，不走代码仓库）

```powershell
# Windows PowerShell 生成一个随机密钥（也可自己编一串足够长的随机字符）
-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 48 | % {[char]$_})
```

```bash
# 把生成的字符串粘贴进去（输入后回车）
npx wrangler secret put JWT_SECRET
```

## 5. 部署 Worker

```bash
cd worker
npx wrangler deploy
```

成功后会输出类似：

```
Published deliandelian-api (x.xx sec)
  https://deliandelian-api.<你的子域>.workers.dev
```

**先自测一下后端**（浏览器或 curl 访问，应返回 `{"ok":true,...}`）：

```bash
curl https://deliandelian-api.<你的子域>.workers.dev/api/health
```

## 6. 回填前端 API 地址

编辑 `src/config.ts`，把空串换成上一步的地址（结尾不带斜杠）：

```ts
export const CLOUD_API_BASE = 'https://deliandelian-api.<你的子域>.workers.dev'
```

然后提交并推送，GitHub Pages 会自动重新部署：

```bash
git add src/config.ts worker/wrangler.toml
git commit -m "cloud: 接入 Cloudflare Worker 后端地址"
git push
```

等待 1~2 分钟 Pages 构建完成后，打开应用 → 设置页 → 「云端状态」应显示「云端已同步（已用 0.0 MB / 120.0 MB）」。

## 7. 注册管理员

部署后**第一个注册的账号自动成为管理员**：

1. 打开应用 → 设置 → 登录 / 注册 → 注册（用户名、邮箱、手机号、密码 + 可选头像）。
2. 注册成功后用该账号进维护模式，你的修改会保存为「默认模板」，游客和新用户都以它为初始内容。

---

## 附：本地开发调试（可选）

```bash
# 本地 D1 建表（--local 使用 .wrangler/ 下的本地模拟库）
npx wrangler d1 execute deliandelian --local --file=worker/schema.sql

# 本地起 Worker（默认 http://127.0.0.1:8787；密钥读 worker/.dev.vars）
cd worker && npx wrangler dev
```

本地联调前端：把 `src/config.ts` 的 `CLOUD_API_BASE` 临时设为 `http://127.0.0.1:8787`，`npm run dev` 后即可注册/登录/上传全流程测试。

## 常见问题

| 现象 | 解决 |
| --- | --- |
| `wrangler login` 卡住 | 确认浏览器已登录 Cloudflare；或复制终端 URL 手动打开 |
| 部署后接口 404 | 确认访问路径带 `/api/` 前缀；`wrangler deploy` 需在 `worker/` 目录执行 |
| 上传报「空间不足」 | 设置页/维护页查看已用容量，删除不需要的文件后再试（上限 120MB/用户） |
| 登录报 500 | 大概率忘了第 4 步 `JWT_SECRET`，执行后重新 `wrangler deploy` |
| 前端报 CORS 错误 | 把前端地址加进 `worker/wrangler.toml` 的 `ALLOWED_ORIGINS`，重新 deploy |
