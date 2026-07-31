#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
helper="${repo_root}/openwrt/luci-app-localclash/root/usr/libexec/rpcd/localclash"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

awk '/^method="\$\{1:-\}"/ { exit } { print }' "${helper}" > "${tmp_dir}/functions.sh"
# shellcheck disable=SC1090
. "${tmp_dir}/functions.sh"

LOG="${tmp_dir}/helper.log"
DNSQUALIFY="${tmp_dir}/installed/dnsqualify"
fixture_version="v0.1.0-41"
fixture_schema="1"
fixture_os="linux"
fixture_url="https://github.com/qoli/localclash-luci/releases/download/v0.1.0-41/dnsqualify-linux-arm64"
fixture_sha=""
download_source="${tmp_dir}/release-dnsqualify"

cat > "$download_source" <<'SH'
#!/bin/sh
if [ "${1:-}" = "--version" ]; then
	printf 'dnsqualify v0.1.0-41\n'
	exit 0
fi
exit 2
SH
chmod +x "$download_source"
fixture_sha="$(shasum -a 256 "$download_source" | awk '{print $1}')"

fail_test() {
	printf 'test-rpcd-dnsqualify-install: %s\n' "$*" >&2
	exit 1
}

jsonfilter() {
	local expression=""
	while [ "$#" -gt 0 ]; do
		case "$1" in
			-i) shift 2 ;;
			-e) expression="$2"; shift 2 ;;
			*) shift ;;
		esac
	done
	case "$expression" in
		'@.schema_version') printf '%s\n' "$fixture_schema" ;;
		'@.assets[@.arch="arm64"].os') printf '%s\n' "$fixture_os" ;;
		'@.assets[@.arch="arm64"].url') printf '%s\n' "$fixture_url" ;;
		'@.assets[@.arch="arm64"].sha256') printf '%s\n' "$fixture_sha" ;;
		'@.version') printf '%s\n' "$fixture_version" ;;
		*) return 1 ;;
	esac
}

router_arch() {
	printf 'arm64\n'
}

fetch_manifest() {
	printf '{"schema_version":1}\n' > "$2"
}

fetch_url_verified() {
	local output expected actual
	output="$2"
	expected="$3"
	actual="$(shasum -a 256 "$download_source" | awk '{print $1}')"
	[ "$actual" = "$expected" ] || return 1
	cp "$download_source" "$output"
}

result="$(dnsqualify_install)"
printf '%s\n' "$result" | grep -q '"changed":true' || fail_test "first install was not reported changed: $result"
[ -x "$DNSQUALIFY" ] || fail_test "installed binary is missing"
[ "$("$DNSQUALIFY" --version)" = "dnsqualify v0.1.0-41" ] || fail_test "installed binary version mismatch"

result="$(dnsqualify_install)"
printf '%s\n' "$result" | grep -q '"changed":false' || fail_test "equal checksum was not reported unchanged: $result"

before_sha="$(shasum -a 256 "$DNSQUALIFY" | awk '{print $1}')"
fixture_sha="$(printf '0%.0s' {1..64})"
set +e
result="$(dnsqualify_install)"
rc=$?
set -e
[ "$rc" -ne 0 ] || fail_test "checksum mismatch unexpectedly succeeded"
printf '%s\n' "$result" | grep -q '"code":"dnsqualify_download_failed"' || fail_test "checksum mismatch returned wrong error: $result"
after_sha="$(shasum -a 256 "$DNSQUALIFY" | awk '{print $1}')"
[ "$before_sha" = "$after_sha" ] || fail_test "failed update changed installed binary"

fixture_sha="$before_sha"
fixture_schema="2"
set +e
result="$(dnsqualify_install)"
rc=$?
set -e
[ "$rc" -ne 0 ] || fail_test "unsupported manifest schema unexpectedly succeeded"
printf '%s\n' "$result" | grep -q '"code":"dnsqualify_manifest_schema_unsupported"' || fail_test "unsupported manifest schema returned wrong error: $result"
fixture_schema="1"

router_arch() {
	return 1
}
set +e
result="$(dnsqualify_install)"
rc=$?
set -e
[ "$rc" -ne 0 ] || fail_test "unsupported architecture unexpectedly succeeded"
printf '%s\n' "$result" | grep -q '"code":"dnsqualify_unsupported_arch"' || fail_test "unsupported architecture returned wrong error: $result"

printf 'rpcd dnsqualify install tests passed\n'
