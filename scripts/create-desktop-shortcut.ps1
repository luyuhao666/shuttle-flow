$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtimePath = Join-Path $projectRoot 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path -LiteralPath $runtimePath)) {
    $installerPath = Join-Path $projectRoot 'node_modules\electron\install.js'
    if (-not (Test-Path -LiteralPath $installerPath)) { throw 'Electron is not installed. Run npm install first.' }
    & node $installerPath
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $runtimePath)) { throw 'Electron runtime download failed.' }
}
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'assets\desktop\icon.ico'))) {
    & (Join-Path $PSScriptRoot 'create-desktop-icon.ps1')
}
$shortcutPath = Join-Path $projectRoot ([string]::Concat([char]0x542F,[char]0x52A8,[char]0x6E38,[char]0x620F,'.lnk'))
$shortcutShell = New-Object -ComObject WScript.Shell
$shortcut = $shortcutShell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $runtimePath
$shortcut.Arguments = '"' + $projectRoot + '"'
$shortcut.WorkingDirectory = $projectRoot
$shortcut.Description = 'Shuttle Flow'
$shortcut.IconLocation = (Join-Path $projectRoot 'assets\desktop\icon.ico') + ',0'
$shortcut.Save()
Write-Output $shortcutPath
