@echo off
chcp 65001 >nul
echo 练声助手 · 注册同步服务开机自启（后台静默运行，无黑窗口）
echo.
set "LINK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\练声助手同步服务.lnk"
set "VBS=%~dp0start-sync-hidden.vbs"
powershell -NoProfile -Command "$s = (New-Object -ComObject WScript.Shell).CreateShortcut('%LINK%'); $s.TargetPath = '%VBS%'; $s.WorkingDirectory = '%~dp0'; $s.Save()"
if errorlevel 1 (
  echo 注册失败，请手动把 start-sync-hidden.vbs 的快捷方式放入：
  echo   shell:startup
) else (
  echo 注册成功！开机后同步服务自动后台运行，无需打开任何窗口。
  echo 现在立即启动一次：
  wscript.exe "%VBS%"
  echo 已启动。手机与电脑需在同一 Wi-Fi，访问电脑窗口/下方地址即可同步。
  ipconfig | findstr /i "IPv4"
)
echo.
echo 卸载方法：删除「启动」文件夹里的「练声助手同步服务」快捷方式。
echo   开始菜单 - 运行 - 输入 shell:startup 回车
pause
