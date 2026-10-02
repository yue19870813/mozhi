#!/usr/bin/env python3
"""Prepare consistent release versions or collect the complete installer matrix."""
import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FILES = ['Cargo.toml', 'Cargo.lock', 'package.json', 'package-lock.json',
         'apps/desktop-mobile/package.json', 'apps/desktop-mobile/src-tauri/tauri.conf.json']
PLATFORMS = {'windows-x64': '.exe', 'macos-arm64': '.dmg', 'macos-x64': '.dmg'}


def validate(version):
    # Deliberately omit build metadata: installer versions and release tags must agree.
    if not re.fullmatch(r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?', version):
        raise ValueError('Use a version such as 1.2.3 or 1.2.3-beta.1, without v or build metadata')
    base, _, suffix = version.partition('-')
    if any(int(n) > 65535 for n in base.split('.')):
        raise ValueError('Version components must be <= 65535 for Windows')
    if any(part.isdigit() and len(part) > 1 and part.startswith('0') for part in suffix.split('.')):
        raise ValueError('Numeric prerelease identifiers cannot have leading zeros')
    return version


def replacements(root, version):
    validate(version)
    updates = {}
    cargo = (root / 'Cargo.toml').read_text(encoding="utf-8")
    cargo, count = re.subn(r'(\[workspace.package\]\s*\nversion\s*=\s*)"[^"]+"', lambda m: m[1] + json.dumps(version), cargo)
    if count != 1:
        raise ValueError('Workspace version missing')
    updates['Cargo.toml'] = cargo
    names = {'mozhi', 'mozhi-core', 'mozhi-windows'}
    found = set()
    blocks = (root / 'Cargo.lock').read_text(encoding="utf-8").split('[[package]]')
    for i, block in enumerate(blocks[1:], 1):
        match = re.search(r'^name = "([^"]+)"$', block, re.M)
        if match and match[1] in names and not re.search(r'^source = ', block, re.M):
            blocks[i], count = re.subn(r'^version = "[^"]+"$', 'version = ' + json.dumps(version), block, count=1, flags=re.M)
            if count != 1:
                raise ValueError('Local package version missing')
            found.add(match[1])
    if found != names:
        raise ValueError('Local lockfile packages missing')
    updates['Cargo.lock'] = '[[package]]'.join(blocks)
    for name in FILES[2:]:
        data = json.loads((root / name).read_text(encoding="utf-8"))
        data['version'] = version
        if name == 'package-lock.json':
            for key in ['', 'apps/desktop-mobile']:
                data['packages'][key]['version'] = version
        updates[name] = json.dumps(data, ensure_ascii=False, indent=2) + '\n'
    return updates


def collect(source, destination, version):
    validate(version)
    assets = []
    for platform, extension in PLATFORMS.items():
        files = list((source / ('desktop-' + platform)).rglob('*' + extension))
        if len(files) != 1 or files[0].stat().st_size == 0:
            raise ValueError(f'Expected exactly one nonempty {platform} installer, got {len(files)}')
        assets.append((files[0], f'MoZhi-{version}-{platform}{extension}'))
    if destination.exists() and any(destination.iterdir()):
        raise ValueError('Release asset directory must be empty')
    destination.mkdir(parents=True, exist_ok=True)
    hashes = []
    for source_file, name in assets:
        content = source_file.read_bytes()
        (destination / name).write_bytes(content)
        hashes.append(f'{hashlib.sha256(content).hexdigest()}  {name}\n')
    (destination / 'SHA256SUMS.txt').write_text(''.join(hashes), encoding='utf-8')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--version', required=True)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--collect', type=Path)
    parser.add_argument('--output', type=Path, default=Path('release-assets'))
    args = parser.parse_args()
    validate(args.version)
    if args.collect:
        collect(args.collect, args.output, args.version)
        return
    updates = replacements(ROOT, args.version)
    if subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True).strip():
        raise ValueError('Release preparation requires a clean working tree')
    if subprocess.check_output(['git', 'tag', '--list', 'v' + args.version], cwd=ROOT, text=True).strip():
        raise ValueError('Release tag already exists; use a new version or rerun failed jobs')
    if not args.check:
        for name, content in updates.items():
            (ROOT / name).write_text(content, encoding="utf-8")


if __name__ == '__main__':
    main()
