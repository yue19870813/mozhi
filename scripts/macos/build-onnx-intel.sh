#!/bin/bash
# ort-sys rc.13 has no Intel macOS binary. Build the matching CPU runtime.
set -euo pipefail
if [[ "$(uname -s)" != Darwin || "$(uname -m)" != x86_64 ]]; then
  echo 'This script must run on an Intel macOS host.' >&2
  exit 1
fi
runtime_commit=da9b5e364c465de65c49d91e696cd6485270757f # ONNX Runtime v1.28.0
runtime_root="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/mozhi-onnx-intel"
source_dir="$runtime_root/source"
library_dir="$runtime_root/lib"
mkdir -p "$source_dir" "$library_dir"
if [[ ! -d "$source_dir/.git" ]]; then
  git -C "$source_dir" init
  git -C "$source_dir" remote add origin https://github.com/microsoft/onnxruntime.git
fi
git -C "$source_dir" fetch --depth 1 origin "$runtime_commit"
git -C "$source_dir" checkout --detach FETCH_HEAD
test "$(git -C "$source_dir" rev-parse HEAD)" = "$runtime_commit"
python3 -m venv "$runtime_root/venv"
"$runtime_root/venv/bin/python" -m pip install 'cmake==3.31.6' 'numpy==2.2.6' 'packaging==25.0'
export PATH="$runtime_root/venv/bin:$PATH"
"$runtime_root/venv/bin/python" "$source_dir/tools/ci_build/build.py" \
  --build_dir "$runtime_root/build" --config Release --update --build \
  --build_shared_lib --skip_tests --parallel 3 \
  --cmake_extra_defines CMAKE_OSX_ARCHITECTURES=x86_64 CMAKE_OSX_DEPLOYMENT_TARGET=10.15
runtime_library="$runtime_root/build/Release/libonnxruntime.1.28.0.dylib"
test -f "$runtime_library"
cp "$runtime_library" "$library_dir/libonnxruntime.dylib"
install_name_tool -id '@rpath/libonnxruntime.dylib' "$library_dir/libonnxruntime.dylib"
codesign --force --sign - "$library_dir/libonnxruntime.dylib"
lipo -verify_arch x86_64 "$library_dir/libonnxruntime.dylib"
codesign --verify --strict "$library_dir/libonnxruntime.dylib"
config_file="$runtime_root/tauri-onnx-intel.json"
"$runtime_root/venv/bin/python" - "$library_dir" "$config_file" <<'PY'
import json, pathlib, sys
library = str(pathlib.Path(sys.argv[1]) / 'libonnxruntime.dylib')
pathlib.Path(sys.argv[2]).write_text(json.dumps({
    'bundle': {'macOS': {'files': {'Frameworks/libonnxruntime.dylib': library}}}
}))
PY
if [[ -n "${GITHUB_ENV:-}" ]]; then
  {
    echo "ORT_LIB_PATH=$library_dir"
    echo 'ORT_PREFER_DYNAMIC_LINK=1'
    echo "DYLD_LIBRARY_PATH=$library_dir"
    echo "MOZHI_INTEL_TAURI_CONFIG=$config_file"
  } >> "$GITHUB_ENV"
fi
echo "Intel runtime ready: $library_dir"
