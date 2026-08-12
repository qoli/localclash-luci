#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
	printf 'usage: scripts/build-release-assets.sh <release-tag>\n' >&2
	exit 2
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
release_tag="$1"
package_makefile="${repo_root}/openwrt/luci-app-localclash/Makefile"
pkg_name="$(awk -F':=' '/^PKG_NAME:=/ { print $2; exit }' "$package_makefile")"
pkg_version="$(awk -F':=' '/^PKG_VERSION:=/ { print $2; exit }' "$package_makefile")"
pkg_release="$(awk -F':=' '/^PKG_RELEASE:=/ { print $2; exit }' "$package_makefile")"
expected_tag="v${pkg_version}-${pkg_release}"
[ "$release_tag" = "$expected_tag" ] || {
	printf 'release tag %s does not match package metadata %s\n' "$release_tag" "$expected_tag" >&2
	exit 1
}

rm -rf "${repo_root}/dist" "${repo_root}/.build"
mkdir -p "${repo_root}/dist"

python3 "${repo_root}/scripts/prepare-dnsqualify-source.py"

"${repo_root}/scripts/build-openwrt-ipk.sh"
"${repo_root}/scripts/build-openwrt-apk.sh"
"${repo_root}/scripts/build-dnsqualify-assets.sh" "$release_tag"

ipk="${repo_root}/dist/${pkg_name}_${pkg_version}-${pkg_release}_all.ipk"
apk="${repo_root}/dist/${pkg_name}-${pkg_version}-r${pkg_release}.apk"
(
	cd "${repo_root}/dist"
	shasum -a 256 "$(basename "$ipk")" > "$(basename "$ipk").sha256"
	shasum -a 256 "$(basename "$apk")" > "$(basename "$apk").sha256"
)

"${repo_root}/scripts/build-istore-run.sh" "$release_tag" x86_64
"${repo_root}/scripts/build-istore-run.sh" "$release_tag" aarch64
"${repo_root}/scripts/verify-release-assets.sh" "$release_tag"
