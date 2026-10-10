#!/bin/bash
# Build a CI-friendly DMG without mounting a writable image or automating Finder.
set -euo pipefail

if [[ $# -ne 2 || ! -d "$1" || "$1" != *.app || "$2" != *.dmg ]]; then
  echo "Usage: $0 <existing .app directory> <output .dmg>" >&2
  exit 1
fi

app_path="$1"
output_path="$2"
# Verify the complete app bundle, not just its Mach-O executable. A linker-only
# ad-hoc signature lacks the resource seal and is invalid for a distributed app.
codesign --verify --deep --strict --verbose=2 "$app_path"
app_name="$(basename "$app_path")"
volume_name="${app_name%.app}"
mkdir -p "$(dirname "$output_path")"
if [[ -e "$output_path" ]]; then
  echo "Refusing to overwrite existing disk image: $output_path" >&2
  exit 1
fi

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/mozhi-dmg.XXXXXX")"
trap 'rm -rf "$work_dir"' EXIT
mkdir "$work_dir/staging"
ditto "$app_path" "$work_dir/staging/$app_name"
codesign --verify --deep --strict --verbose=2 "$work_dir/staging/$app_name"
ln -s /Applications "$work_dir/staging/Applications"

# makehybrid avoids the writable-image create/attach/resize sequence used by
# Tauri's bundle_dmg.sh, which can fail on hosted macOS runners.
hdiutil makehybrid -hfs -hfs-volume-name "$volume_name" \
  -o "$work_dir/hybrid.dmg" "$work_dir/staging"
hdiutil convert "$work_dir/hybrid.dmg" -format UDZO \
  -o "$work_dir/installer.dmg"
hdiutil verify "$work_dir/installer.dmg"
mv "$work_dir/installer.dmg" "$output_path"
echo "Created disk image: $output_path"
