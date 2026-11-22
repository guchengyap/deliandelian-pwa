' 练声助手 · 同步服务静默启动器（无黑窗口，后台运行）
' 用途：注册到 Windows 启动项后，电脑开机即自动在后台运行同步服务。
' 卸载：删除「启动」文件夹里的「练声助手同步服务」快捷方式即可。
' 手动启动一次也可以直接双击本文件。
Option Explicit
Dim sh, fso, dir, node, base, folder, logf

Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir

' 依次寻找可用的 Node 运行时（系统安装优先，其次 WorkBuddy 自带）
node = ""
If fso.FileExists("C:\Program Files\nodejs\node.exe") Then
  node = "C:\Program Files\nodejs\node.exe"
End If
If node = "" Then
  base = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Programs\nodejs\node.exe"
  If fso.FileExists(base) Then node = base
End If
If node = "" Then
  base = sh.ExpandEnvironmentStrings("%USERPROFILE%") & "\.workbuddy\binaries\node\versions"
  If fso.FolderExists(base) Then
    For Each folder In fso.GetFolder(base).SubFolders
      If fso.FileExists(folder.Path & "\node.exe") Then node = folder.Path & "\node.exe"
    Next
  End If
End If

If node = "" Then
  Set logf = fso.CreateTextFile(dir & "\start-error.log", True)
  logf.WriteLine "未找到 Node.js 运行时，同步服务无法启动：" & Now
  logf.Close
  WScript.Quit 1
End If

' 参数 0 = 隐藏窗口；False = 不等待进程结束
sh.Run """" & node & """ """ & dir & "\server.mjs""", 0, False
