#!/usr/bin/env bash
# 为 mozhi 的 Rust 构建准备 MSVC 环境。
#
# 为什么需要它：Windows Build Tools 装在 C:\BuildTools（非默认路径）时，
# cc-rs 能通过 vswhere 找到 cl.exe，但不会自动注入 INCLUDE / LIB，
# 于是编译 libgit2、openssl、sqlite 等 C 依赖时报 C1034: stdio.h: 找不到路径。
# 这里把 vcvars64.bat 导出的环境变量带进当前 shell。
#
# 只导入 INCLUDE / LIB / LIBPATH，不导入 PATH：
# vcvars 的 PATH 是 Windows 格式（分号分隔、反斜杠），直接导入会破坏 Git Bash 的 PATH；
# 而 cl.exe 本身 cc-rs 已经能自己找到。
#
# 用法：
#   source scripts/dev/msvc-env.sh
#   cargo test --workspace --locked
#
# PowerShell 用户请改用同目录的 msvc-env.ps1（dot-sourcing：. scripts\dev\msvc-env.ps1）。

MSVC_ENV_CACHE="$(dirname "${BASH_SOURCE[0]}")/.vcenv"

if [ ! -f "$MSVC_ENV_CACHE" ]; then
  powershell.exe -NoProfile -Command "\$env:VSCMD_SKIP_SENDTELEMETRY=1; cmd /c 'call \"C:\BuildTools\VC\Auxiliary\Build\vcvars64.bat\" >nul 2>&1 && set' | Where-Object { \$_ -match '^(INCLUDE|LIB|LIBPATH)=' }" 2>/dev/null \
    | tr -d '\r' > "$MSVC_ENV_CACHE"
fi

while IFS= read -r line; do
  line="${line%$'\r'}"
  case "$line" in
    INCLUDE=*|LIB=*|LIBPATH=*) export "$line" ;;
  esac
done < "$MSVC_ENV_CACHE"

if [ -z "$INCLUDE" ]; then
  echo "msvc-env: 未能加载 MSVC 环境，请检查 C:\\BuildTools 是否已安装" >&2
  return 1 2>/dev/null || exit 1
fi
