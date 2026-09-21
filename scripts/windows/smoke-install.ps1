# Run only on an isolated Windows CI runner. Does not start the application UI.
$ErrorActionPreference = 'Stop'
$installer = Get-ChildItem "$PSScriptRoot/../../target/release/bundle/nsis/*-setup.exe" | Select-Object -First 1
if (!$installer) { throw 'NSIS installer missing' }
if (!$env:RUNNER_TEMP) { throw 'Requires an isolated CI runner with RUNNER_TEMP' }
$destination = Join-Path $env:RUNNER_TEMP 'MozhiInstall'
$vault = Join-Path $env:RUNNER_TEMP 'MozhiUserVault'
New-Item -ItemType Directory -Force $vault | Out-Null
$note = Join-Path $vault '保留笔记.md'
Set-Content -LiteralPath $note -Value '# User content' -Encoding utf8
1..2 | ForEach-Object {
    # NSIS /D must be the last argument and must not be quoted.
    $process = Start-Process -FilePath $installer.FullName -ArgumentList "/S /D=$destination" -PassThru -Wait
    if ($process.ExitCode -ne 0) { throw "Install failed: $($process.ExitCode)" }
    if (!(Test-Path (Join-Path $destination 'mozhi.exe'))) { throw 'Application executable missing' }
}
$uninstaller = Get-ChildItem "$destination/*uninstall*.exe" | Select-Object -First 1
if (!$uninstaller) { throw 'Uninstaller missing' }
$process = Start-Process -FilePath $uninstaller.FullName -ArgumentList "/S _?=$destination" -PassThru -Wait
if ($process.ExitCode -ne 0) { throw 'Uninstall failed' }
if (Test-Path (Join-Path $destination 'mozhi.exe')) { throw 'Application was not removed' }
if ((Get-Content -LiteralPath $note -Raw).Trim() -ne '# User content') { throw 'User vault changed' }
