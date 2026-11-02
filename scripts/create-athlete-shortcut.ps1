$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtimePath = Join-Path $projectRoot 'node_modules\electron\dist\electron.exe'
$viewerEntry = Join-Path $projectRoot 'desktop\athlete-preview.cjs'
if (-not (Test-Path -LiteralPath $runtimePath)) { throw 'Electron is not installed. Run npm install first.' }
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'assets\characters\anime-athlete-v1\preview.html'))) { throw 'Build the athlete first: npm run build:athlete' }
$shortcutName = [string]::Concat([char]0x67E5, [char]0x770B, '3D', [char]0x89D2, [char]0x8272, '.lnk')
$shortcutPath = Join-Path $projectRoot $shortcutName
$shortcutShell = New-Object -ComObject WScript.Shell
$shortcut = $shortcutShell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $runtimePath
$shortcut.Arguments = '"' + $viewerEntry + '"'
$shortcut.WorkingDirectory = $projectRoot
$shortcut.Description = 'Shuttle Flow 3D athlete preview'
$iconPath = Join-Path $projectRoot 'assets\desktop\icon.ico'
if (Test-Path -LiteralPath $iconPath) { $shortcut.IconLocation = $iconPath + ',0' }
$shortcut.Save()
Write-Output $shortcutPath
