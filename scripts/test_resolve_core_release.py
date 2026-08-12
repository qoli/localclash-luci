#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import pathlib
import subprocess
import tempfile
import unittest


SCRIPT = pathlib.Path(__file__).with_name("resolve-core-release.py")


def manifest() -> dict:
    tag = "v1.2.3"
    base = f"https://github.com/qoli/localClash/releases/download/{tag}"
    return {
        "schema_version": 1,
        "name": "localclash",
        "version": tag,
        "assets": [
            {
                "os": "linux",
                "arch": "amd64",
                "filename": "localclash-linux-amd64",
                "url": f"{base}/localclash-linux-amd64",
                "sha256": "a" * 64,
                "size": 123,
                "install_path": "/usr/local/bin/localclash",
            },
            {
                "os": "linux",
                "arch": "arm64",
                "filename": "localclash-linux-arm64",
                "url": f"{base}/localclash-linux-arm64",
                "sha256": "b" * 64,
                "size": 456,
                "install_path": "/usr/local/bin/localclash",
            },
        ],
        "base_assets": {
            "filename": "localclash-base-assets.tar.gz",
            "url": f"{base}/localclash-base-assets.tar.gz",
            "sha256": "c" * 64,
            "size": 789,
            "install_path": "/root/localclash",
        },
    }


class ResolveCoreReleaseTests(unittest.TestCase):
    def run_resolver(self, mutate_lock=None, mutate_manifest=None):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            manifest_doc = manifest()
            if mutate_manifest:
                mutate_manifest(manifest_doc)
            manifest_path = root / "manifest.json"
            manifest_path.write_text(json.dumps(manifest_doc), encoding="utf-8")
            lock_doc = {
                "schema_version": 1,
                "repository": "qoli/localClash",
                "tag": "v1.2.3",
                "manifest_url": "https://github.com/qoli/localClash/releases/download/v1.2.3/localclash-release-manifest.json",
                "manifest_sha256": hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
            }
            if mutate_lock:
                mutate_lock(lock_doc)
            lock_path = root / "lock.json"
            lock_path.write_text(json.dumps(lock_doc), encoding="utf-8")
            return subprocess.run(
                [
                    str(SCRIPT),
                    "--lock",
                    str(lock_path),
                    "--manifest",
                    str(manifest_path),
                    "--arch",
                    "x86_64",
                ],
                check=False,
                text=True,
                capture_output=True,
            )

    def test_resolves_exact_pinned_asset(self):
        result = self.run_resolver()
        self.assertEqual(result.returncode, 0, result.stderr)
        resolved = json.loads(result.stdout)
        self.assertEqual(resolved["core_tag"], "v1.2.3")
        self.assertEqual(resolved["core"]["sha256"], "a" * 64)

    def test_rejects_manifest_checksum_mismatch(self):
        result = self.run_resolver(
            mutate_lock=lambda lock: lock.__setitem__("manifest_sha256", "0" * 64)
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("manifest SHA-256 mismatch", result.stderr)

    def test_rejects_latest_or_wrong_provenance_url(self):
        result = self.run_resolver(
            mutate_manifest=lambda doc: doc["assets"][0].__setitem__(
                "url",
                "https://github.com/qoli/localClash/releases/latest/download/localclash-linux-amd64",
            )
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("invalid linux/amd64 provenance", result.stderr)

    def test_rejects_missing_architecture(self):
        result = self.run_resolver(
            mutate_manifest=lambda doc: doc.__setitem__(
                "assets", [asset for asset in doc["assets"] if asset["arch"] != "amd64"]
            )
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("exactly one linux/amd64 asset", result.stderr)


if __name__ == "__main__":
    unittest.main()
