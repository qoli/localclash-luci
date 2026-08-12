#!/usr/bin/env python3
"""Prepare or verify the exact dnsqualify source pinned by LuCI."""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass


EXPECTED_REPOSITORY = "qoli/dnsqualify"
EXPECTED_CLONE_URL = "https://github.com/qoli/dnsqualify.git"
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")


@dataclass(frozen=True)
class SourceLock:
    repository: str
    clone_url: str
    commit: str


def fail(message: str) -> None:
    raise ValueError(message)


def load_lock(path: pathlib.Path) -> SourceLock:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"cannot read dnsqualify source lock {path}: {exc}")
    if not isinstance(document, dict):
        fail("dnsqualify source lock root must be an object")
    if document.get("schema_version") != 1:
        fail("dnsqualify source lock schema_version must be 1")
    if document.get("repository") != EXPECTED_REPOSITORY:
        fail(f"dnsqualify source lock repository must be {EXPECTED_REPOSITORY}")
    if document.get("clone_url") != EXPECTED_CLONE_URL:
        fail("dnsqualify source lock clone_url does not match its repository")
    commit = document.get("commit")
    if not isinstance(commit, str) or not COMMIT_RE.fullmatch(commit):
        fail("dnsqualify source lock commit must be a full lowercase Git SHA")
    return SourceLock(EXPECTED_REPOSITORY, EXPECTED_CLONE_URL, commit)


def run(command: list[str], *, cwd: pathlib.Path | None = None) -> None:
    try:
        subprocess.run(command, cwd=cwd, check=True)
    except (OSError, subprocess.CalledProcessError) as exc:
        fail(f"command failed: {' '.join(command)}: {exc}")


def output(command: list[str], *, cwd: pathlib.Path) -> str:
    try:
        result = subprocess.run(
            command,
            cwd=cwd,
            check=True,
            text=True,
            capture_output=True,
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        fail(f"command failed: {' '.join(command)}: {exc}")
    return result.stdout.strip()


def verify_checkout(destination: pathlib.Path, source: SourceLock) -> None:
    if not destination.is_dir():
        fail(f"missing prepared dnsqualify source: {destination}")
    actual_commit = output(["git", "rev-parse", "HEAD"], cwd=destination)
    if actual_commit != source.commit:
        fail(
            "prepared dnsqualify commit mismatch: "
            f"expected {source.commit}, got {actual_commit}"
        )
    actual_url = output(["git", "remote", "get-url", "origin"], cwd=destination)
    if actual_url != source.clone_url:
        fail(
            "prepared dnsqualify origin mismatch: "
            f"expected {source.clone_url}, got {actual_url}"
        )
    dirty = output(
        ["git", "status", "--porcelain", "--untracked-files=all"], cwd=destination
    )
    if dirty:
        fail("prepared dnsqualify source has uncommitted changes")


def prepare_checkout(destination: pathlib.Path, source: SourceLock) -> None:
    build_root = destination.parent
    if build_root.name != ".build" or destination.name != "dnsqualify-source":
        fail(f"unsafe dnsqualify source destination: {destination}")
    build_root.mkdir(parents=True, exist_ok=True)
    temporary = pathlib.Path(
        tempfile.mkdtemp(prefix=".dnsqualify-source-", dir=build_root)
    )
    try:
        run(["git", "init", "--quiet"], cwd=temporary)
        run(["git", "remote", "add", "origin", source.clone_url], cwd=temporary)
        run(
            ["git", "fetch", "--quiet", "--depth", "1", "origin", source.commit],
            cwd=temporary,
        )
        run(["git", "checkout", "--quiet", "--detach", "FETCH_HEAD"], cwd=temporary)
        verify_checkout(temporary, source)
        if destination.exists():
            shutil.rmtree(destination)
        temporary.replace(destination)
    except Exception:
        if temporary.exists():
            shutil.rmtree(temporary)
        raise


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--verify-only",
        action="store_true",
        help="verify the existing pinned checkout without fetching it",
    )
    args = parser.parse_args()
    repo_root = pathlib.Path(__file__).resolve().parent.parent
    lock_path = repo_root / "release" / "dnsqualify-source.json"
    destination = repo_root / ".build" / "dnsqualify-source"
    try:
        source = load_lock(lock_path)
        if args.verify_only:
            verify_checkout(destination, source)
        else:
            prepare_checkout(destination, source)
        json.dump(
            {
                "repository": source.repository,
                "clone_url": source.clone_url,
                "commit": source.commit,
                "source_dir": str(destination),
            },
            sys.stdout,
            sort_keys=True,
        )
        sys.stdout.write("\n")
    except ValueError as exc:
        print(f"prepare-dnsqualify-source: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
