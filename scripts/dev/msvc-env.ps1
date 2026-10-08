# 为 mozhi 的 Rust 构建准备 MSVC 环境（PowerShell 版，对应 msvc-env.sh）。
#
# 为什么需要它：Windows Build Tools 装在 C:\BuildTools（非默认路径）时，
# cc-rs 能通过 vswhere 找到 cl.exe，但不会自动注入 INCLUDE / LIB，
# 于是编译 libgit2、openssl、sqlite 等 C 依赖时报
# C1083: 无法打开包括文件 "time.h"。
# 这里把 vcvars64.bat 导出的环境变量带进当前会话。
#
# 只导入 INCLUDE / LIB / LIBPATH，不导入 PATH：cl.exe 本身 cc-rs 已经能自己找到。
#
# 必须用 dot-sourcing 调用，否则变量只在子进程里生效、回到当前会话就丢了：
#   . scripts\dev\msvc-env.ps1
#   cargo test --workspace --locked

$vcvars = 'C:\BuildTools\VC\Auxiliary\Build\vcvars64.bat'
$cache = Join-Path $PSScriptRoot '.vcenv'

if (-not (Test-Path $cache)) {
    if (-not (Test-Path $vcvars)) {
        Write-Error "msvc-env: 找不到 $vcvars，请检查 C:\BuildTools 是否已安装"
        return
    }
    $env:VSCMD_SKIP_SENDTELEMETRY = 1
    # 与 .sh 版共用同一个缓存文件，格式保持一致（NAME=VALUE，每行一条）。
    # 必须写 LF：.sh 版按行读取后不会剥掉 CR，CRLF 会让最后一条路径带上 \r 而失效。
    $lines = cmd /c "call `"$vcvars`" >nul 2>&1 && set" |
        Where-Object { $_ -match '^(INCLUDE|LIB|LIBPATH)=' }
    [IO.File]::WriteAllText($cache, ($lines -join "`n") + "`n")
}

Get-Content $cache | ForEach-Object {
    if ($_ -match '^(INCLUDE|LIB|LIBPATH)=(.*)$') {
        Set-Item -Path "Env:$($Matches[1])" -Value $Matches[2].TrimEnd("`r")
    }
}

if (-not $env:INCLUDE) {
    Write-Error 'msvc-env: 未能加载 MSVC 环境，请删除 scripts\dev\.vcenv 后重试'
    return
}

Write-Host 'msvc-env: MSVC 环境已加载 (INCLUDE / LIB / LIBPATH)' -ForegroundColor Green
