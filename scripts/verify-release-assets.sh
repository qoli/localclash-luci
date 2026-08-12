#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
	printf 'usage: scripts/verify-release-assets.sh <release-tag>\n' >&2
	exit 2
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
release_tag="$1"
package_makefile="${repo_root}/openwrt/luci-app-localclash/Makefile"
dist_dir="${repo_root}/dist"
pkg_name="$(awk -F':=' '/^PKG_NAME:=/ { print $2; exit }' "$package_makefile")"
pkg_version="$(awk -F':=' '/^PKG_VERSION:=/ { print $2; exit }' "$package_makefile")"
pkg_release="$(awk -F':=' '/^PKG_RELEASE:=/ { print $2; exit }' "$package_makefile")"
expected_tag="v${pkg_version}-${pkg_release}"
[ "$release_tag" = "$expected_tag" ] || {
	printf 'release tag %s does not match package metadata %s\n' "$release_tag" "$expected_tag" >&2
	exit 1
}

expected_assets="$(mktemp)"
actual_assets="$(mktemp)"
cleanup() { rm -f "$expected_assets" "$actual_assets"; }
trap cleanup EXIT HUP INT TERM

cat > "$expected_assets" <<EOF
dnsqualify-linux-amd64
dnsqualify-linux-amd64.sha256
dnsqualify-linux-arm64
dnsqualify-linux-arm64.sha256
dnsqualify-release-manifest.json
${pkg_name}-${pkg_version}-r${pkg_release}.apk
${pkg_name}-${pkg_version}-r${pkg_release}.apk.sha256
${pkg_name}_${pkg_version}-${pkg_release}_all.ipk
${pkg_name}_${pkg_version}-${pkg_release}_all.ipk.sha256
localclash-istore-${release_tag}-aarch64.run
localclash-istore-${release_tag}-aarch64.run.sha256
localclash-istore-${release_tag}-x86_64.run
localclash-istore-${release_tag}-x86_64.run.sha256
EOF
find "$dist_dir" -maxdepth 1 -type f -exec basename {} \; | LC_ALL=C sort > "$actual_assets"
LC_ALL=C sort -o "$expected_assets" "$expected_assets"
if ! diff -u "$expected_assets" "$actual_assets"; then
	printf 'release asset set does not match the exact allow-list\n' >&2
	exit 1
fi

python3 - \
	"$dist_dir/dnsqualify-release-manifest.json" \
	"$repo_root/release/dnsqualify-source.json" \
	"$release_tag" <<'PY'
import json
import pathlib
import sys

manifest = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
source_lock = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding="utf-8"))
release_tag = sys.argv[3]
if manifest.get("schema_version") != 1:
    raise SystemExit("dnsqualify release manifest schema_version must be 1")
if manifest.get("version") != release_tag:
    raise SystemExit("dnsqualify release manifest version does not match the release tag")
expected_source = {
    "repository": source_lock.get("repository"),
    "commit": source_lock.get("commit"),
}
if manifest.get("source") != expected_source:
    raise SystemExit("dnsqualify release manifest source does not match the pinned lock")
PY

(
	cd "$dist_dir"
	for checksum in *.sha256; do
		expected_name="${checksum%.sha256}"
		listed_name="$(awk 'NR == 1 { print $2 }' "$checksum")"
		[ "$listed_name" = "$expected_name" ] || {
			printf '%s must reference basename %s, got %s\n' "$checksum" "$expected_name" "$listed_name" >&2
			exit 1
		}
		shasum -a 256 -c "$checksum"
	done
)

for bundle_arch in x86_64 aarch64; do
	run_file="$dist_dir/localclash-istore-${release_tag}-${bundle_arch}.run"
	ipk_path="./packages/${pkg_name}_${pkg_version}-${pkg_release}_all.ipk"
	sh "$run_file" --info >/dev/null
	sh "$run_file" --check >/dev/null
	listing="$(sh "$run_file" --list)"
	for required_path in \
		./install.sh \
		./bundle.env \
		./bundle-manifest.json \
		./checksums.sha256 \
		./bin/localclash \
		./bin/dnsqualify \
		./assets/localclash-base-assets.tar.gz \
		"$ipk_path"; do
		printf '%s\n' "$listing" | grep -F "$required_path" >/dev/null || {
			printf '%s is missing required payload path %s\n' "$run_file" "$required_path" >&2
			exit 1
		}
	done
	sh "$run_file" --noexec --noprogress >/dev/null
done

printf 'Verified exact release asset set for %s\n' "$release_tag"
