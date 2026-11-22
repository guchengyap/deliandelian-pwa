# 练声助手还没取名字

纯静态的练声跟练与打卡 PWA。前端托管在 GitHub Pages，打卡与练习记录存浏览器 IndexedDB，上传的音频/图片存 OPFS；可选的 Cloudflare Worker + D1 提供账号与云端空间。**不需要在自己的电脑上常驻运行任何服务。**

- 线上地址：https://guchengyap.github.io/liansheng/
- 仓库：https://github.com/guchengyap/liansheng

## 访问与安装

打开线上地址即可使用。手机浏览器菜单里「添加到主屏幕」，之后像 App 一样全屏打开，断网也能用（Service Worker 缓存）。

## 本地开发（只在改代码时需要）

```bash
npm ci         # 首次或依赖变更后
npm run dev    # 本地预览 http://localhost:5173，用完 Ctrl+C 关掉
npm run build  # 类型检查 + 生成 dist/（发布由 CI 完成，本地不必构建）
```

`npm run dev` 只是临时的开发服务器，不常驻、不开机自启。

## 改代码并发布

任选一种，push 到 `main` 后 GitHub Actions 自动构建部署，通常 1~2 分钟上线。

### 方式一：本地改（改多处时推荐）

```bash
cd "D:\WorkBuddy\workspaces\3 - 音乐\liansheng"
git pull                    # 先同步，避免冲突
# ……改代码……
npm run dev                 # 需要时本地预览
git add -A
git commit -m "feat: 说明改了什么"
git push
```

### 方式二：GitHub 网页改（改文案、调参数最省事）

打开仓库 → 点进文件 → 右上角铅笔图标 → 编辑 → 页面底部 **Commit changes**（提交到 `main`）。提交即触发构建，不需要本地环境。

### 确认发布结果

- 构建日志：https://github.com/guchengyap/liansheng/actions —— 最近一次 `Deploy to GitHub Pages` 变绿即成功
- 线上页面：https://guchengyap.github.io/liansheng/
- 版本核对：应用内「设置 → 应用版本」显示新的构建时间；手机端没立刻变就关掉应用重开一次

## 部署到 GitHub Pages

1. 仓库 **Settings → Pages**，Source 选 **GitHub Actions**（已配置好）。
2. `.github/workflows/deploy.yml`：push 到 `main` 即自动构建部署，也可在 Actions 页手动触发。
3. 部署地址形如 `https://<用户名>.github.io/<仓库名>/`，工作流已自动把 `BASE_PATH` 设为 `/<仓库名>/`，无需手改。

若用自定义域名根部署，把工作流里的 `BASE_PATH` 改成 `/`。

`vite-plugin-pwa` 使用 `registerType: 'autoUpdate'`，Service Worker 在后台拉取新版本并静默接管，用户下次打开即为最新版。

## 多用户子路径

同一站点可为每个人分配独立子路径，例如：

```
https://<用户名>.github.io/<仓库名>/alice/
https://<用户名>.github.io/<仓库名>/bob/
```

两者共享同一份静态资源与同一 Origin，但数据互不干扰：

- 应用按 URL 最后一段推导出「空间名」，IndexedDB 库名（`liansheng-alice` / `liansheng-bob`）与 OPFS 目录（`files-alice` / `files-bob`）都带空间前缀；
- 根路径（`default` 空间）使用库名 `liansheng` 与目录 `files`；
- 可选的本地同步服务按空间分库（`sync-data-alice.json` 等）并只向同空间客户端广播；
- 从各自子路径「添加到主屏幕」后，启动地址仍是该子路径。

> 说明：这是应用层的隔离，方便不同人共用一套部署；由于同属一个 Origin，它不是安全沙箱。需要真正的浏览器级隔离请改用不同子域名或不同站点。

`/<仓库名>/alice/` 这类路径由构建生成的 `404.html` 回退到应用入口（GitHub Pages 规则），无需额外服务器配置。

## 备份与迁移

设置页 →「备份与恢复」可导出/导入 zip，包含 `records.json`、`practice-items.json` 与 `files/`（用户上传的文件）。导入时记录按 `record_id` + `updated_at` 合并，练声项整体恢复，编号按 `order` 重建。

## 目录结构

- `src/db/` — Dexie 数据模型、种子数据、记录合并
- `src/lib/` — 音频会话、OPFS、备份、同步客户端、空间隔离、PWA 适配
- `src/components/` — 跟练、统计、维护、设置、帮助教程
- `worker/` — Cloudflare Worker + D1 后端（部署见 `DEPLOY_CF.md`），线上待命，前端未接入时自动回退本地模式
- `sync/` — 可选的局域网同步服务（默认不启动、不开机自启，需手动双击 `start-sync.bat`）
- `.github/workflows/deploy.yml` — GitHub Pages 自动部署
