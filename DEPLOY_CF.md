# Cloudflare Workers + D1 后端部署指引

> **当前部署状态（2026-11-22 已完成）**
>
> | 项目 | 值 |
> | --- | --- |
> | Cloudflare 账号 | `levein1998@gmail.com`（已 OAuth 授权 wrangler） |
> | Worker 名称 | `deliandelian-api` |
> | workers.dev 地址 | `https://deliandelian-api.deliandelian.workers.dev`（**境外可用；中国大陆被 DNS 污染，不可用**） |
> | workers.dev 子域 | `deliandelian`（已注册） |
> | D1 数据库 | `deliandelian` · id `9e644177-84e7-4254-aa64-8c70e943578e`（三张表已建） |
> | JWT_SECRET | 已写入（Cloudflare Secret，不在仓库） |
> | 前端状态 | `src/config.ts` 仍为空串 = **纯本地模式**（等绑定自有域名后启用云端） |
>
> 一键部署脚本：`node worker/deploy.mjs`（已登录状态下可重复执行，幂等）。
> **下一步只剩「绑定自有域名」**——见文末第 8 节。

---

## 0. 架构速览

```
GitHub Pages（前端 PWA，已上线，中国大陆实测 1.07s 可访问）
        │  HTTPS + Bearer Token
        ▼
Cloudflare Worker（本仓库 worker/ 目录：注册/登录/空间读写/文件上传）
        │  D1 绑定
        ▼
Cloudflare D1（SQLite：users / user_spaces / user_files 三张表）
```

- 单用户云盘限额 **120 MB**，前后端双重校验。
- 第一个注册的账号自动成为 **管理员（admin）**，其维护内容即「默认模板空间」；游客与所有新用户都从它复制初始数据。
- ⚠️ **`*.workers.dev` 域名在中国大陆被 DNS 污染（解析到 Facebook IP），必须绑定自有域名才能给大陆用户使用。**

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

## 8. 中国大陆访问：绑定自有域名（唯一剩余步骤）

**为什么必须做**：实测 `deliandelian-api.deliandelian.workers.dev` 在大陆被 DNS 污染（解析到 `31.13.95.17` 等 Facebook IP，连接超时）；而 Cloudflare 的普通域名在同一网络下 200 OK（3.7s），所以换自有域名即可解决。

### 8.1 买域名（约 ¥1~10 首年）

在任意注册商下单即可（需要实名认证，支付宝/微信付款）：

- 阿里云 / 腾讯云：`.top`、`.xyz` 常有 1 元首年活动（续费约 ¥20~30/年）
- 想用 `.com`：约 ¥55~70/年

> 境外托管（Cloudflare）**不需要 ICP 备案**，域名注册后可直接使用。

### 8.2 把域名接入 Cloudflare（免费计划）

1. Cloudflare 控制台 → **Add a site** → 输入域名 → 选 **Free** 计划
2. Cloudflare 给你两条 NS（形如 `xxx.ns.cloudflare.com`）
3. 回到域名注册商的 DNS 设置，把 NS 改成这两条
4. 等待生效（通常 5 分钟~2 小时，控制台站点状态变为 **Active**）

### 8.3 给 Worker 绑定自定义域名

1. Cloudflare 控制台 → **Workers & Pages** → `deliandelian-api` → **Settings** → **Domains & Routes**
2. **Add** → **Custom Domain** → 填 `api.你的域名`（例如 `api.deliandelian.top`）
3. 保存后等待 1~2 分钟证书签发（状态变 Active）

### 8.4 回填前端地址并上线

```ts
// src/config.ts
export const CLOUD_API_BASE: string = 'https://api.你的域名'
```

```bash
git add src/config.ts && git commit -m "cloud: 启用自有域名后端" && git push
```

### 8.5 验证（在项目根目录）

```bash
curl https://api.你的域名/api/health
# 期望：{"ok":true,...}
```

通了之后打开应用 → 设置页 → 登录/注册 → **立即注册的第一个账号即为管理员**。

> 若日后前端也换成自己的域名，记得把新来源加进 `worker/wrangler.toml` 的 `ALLOWED_ORIGINS` 并重新 `npx wrangler deploy`。

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
