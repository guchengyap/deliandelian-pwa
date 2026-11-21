' 练声助手 · 同步服务静默启动器（无黑窗口，后台运行）
' 用途：注册到 Windows 启动项后，电脑开机即自动在后台运行同步服务。
' 卸载：删除「启动」文件夹里的「练声助手同步服务」快捷方式即可。
' 手动启动一次也可以直接双击本文件。
Option Explicit
Dim sh, dir
Set sh = CreateObject("WScript.Shell")
dir = Replace(WScript.ScriptFullName, "\start-sync-hidden.vbs", "")
sh.CurrentDirectory = dir
' 参数 0 = 隐藏窗口；False = 不等待进程结束
sh.Run "cmd /c node server.mjs", 0, False
