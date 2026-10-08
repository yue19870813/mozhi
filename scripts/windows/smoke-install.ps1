# Run only on an isolated Windows CI runner. Does not start the application UI.
$ErrorActionPreference = 'Stop'
$installer = Get-ChildItem "$PSScriptRoot/../../target/release/bundle/nsis/*-setup.exe" | Select-Object -First 1
if (!$installer) { throw 'NSIS installer missing' }
if (!$env:RUNNER_TEMP) { throw 'Requires an isolated CI runner with RUNNER_TEMP' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Requires an elevated isolated CI runner to test AllUsers installation'
}
$cases = @(
    @{ Mode = 'CurrentUser'; Destination = (Join-Path $env:LOCALAPPDATA 'MoZhi') },
    @{ Mode = 'AllUsers'; Destination = (Join-Path $env:ProgramFiles 'MoZhi') }
)
$vault = Join-Path $env:RUNNER_TEMP 'MozhiUserVault'
New-Item -ItemType Directory -Force $vault | Out-Null
$note = Join-Path $vault '保留笔记.md'
Set-Content -LiteralPath $note -Value '# User content' -Encoding utf8
foreach ($case in $cases) {
    $mode = $case.Mode
    $destination = $case.Destination
    if (Test-Path -LiteralPath $destination) { throw "Test destination already exists: $destination" }
    1..2 | ForEach-Object {
        # Exercise the installer's default directory rather than overriding it with /D.
        $process = Start-Process -FilePath $installer.FullName -ArgumentList "/S /$mode" -PassThru -Wait
        if ($process.ExitCode -ne 0) { throw "$mode install failed: $($process.ExitCode)" }
        if (!(Test-Path (Join-Path $destination 'mozhi.exe'))) { throw "$mode application executable missing" }
    }
    $uninstaller = Get-Item -LiteralPath (Join-Path $destination 'uninstall.exe')
    $process = Start-Process -FilePath $uninstaller.FullName -ArgumentList "/S /$mode _?=$destination" -PassThru -Wait
    if ($process.ExitCode -ne 0) { throw "$mode uninstall failed" }
    if (Test-Path (Join-Path $destination 'mozhi.exe')) { throw "$mode application was not removed" }
    if ((Get-Content -LiteralPath $note -Raw).Trim() -ne '# User content') { throw 'User vault changed' }
    Write-Host "$mode install, reinstall and uninstall passed: $destination"
}
