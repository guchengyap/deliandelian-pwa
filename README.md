# 练声助手

[![Deploy to GitHub Pages](https://github.com/guchengyap/liansheng/actions/workflows/deploy.yml/badge.svg)](https://github.com/guchengyap/liansheng/actions/workflows/deploy.yml)

手机跟练打卡 PWA：内置练习目录，跟着音频逐项练，播完自动打卡。数据本地优先，登录后定制内容与素材存云端，**无需在任何电脑上常驻运行服务**。

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

| 数据 | 位置 |
| --- | --- |
| 打卡记录 | 本机浏览器（按账号分库隔离，永不上传） |
| 练习模板与素材 | 游客 = 内置默认模板；登录 = 自己的云端空间 |

换设备：登录账号带走定制内容；打卡记录用「设置 → 导出 JSON 备份」迁移。

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

可选后端：Cloudflare Workers + D1（部署见 [DEPLOY_CF.md](DEPLOY_CF.md)，当前前端为纯本地模式，未接入时不影响任何功能）。

## 更多文档

| 文档 | 内容 |
| --- | --- |
| [使用教程.md](使用教程.md) | 面向使用者的完整说明 |
| [部署指南.md](部署指南.md) | 本地运行与自定义部署 |
| [DEPLOY_CF.md](DEPLOY_CF.md) | Cloudflare 后端部署、接口与运维 |
