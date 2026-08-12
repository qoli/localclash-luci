#!/usr/bin/env python3
"""Validate the pinned localClash release and select one bundle architecture."""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import re
import sys


SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
TAG_RE = re.compile(r"^v[0-9]+\.[0-9]+\.[0-9]+$")
ARCHES = {"x86_64": "amd64", "aarch64": "arm64"}


def fail(message: str) -> None:
    raise ValueError(message)


def read_json(path: pathlib.Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"cannot read JSON {path}: {exc}")
    if not isinstance(value, dict):
        fail(f"JSON root must be an object: {path}")
    return value


def require_sha(value: object, field: str) -> str:
    if not isinstance(value, str) or not SHA256_RE.fullmatch(value):
        fail(f"{field} must be a lowercase SHA-256")
    return value


def require_size(value: object, field: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        fail(f"{field} must be a positive integer")
    return value


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--lock", required=True, type=pathlib.Path)
    parser.add_argument("--manifest", required=True, type=pathlib.Path)
    parser.add_argument("--arch", required=True, choices=sorted(ARCHES))
    args = parser.parse_args()

    try:
        lock = read_json(args.lock)
        manifest = read_json(args.manifest)
        if lock.get("schema_version") != 1:
            fail("core release lock schema_version must be 1")
        if lock.get("repository") != "qoli/localClash":
            fail("core release lock repository must be qoli/localClash")
        tag = lock.get("tag")
        if not isinstance(tag, str) or not TAG_RE.fullmatch(tag):
            fail("core release lock tag is invalid")
        expected_manifest_url = (
            f"https://github.com/qoli/localClash/releases/download/{tag}/"
            "localclash-release-manifest.json"
        )
        if lock.get("manifest_url") != expected_manifest_url:
            fail("core release lock manifest_url does not match its tag")
        expected_manifest_sha = require_sha(
            lock.get("manifest_sha256"), "core release lock manifest_sha256"
        )
        actual_manifest_sha = hashlib.sha256(args.manifest.read_bytes()).hexdigest()
        if actual_manifest_sha != expected_manifest_sha:
            fail(
                "core release manifest SHA-256 mismatch: "
                f"expected {expected_manifest_sha}, got {actual_manifest_sha}"
            )
        if manifest.get("schema_version") != 1:
            fail("core release manifest schema_version must be 1")
        if manifest.get("name") != "localclash":
            fail("core release manifest name must be localclash")
        if manifest.get("version") != tag:
            fail("core release manifest version does not match the lock tag")

        core_arch = ARCHES[args.arch]
        assets = manifest.get("assets")
        if not isinstance(assets, list):
            fail("core release manifest assets must be an array")
        matches = [
            item
            for item in assets
            if isinstance(item, dict)
            and item.get("os") == "linux"
            and item.get("arch") == core_arch
        ]
        if len(matches) != 1:
            fail(f"core release manifest must contain exactly one linux/{core_arch} asset")
        core = matches[0]
        core_filename = f"localclash-linux-{core_arch}"
        core_url = f"https://github.com/qoli/localClash/releases/download/{tag}/{core_filename}"
        if core.get("filename") != core_filename or core.get("url") != core_url:
            fail(f"core release manifest has invalid linux/{core_arch} provenance")
        if core.get("install_path") != "/usr/local/bin/localclash":
            fail("core release manifest has an unexpected core install_path")

        base = manifest.get("base_assets")
        if not isinstance(base, dict):
            fail("core release manifest base_assets must be an object")
        base_filename = "localclash-base-assets.tar.gz"
        base_url = f"https://github.com/qoli/localClash/releases/download/{tag}/{base_filename}"
        if base.get("filename") != base_filename or base.get("url") != base_url:
            fail("core release manifest has invalid base-assets provenance")
        if base.get("install_path") != "/root/localclash":
            fail("core release manifest has an unexpected base-assets install_path")

        result = {
            "core_tag": tag,
            "bundle_arch": args.arch,
            "core_arch": core_arch,
            "core": {
                "filename": core_filename,
                "url": core_url,
                "sha256": require_sha(core.get("sha256"), "core asset sha256"),
                "size": require_size(core.get("size"), "core asset size"),
            },
            "base_assets": {
                "filename": base_filename,
                "url": base_url,
                "sha256": require_sha(base.get("sha256"), "base-assets sha256"),
                "size": require_size(base.get("size"), "base-assets size"),
            },
        }
        json.dump(result, sys.stdout, indent=2, sort_keys=True)
        sys.stdout.write("\n")
    except (OSError, ValueError) as exc:
        print(f"resolve-core-release: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
