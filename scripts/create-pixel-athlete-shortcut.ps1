$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtimePath = Join-Path $projectRoot 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path -LiteralPath $runtimePath)) { throw 'Electron is not installed.' }
$shortcutName = [string]::Concat([char]0x67E5,[char]0x770B,[char]0x50CF,[char]0x7D20,[char]0x89D2,[char]0x8272,'.lnk')
$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $projectRoot $shortcutName))
$shortcut.TargetPath = $runtimePath
$shortcut.Arguments = '"' + (Join-Path $projectRoot 'desktop\athlete-preview.cjs') + '" --pixel-athlete'
$shortcut.WorkingDirectory = $projectRoot
$shortcut.Description = 'Shuttle Flow pixel 3D appearance preview'
$shortcut.IconLocation = (Join-Path $projectRoot 'assets\desktop\icon.ico') + ',0'
$shortcut.Save()
Write-Output (Join-Path $projectRoot $shortcutName)
