@echo off
chcp 65001 >nul
echo 得练得练 · 电脑端同步服务（关闭本窗口即可停止）
cd /d "%~dp0"
node server.mjs
pause
