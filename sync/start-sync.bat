@echo off
echo 练声助手 · 电脑端同步服务（关闭本窗口即可停止）
cd /d "%~dp0"
call "%~dp0node-path.bat"
if not defined NODE_EXE (
  echo 未找到 Node.js 运行时，请安装 Node.js 后重试。
  pause
  exit /b 1
)
echo 使用运行时：%NODE_EXE%
"%NODE_EXE%" server.mjs
pause
