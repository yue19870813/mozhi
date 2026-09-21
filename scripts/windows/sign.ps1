# Use as Tauri bundle.windows.signCommand: pwsh -File <absolute-path>/sign.ps1 %1
# Certificate must already exist in CurrentUser\My on the protected signing runner.
param([Parameter(Mandatory = $true)][string]$Path)
$ErrorActionPreference = 'Stop'
if (!$env:MOZHI_CERT_THUMBPRINT) { throw 'MOZHI_CERT_THUMBPRINT is required' }
$tool = Get-Command signtool.exe -ErrorAction Stop
& $tool.Source sign /sha1 $env:MOZHI_CERT_THUMBPRINT /fd SHA256 /tr 'http://timestamp.digicert.com' /td SHA256 $Path
if ($LASTEXITCODE -ne 0) { throw 'Authenticode signing failed' }
& $tool.Source verify /pa /all $Path
if ($LASTEXITCODE -ne 0) { throw 'Authenticode verification failed' }
