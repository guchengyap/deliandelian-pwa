# 练声助手还没取名字

纯静态的练声跟练与打卡 PWA。无服务端、无云依赖：目录与打卡记录存 IndexedDB，上传的音频/图片存 OPFS，安装后离线可用。

## 本地运行

```bash
npm install
npm run dev
```

构建产物在 `dist/`。本地想体验同步服务：

```bash
npm run build
cd sync && node server.mjs
```

然后浏览器打开 `http://localhost:3456/`，同一 Wi-Fi 下手机可用电脑显示的局域网地址访问并「添加到主屏幕」。

## 部署到 GitHub Pages（push 主分支自动构建）

1. 把本项目 push 到自己的 GitHub 仓库，进入仓库 **Settings → Pages**，Source 选 **GitHub Actions**。
2. 仓库里已有 `.github/workflows/deploy.yml`：push 到 `main` 或 `master` 即自动构建部署，也可在 Actions 页手动触发。
3. 部署地址形如 `https://<用户名>.github.io/<仓库名>/`。工作流已自动把 `BASE_PATH` 设为 `/<仓库名>/`，无需手改。

若用自定义域名根部署，把工作流里的 `BASE_PATH` 改成 `/`。

更新方式：`vite-plugin-pwa` 使用 `registerType: 'autoUpdate'`，Service Worker 在后台拉取新版本并静默接管，用户下次打开即为最新版，无需手动刷新或清缓存。

## 多用户子路径

同一站点可为每个人分配独立子路径，例如：

```
https://<用户名>.github.io/<仓库名>/alice/
https://<用户名>.github.io/<仓库名>/bob/
```

两者共享同一份静态资源与同一 Origin，但数据互不干扰：

- 应用按 URL 最后一段推导出「空间名」，IndexedDB 库名（`liansheng-alice` / `liansheng-bob`）与 OPFS 目录（`files-alice` / `files-bob`）都带空间前缀；
- 根路径（`default` 空间）使用库名 `liansheng` 与目录 `files`；更名前的旧库会在首次启动时自动迁移到新库（旧库保留作回滚备份）；
- 电脑端同步服务按空间分库（`sync-data-alice.json` 等）并只向同空间客户端广播；
- 从各自子路径「添加到主屏幕」后，启动地址仍是该子路径。

> 说明：这是应用层的隔离，方便不同人共用一套部署；由于同属一个 Origin，它不是安全沙箱。需要真正的浏览器级隔离请改用不同子域名或不同站点。

`/<仓库名>/alice/` 这类路径由构建生成的 `404.html` 回退到应用入口（GitHub Pages 规则），无需额外服务器配置。

## 备份与迁移

设置页 →「备份与恢复」可导出/导入 zip，包含 `records.json`、`practice-items.json` 与 `files/`（用户上传的文件）。导入时记录按 `record_id` + `updated_at` 合并，练声项整体恢复，编号按 `order` 重建。

## 目录结构

- `src/db/` — Dexie 数据模型、种子数据、记录合并
- `src/lib/` — 音频会话、OPFS、备份、同步客户端、空间隔离、PWA 适配
- `src/components/` — 跟练、统计、维护、设置、帮助教程
- `sync/` — 零依赖 Node 同步服务（HTTP 静态 + WebSocket）
- `.github/workflows/deploy.yml` — GitHub Pages 自动部署
