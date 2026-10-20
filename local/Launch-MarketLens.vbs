Option Explicit
Dim shell, files, folder, command, args, i, powershell
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
folder = files.GetParentFolderName(WScript.ScriptFullName)
args = ""
For i = 0 To WScript.Arguments.Count - 1
  If WScript.Arguments(i) = "--open" Then args = " -OpenBrowser"
Next
powershell = shell.ExpandEnvironmentStrings("%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe")
command = """" & powershell & """ -NoProfile -ExecutionPolicy Bypass -File """ & folder & "\Start-MarketLens.ps1""" & args
shell.Run command, 0, False
