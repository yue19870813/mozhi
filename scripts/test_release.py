import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from release import ROOT, FILES, PLATFORMS, collect, replacements, validate


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
        self.assertEqual(len(changed), 3)
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
                (folder / ('墨知' + extension)).write_bytes(platform.encode())
            output = root / 'output'
            collect(root / 'artifacts', output, '0.9.1')
            lines = (output / 'SHA256SUMS.txt').read_text(encoding="utf-8").splitlines()
            self.assertEqual(len(lines), 3)
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


if __name__ == '__main__':
    unittest.main()
