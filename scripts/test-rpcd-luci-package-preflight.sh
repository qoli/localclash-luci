#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
helper="${repo_root}/openwrt/luci-app-localclash/root/usr/libexec/rpcd/localclash"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

awk '/^method="\$\{1:-\}"/ { exit } { print }' "$helper" > "$tmp_dir/functions.sh"
# shellcheck disable=SC1090
. "$tmp_dir/functions.sh"

build_ipk() {
	local architecture="$1" output="$2" root
	root="$tmp_dir/build-$architecture"
	mkdir -p "$root/control" "$root/ipk"
	cat > "$root/control/control" <<EOF
Package: luci-app-localclash
Version: test
Architecture: $architecture
Description: package metadata preflight fixture
EOF
	tar -czf "$root/ipk/control.tar.gz" -C "$root/control" ./control
	printf '2.0\n' > "$root/ipk/debian-binary"
	tar -czf "$root/ipk/data.tar.gz" --files-from /dev/null
	tar -czf "$output" -C "$root/ipk" ./debian-binary ./data.tar.gz ./control.tar.gz
}

valid="$tmp_dir/valid.ipk"
invalid="$tmp_dir/invalid.ipk"
build_ipk all "$valid"
build_ipk arm64 "$invalid"

luci_update_validate_package opkg "$valid" "$tmp_dir/valid-control" > "$tmp_dir/valid.log" 2>&1 || {
	printf 'valid Architecture: all package was rejected\n' >&2
	exit 1
}

if luci_update_validate_package opkg "$invalid" "$tmp_dir/invalid-control" > "$tmp_dir/invalid.log" 2>&1; then
	printf 'incompatible Architecture: arm64 package passed preflight\n' >&2
	exit 1
fi
grep -q '仅接受 Architecture: all；已在调用 opkg 前拒绝' "$tmp_dir/invalid.log" || {
	printf 'incompatible package rejection was not explicit\n' >&2
	exit 1
}

printf 'rpcd LuCI package metadata preflight tests passed\n'
