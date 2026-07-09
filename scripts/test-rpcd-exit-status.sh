#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
helper="${repo_root}/openwrt/luci-app-localclash/root/usr/libexec/rpcd/localclash"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

fail_test() {
	printf 'test-rpcd-exit-status: %s\n' "$*" >&2
	exit 1
}

set +e
result="$("${helper}" call method_that_does_not_exist)"
rc=$?
set -e

[ "$rc" -ne 0 ] || fail_test "unknown method returned a successful exit status"
printf '%s\n' "$result" | grep -q '"code":"unknown_method"' || fail_test "unknown method did not return the expected JSON error: $result"

"${helper}" list >/dev/null || fail_test "list method returned a failing exit status"

awk '/^method="\$\{1:-\}"/ { exit } { print }' "${helper}" > "${tmp_dir}/functions.sh"
# shellcheck disable=SC1090
. "${tmp_dir}/functions.sh"
LOCK_DIR="${tmp_dir}/helper.lock"
jsonfilter() {
	printf 'bogus\n'
}

set +e
result="$(printf '{"component":"bogus"}\n' | with_lock component_update)"
rc=$?
set -e
[ "$rc" -ne 0 ] || fail_test "invalid component returned a successful exit status"
printf '%s\n' "$result" | grep -q '"code":"invalid_component"' || fail_test "invalid component did not return the expected JSON error: $result"

printf 'rpcd exit status tests passed\n'
