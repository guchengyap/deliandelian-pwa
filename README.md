# 练声助手

[![Deploy to GitHub Pages](https://github.com/guchengyap/liansheng/actions/workflows/deploy.yml/badge.svg)](https://github.com/guchengyap/liansheng/actions/workflows/deploy.yml)

手机跟练打卡 PWA：内置练习目录，跟着音频逐项练，播完自动打卡。登录后打卡状态与个人数据随账户云端同步，**无需在任何电脑上常驻运行服务**。

**线上使用** → https://guchengyap.github.io/liansheng/

手机浏览器打开后点「添加到主屏幕」，即可像 App 一样全屏使用，断网也能练。

## 功能

- **跟练** — 一屏一项，音频自动连播，播完自动打卡并跳下一项
- **打卡** — 圆勾单击打卡 / 再点取消；当日页支持一键全打、一键清零
- **统计** — 今日进度、本周柱状、月历、全年热力图
- **维护模式** — 登录后可编辑项目结构、上传音频 / 图片（每人 120MB 云盘，超额可就地清理）
- **多主题** — 冰蓝 / 落日橙，自动适配深色模式
- **离线可用** — Service Worker 全量预缓存，装一次到处用

## 数据存在哪

- **已登录账号（含普通用户与管理员）**：打卡状态、练习记录及个人空间随账户云端同步，按账号隔离、多端一致。
- **未登录游客 / 默认模板**：仅展示默认模板结构；未登录时的本地打卡只作当前设备试用，不写入云端默认模板；管理员的个人打卡不会成为默认打卡状态。

换设备：登录同一账号即可恢复打卡与定制内容，多端一致。

## 改代码并发布

push 到 `main` 后 GitHub Actions 自动构建上线（约 1~2 分钟）：

```bash
git pull
# ……改代码（需要预览就 npm run dev）……
git add -A && git commit -m "feat: 改了什么" && git push
```

也可以直接在 GitHub 网页编辑文件后提交，效果相同。

- 版本号只改 `package.json` 的 `"version"`，构建时间与 commit hash 自动注入
- 上线后在应用内「设置 → 应用版本」核对，如 `v1.0.0 · 2026-11-22 18:38 · 345fb0b`

## 技术栈

Vite · Vue 3 · TypeScript · Dexie (IndexedDB) · OPFS · vite-plugin-pwa

后端：Cloudflare Workers + D1，已接入自有域名 `api.guchengyapls.dpdns.org`（部署与接口见 [DEPLOY_CF.md](DEPLOY_CF.md)）。

## 更多文档

| 文档 | 内容 |
| --- | --- |
| [使用教程.md](使用教程.md) | 面向使用者的完整说明 |
| [部署指南.md](部署指南.md) | 本地运行与自定义部署 |
| [DEPLOY_CF.md](DEPLOY_CF.md) | Cloudflare 后端部署、接口与运维 |
