#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest


SCRIPT = pathlib.Path(__file__).with_name("prepare-dnsqualify-source.py")
SPEC = importlib.util.spec_from_file_location("prepare_dnsqualify_source", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def valid_lock() -> dict:
    return {
        "schema_version": 1,
        "repository": "qoli/dnsqualify",
        "clone_url": "https://github.com/qoli/dnsqualify.git",
        "commit": "a" * 40,
    }


class PrepareDNSQualifySourceTests(unittest.TestCase):
    def load(self, mutate=None):
        with tempfile.TemporaryDirectory() as tmp:
            path = pathlib.Path(tmp) / "lock.json"
            document = valid_lock()
            if mutate:
                mutate(document)
            path.write_text(json.dumps(document), encoding="utf-8")
            return MODULE.load_lock(path)

    def test_accepts_exact_repository_and_full_commit(self):
        source = self.load()
        self.assertEqual(source.repository, "qoli/dnsqualify")
        self.assertEqual(source.commit, "a" * 40)

    def test_rejects_wrong_repository(self):
        with self.assertRaisesRegex(ValueError, "repository must be"):
            self.load(lambda doc: doc.__setitem__("repository", "someone/dnsqualify"))

    def test_rejects_floating_ref(self):
        with self.assertRaisesRegex(ValueError, "full lowercase Git SHA"):
            self.load(lambda doc: doc.__setitem__("commit", "main"))

    def test_rejects_wrong_clone_url(self):
        with self.assertRaisesRegex(ValueError, "clone_url does not match"):
            self.load(
                lambda doc: doc.__setitem__(
                    "clone_url", "https://example.com/qoli/dnsqualify.git"
                )
            )

    def test_verify_rejects_missing_checkout(self):
        with tempfile.TemporaryDirectory() as tmp:
            missing = pathlib.Path(tmp) / "missing"
            source = MODULE.SourceLock(
                MODULE.EXPECTED_REPOSITORY, MODULE.EXPECTED_CLONE_URL, "a" * 40
            )
            with self.assertRaisesRegex(ValueError, "missing prepared"):
                MODULE.verify_checkout(missing, source)

    def test_verify_rejects_dirty_checkout(self):
        with tempfile.TemporaryDirectory() as tmp:
            checkout = pathlib.Path(tmp)
            subprocess.run(["git", "init", "--quiet"], cwd=checkout, check=True)
            subprocess.run(
                ["git", "config", "user.name", "dnsqualify test"],
                cwd=checkout,
                check=True,
            )
            subprocess.run(
                ["git", "config", "user.email", "test@example.invalid"],
                cwd=checkout,
                check=True,
            )
            (checkout / "tracked").write_text("source\n", encoding="utf-8")
            subprocess.run(["git", "add", "tracked"], cwd=checkout, check=True)
            subprocess.run(["git", "commit", "--quiet", "-m", "source"], cwd=checkout, check=True)
            commit = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=checkout,
                check=True,
                text=True,
                capture_output=True,
            ).stdout.strip()
            subprocess.run(
                ["git", "remote", "add", "origin", MODULE.EXPECTED_CLONE_URL],
                cwd=checkout,
                check=True,
            )
            source = MODULE.SourceLock(
                MODULE.EXPECTED_REPOSITORY, MODULE.EXPECTED_CLONE_URL, commit
            )
            MODULE.verify_checkout(checkout, source)
            (checkout / "untracked").write_text("dirty\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "uncommitted changes"):
                MODULE.verify_checkout(checkout, source)


if __name__ == "__main__":
    unittest.main()
