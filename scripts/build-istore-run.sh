#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
	printf 'usage: scripts/build-istore-run.sh <release-tag> <x86_64|aarch64>\n' >&2
	exit 2
fi

release_tag="$1"
bundle_arch="$2"
case "$bundle_arch" in
	x86_64|aarch64) ;;
	*) printf 'unsupported iStore bundle architecture: %s\n' "$bundle_arch" >&2; exit 2 ;;
esac

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
package_makefile="${repo_root}/openwrt/luci-app-localclash/Makefile"
core_lock="${repo_root}/release/core-release.json"
makeself_lock="${repo_root}/release/makeself-release.json"
dist_dir="${repo_root}/dist"
build_dir="${repo_root}/.build/istore/${bundle_arch}"
download_dir="${repo_root}/.build/downloads"

pkg_name="$(awk -F':=' '/^PKG_NAME:=/ { print $2; exit }' "$package_makefile")"
pkg_version="$(awk -F':=' '/^PKG_VERSION:=/ { print $2; exit }' "$package_makefile")"
pkg_release="$(awk -F':=' '/^PKG_RELEASE:=/ { print $2; exit }' "$package_makefile")"
expected_tag="v${pkg_version}-${pkg_release}"
[ "$release_tag" = "$expected_tag" ] || {
	printf 'release tag %s does not match package metadata %s\n' "$release_tag" "$expected_tag" >&2
	exit 1
}

for command_name in curl python3 shasum touch; do
	command -v "$command_name" >/dev/null 2>&1 || {
		printf 'required build command is missing: %s\n' "$command_name" >&2
		exit 1
	}
done

mkdir -p "$dist_dir" "$download_dir"
rm -rf "$build_dir"
mkdir -p "$build_dir/payload/bin" "$build_dir/payload/assets" "$build_dir/payload/packages"

manifest_url="$(python3 - "$core_lock" <<'PY'
import json, pathlib, sys
doc = json.loads(pathlib.Path(sys.argv[1]).read_text())
value = doc.get("manifest_url")
if not isinstance(value, str) or not value:
    raise SystemExit("core release lock manifest_url is missing")
print(value)
PY
)"
core_manifest="${download_dir}/localclash-release-manifest.json"
curl --fail --location --silent --show-error "$manifest_url" --output "$core_manifest"

resolved_json="${build_dir}/resolved-core.json"
python3 "${repo_root}/scripts/resolve-core-release.py" \
	--lock "$core_lock" \
	--manifest "$core_manifest" \
	--arch "$bundle_arch" > "$resolved_json"

json_field() {
	python3 - "$resolved_json" "$1" <<'PY'
import json, pathlib, sys
value = json.loads(pathlib.Path(sys.argv[1]).read_text())
for part in sys.argv[2].split("."):
    value = value[part]
print(value)
PY
}

download_verified() {
	local url="$1" expected_sha="$2" expected_size="$3" output="$4" actual_sha actual_size
	curl --fail --location --silent --show-error "$url" --output "$output"
	actual_sha="$(shasum -a 256 "$output" | awk '{print $1}')"
	[ "$actual_sha" = "$expected_sha" ] || {
		printf 'SHA-256 mismatch for %s: expected %s, got %s\n' "$output" "$expected_sha" "$actual_sha" >&2
		exit 1
	}
	actual_size="$(python3 - "$output" <<'PY'
import pathlib, sys
print(pathlib.Path(sys.argv[1]).stat().st_size)
PY
)"
	[ "$actual_size" = "$expected_size" ] || {
		printf 'size mismatch for %s: expected %s, got %s\n' "$output" "$expected_size" "$actual_size" >&2
		exit 1
	}
}

core_url="$(json_field core.url)"
core_sha="$(json_field core.sha256)"
core_size="$(json_field core.size)"
core_tag="$(json_field core_tag)"
base_url="$(json_field base_assets.url)"
base_sha="$(json_field base_assets.sha256)"
base_size="$(json_field base_assets.size)"

download_verified "$core_url" "$core_sha" "$core_size" "$build_dir/payload/bin/localclash"
download_verified "$base_url" "$base_sha" "$base_size" "$build_dir/payload/assets/localclash-base-assets.tar.gz"
chmod 755 "$build_dir/payload/bin/localclash"

python3 - "$build_dir/payload/assets/localclash-base-assets.tar.gz" <<'PY'
import pathlib
import sys
import tarfile

archive = pathlib.Path(sys.argv[1])
required = {
    "policy-templates/localclash-default.json",
    ".runtime/mihomo/Country.mmdb",
    ".runtime/mihomo/geoip.dat",
    ".runtime/mihomo/geosite.dat",
    ".runtime/mihomo/ASN.mmdb",
}
found = set()
rule_source_json_found = False
with tarfile.open(archive, "r:gz") as handle:
    for member in handle.getmembers():
        normalized = pathlib.PurePosixPath(member.name)
        if normalized.is_absolute() or ".." in normalized.parts:
            raise SystemExit(f"unsafe base-assets path: {member.name}")
        if not (member.isfile() or member.isdir()):
            raise SystemExit(f"unsupported base-assets entry type: {member.name}")
        name = normalized.as_posix().removeprefix("./")
        if name in required and member.isfile():
            found.add(name)
        if (
            member.isfile()
            and len(normalized.parts) == 2
            and normalized.parts[0] == "rule-sources"
            and normalized.suffix == ".json"
        ):
            rule_source_json_found = True
missing = sorted(required - found)
if missing:
    raise SystemExit(f"base-assets archive is incomplete: {', '.join(missing)}")
if not rule_source_json_found:
    raise SystemExit("base-assets archive is incomplete: rule-sources/*.json")
PY

case "$bundle_arch" in
	x86_64) dns_arch=amd64 ;;
	aarch64) dns_arch=arm64 ;;
esac
dns_name="dnsqualify-linux-${dns_arch}"
[ -s "$dist_dir/$dns_name" ] || {
	printf 'missing dnsqualify build input: %s\n' "$dist_dir/$dns_name" >&2
	exit 1
}
cp "$dist_dir/$dns_name" "$build_dir/payload/bin/dnsqualify"
chmod 755 "$build_dir/payload/bin/dnsqualify"

python3 - "$build_dir/payload/bin/localclash" "$build_dir/payload/bin/dnsqualify" "$bundle_arch" <<'PY'
import pathlib
import struct
import sys

expected = {"x86_64": 62, "aarch64": 183}[sys.argv[3]]
for value in sys.argv[1:3]:
    path = pathlib.Path(value)
    header = path.read_bytes()[:20]
    if len(header) < 20 or header[:4] != b"\x7fELF":
        raise SystemExit(f"bundle binary is not ELF: {path}")
    if header[4] != 2 or header[5] != 1:
        raise SystemExit(f"bundle binary is not 64-bit little-endian ELF: {path}")
    machine = struct.unpack_from("<H", header, 18)[0]
    if machine != expected:
        raise SystemExit(
            f"bundle binary architecture mismatch for {path}: expected e_machine {expected}, got {machine}"
        )
PY

ipk_name="${pkg_name}_${pkg_version}-${pkg_release}_all.ipk"
[ -s "$dist_dir/$ipk_name" ] || {
	printf 'missing LuCI IPK build input: %s\n' "$dist_dir/$ipk_name" >&2
	exit 1
}
cp "$dist_dir/$ipk_name" "$build_dir/payload/packages/$ipk_name"
cp "${repo_root}/packaging/istore/install.sh" "$build_dir/payload/install.sh"
chmod 755 "$build_dir/payload/install.sh"

cat > "$build_dir/payload/bundle.env" <<EOF
BUNDLE_SCHEMA_VERSION=1
BUNDLE_ARCH=${bundle_arch}
LUCI_VERSION=${release_tag}
CORE_VERSION=${core_tag}
LUCI_IPK=${ipk_name}
EOF

python3 - "$build_dir/payload" "$release_tag" "$core_tag" "$bundle_arch" "$ipk_name" <<'PY'
import hashlib
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
paths = [
    "assets/localclash-base-assets.tar.gz",
    "bin/dnsqualify",
    "bin/localclash",
    f"packages/{sys.argv[5]}",
]
assets = []
for name in paths:
    path = root / name
    assets.append({
        "path": name,
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "size": path.stat().st_size,
    })
doc = {
    "schema_version": 1,
    "luci_version": sys.argv[2],
    "core_version": sys.argv[3],
    "architecture": sys.argv[4],
    "offline": True,
    "assets": assets,
}
(root / "bundle-manifest.json").write_text(
    json.dumps(doc, indent=2, sort_keys=True) + "\n", encoding="utf-8"
)
PY

(
	cd "$build_dir/payload"
	shasum -a 256 \
		assets/localclash-base-assets.tar.gz \
		bin/dnsqualify \
		bin/localclash \
		bundle.env \
		bundle-manifest.json \
		install.sh \
		"packages/$ipk_name" > checksums.sha256
)

makeself_url="$(python3 - "$makeself_lock" <<'PY'
import json, pathlib, re, sys
doc = json.loads(pathlib.Path(sys.argv[1]).read_text())
if doc.get("schema_version") != 1:
    raise SystemExit("makeself lock schema_version must be 1")
if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", str(doc.get("version", ""))):
    raise SystemExit("makeself lock version is invalid")
url = doc.get("url")
expected = f"https://github.com/megastep/makeself/releases/download/release-{doc['version']}/makeself-{doc['version']}.run"
if url != expected:
    raise SystemExit("makeself lock URL does not match its version")
print(url)
PY
)"
makeself_version="$(python3 - "$makeself_lock" <<'PY'
import json, pathlib, sys
print(json.loads(pathlib.Path(sys.argv[1]).read_text())["version"])
PY
)"
makeself_sha="$(python3 - "$makeself_lock" <<'PY'
import json, pathlib, re, sys
value = json.loads(pathlib.Path(sys.argv[1]).read_text()).get("sha256")
if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value):
    raise SystemExit("makeself lock sha256 is invalid")
print(value)
PY
)"
makeself_run="${download_dir}/makeself-${makeself_version}.run"
curl --fail --location --silent --show-error "$makeself_url" --output "$makeself_run"
[ "$(shasum -a 256 "$makeself_run" | awk '{print $1}')" = "$makeself_sha" ] || {
	printf 'Makeself distribution SHA-256 mismatch\n' >&2
	exit 1
}
makeself_dir="${repo_root}/.build/makeself"
rm -rf "$makeself_dir"
mkdir -p "$makeself_dir"
sh "$makeself_run" --target "$makeself_dir" --noexec --noprogress >/dev/null
[ -x "$makeself_dir/makeself.sh" ] || {
	printf 'verified Makeself distribution did not contain makeself.sh\n' >&2
	exit 1
}

source_date_epoch="${SOURCE_DATE_EPOCH:-0}"
case "$source_date_epoch" in
	''|*[!0-9]*) printf 'SOURCE_DATE_EPOCH must be a non-negative integer\n' >&2; exit 1 ;;
esac
packaging_date="$(python3 - "$source_date_epoch" <<'PY'
import datetime, sys
print(datetime.datetime.fromtimestamp(int(sys.argv[1]), datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
PY
)"
python3 - "$build_dir/payload" "$source_date_epoch" <<'PY'
import os, pathlib, sys
root = pathlib.Path(sys.argv[1])
stamp = int(sys.argv[2])
for path in sorted(root.rglob("*"), reverse=True):
    os.utime(path, (stamp, stamp), follow_symlinks=False)
os.utime(root, (stamp, stamp), follow_symlinks=False)
PY

run_name="localclash-istore-${release_tag}-${bundle_arch}.run"
rm -f "$dist_dir/$run_name" "$dist_dir/$run_name.sha256"
"$makeself_dir/makeself.sh" \
	--gzip \
	--comp-extra "-n" \
	--sha256 \
	--nomd5 \
	--nocrc \
	--nox11 \
	--noprogress \
	--packaging-date "$packaging_date" \
	"$build_dir/payload" \
	"$dist_dir/$run_name" \
	"localClash iStore offline installer ${release_tag} (${bundle_arch})" \
	./install.sh >/dev/null
chmod 755 "$dist_dir/$run_name"
(
	cd "$dist_dir"
	shasum -a 256 "$run_name" > "$run_name.sha256"
)

printf 'Built iStore bundle: %s\n' "$dist_dir/$run_name"
