' Launches the RAG.AI server silently at Windows logon (no visible console window).
' Logs go to rag-startup.log next to this file, in case something needs checking.
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
Set shell = CreateObject("WScript.Shell")
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & scriptDir & "\start-server-autostart.ps1"" >> """ & scriptDir & "\rag-startup.log"" 2>&1"
shell.Run "cmd.exe /c " & cmd, 0, False
