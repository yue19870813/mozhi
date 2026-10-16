import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from release import ROOT, FILES, PLATFORMS, collect, replacements, validate, workspace_manifests, workspace_package_names


class ReleaseTests(unittest.TestCase):
    def test_version_validation_rejects_shell_text_and_installer_incompatible_versions(self):
        for version in ['0.2.0', '1.2.3-beta.1', '1.2.3-rc.0']:
            self.assertEqual(validate(version), version)
        for version in ['v1.2.3', '1.2', '01.2.3', '1.2.3-01', '1.2.3+meta',
                        '1.2.3\n', '1.2.3;echo unsafe', '65536.0.0', '../1.2.3']:
            with self.subTest(version=version), self.assertRaises(ValueError):
                validate(version)

    def test_versions_update_all_manifests_without_modifying_dependency_pins(self):
        updates = replacements(ROOT, '0.9.1-beta.2')
        self.assertEqual(set(updates), set(FILES))
        self.assertIn('version = "0.9.1-beta.2"', updates['Cargo.toml'])
        old = (ROOT / 'Cargo.lock').read_text(encoding="utf-8").split('[[package]]')
        new = updates['Cargo.lock'].split('[[package]]')
        changed = [(a, b) for a, b in zip(old, new) if a != b]
        names = workspace_package_names(ROOT)
        self.assertEqual(len(changed), len(names))
        packages = updates['Cargo.lock'].split('[[package]]')[1:]
        for name in names:
            package = next(p for p in packages if f'name = "{name}"\n' in p and 'source = ' not in p)
            self.assertIn('version = "0.9.1-beta.2"', package)
        self.assertIn('mozhi-mcp', names)
        for a, b in changed:
            self.assertNotIn('source = ', b)
            self.assertIn('version = "0.9.1-beta.2"', b)
        for name in FILES[2:]:
            self.assertEqual(json.loads(updates[name])['version'], '0.9.1-beta.2')
        original = json.loads((ROOT / 'package-lock.json').read_text(encoding="utf-8"))
        updated = json.loads(updates['package-lock.json'])
        for key, value in original['packages'].items():
            if key not in ['', 'apps/desktop-mobile']:
                self.assertEqual(updated['packages'][key], value)
        self.assertEqual(updated['packages']['']['version'], '0.9.1-beta.2')
        self.assertEqual(updated['packages']['apps/desktop-mobile']['version'], '0.9.1-beta.2')

    def test_missing_workspace_package_fails_before_writing(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for name in FILES:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text((ROOT / name).read_text(encoding="utf-8"), encoding="utf-8")
            for manifest in workspace_manifests(ROOT):
                path = root / manifest.relative_to(ROOT)
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(manifest.read_text(encoding="utf-8"), encoding="utf-8")
            path = root / 'Cargo.lock'
            path.write_text(path.read_text(encoding="utf-8").replace('name = "mozhi-core"', 'name = "missing"'))
            before = (root / 'Cargo.toml').read_text(encoding="utf-8")
            with self.assertRaises(ValueError):
                replacements(root, '0.9.1')
            self.assertEqual((root / 'Cargo.toml').read_text(encoding="utf-8"), before)

    def test_assets_are_complete_unique_and_checksummed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for platform, extension in PLATFORMS.items():
                folder = root / 'artifacts' / ('desktop-' + platform) / 'bundle'
                folder.mkdir(parents=True)
                installer = folder / ('墨知' + extension)
                installer.write_bytes(platform.encode())
                updater_extension = {'windows-x64': '.exe', 'macos-arm64': '.app.tar.gz'}[platform]
                updater = installer if platform == 'windows-x64' else folder / ('墨知' + updater_extension)
                if updater != installer:
                    updater.write_bytes((platform + '-updater').encode())
                Path(str(updater) + '.sig').write_text('signature-' + platform, encoding='utf-8')
            output = root / 'output'
            collect(root / 'artifacts', output, '0.9.1')
            lines = (output / 'SHA256SUMS.txt').read_text(encoding="utf-8").splitlines()
            self.assertEqual(len(lines), 5)
            manifest = json.loads((output / 'latest.json').read_text(encoding='utf-8'))
            self.assertEqual(manifest['version'], '0.9.1')
            self.assertEqual(set(manifest['platforms']), {'windows-x86_64', 'darwin-aarch64'})
            self.assertTrue(manifest['platforms']['windows-x86_64']['url'].endswith('MoZhi-0.9.1-windows-x64.exe'))
            self.assertEqual(manifest['platforms']['windows-x86_64']['signature'], 'signature-windows-x64')
            self.assertEqual((output / 'MoZhi-0.9.1-windows-x64.exe.sig').read_text(encoding='utf-8').strip(), 'signature-windows-x64')
            for line in lines:
                digest, name = line.split('  ')
                self.assertEqual(hashlib.sha256((output / name).read_bytes()).hexdigest(), digest)
            with self.assertRaises(ValueError):
                collect(root / 'artifacts', output, '0.9.1')
            (root / 'artifacts/desktop-windows-x64/bundle/duplicate.exe').write_bytes(b'test')
            with self.assertRaises(ValueError):
                collect(root / 'artifacts', root / 'duplicate-output', '0.9.1')
            self.assertFalse((root / 'duplicate-output').exists())
            (root / 'artifacts/desktop-macos-arm64/bundle/墨知.dmg').unlink()
            with self.assertRaises(ValueError):
                collect(root / 'artifacts', root / 'missing-output', '0.9.1')

    def test_missing_updater_signature_fails_collection(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for platform, extension in PLATFORMS.items():
                folder = root / ('desktop-' + platform)
                folder.mkdir()
                installer = folder / ('app' + extension)
                installer.write_bytes(b'installer')
                updater_extension = {'windows-x64': '.exe', 'macos-arm64': '.app.tar.gz'}[platform]
                updater = installer if platform == 'windows-x64' else folder / ('app' + updater_extension)
                if updater != installer:
                    updater.write_bytes(b'updater')
                if platform != 'windows-x64':
                    Path(str(updater) + '.sig').write_text('signature', encoding='utf-8')
            with self.assertRaises(ValueError):
                collect(root, root / 'output', '0.9.1')
            self.assertFalse((root / 'output').exists())


if __name__ == '__main__':
    unittest.main()
