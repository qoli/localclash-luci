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
UPDATE_CHECK_LOCK_BASE="${tmp_dir}/update-check"

fail_test() {
	printf 'test-rpcd-update-check-singleflight: %s\n' "$*" >&2
	exit 1
}

slow_check() {
	touch "${tmp_dir}/started"
	sleep 1
	ok '"changed":false,"summary":"done"'
}

with_update_check_lock core slow_check > "${tmp_dir}/first.json" &
first_pid=$!
for _ in $(seq 1 50); do
	[ -f "${tmp_dir}/started" ] && break
	sleep 0.02
done
[ -f "${tmp_dir}/started" ] || fail_test "first check did not start"

second="$(with_update_check_lock core slow_check || true)"
kill -0 "$first_pid" 2>/dev/null || fail_test "overlapping check waited for the first check"
printf '%s\n' "$second" | grep -q '"ok":false' || fail_test "overlapping check did not fail explicitly: ${second}"
printf '%s\n' "$second" | grep -q '"code":"core_update_check_in_progress"' || fail_test "overlapping check code mismatch: ${second}"

wait "$first_pid"
grep -q '"ok":true' "${tmp_dir}/first.json" || fail_test "first check did not complete"
[ ! -d "${UPDATE_CHECK_LOCK_BASE}.core" ] || fail_test "completed check leaked its lock"

mkdir "${UPDATE_CHECK_LOCK_BASE}.luci"
printf '99999999\n' > "${UPDATE_CHECK_LOCK_BASE}.luci/pid"
result="$(with_update_check_lock luci slow_check)"
printf '%s\n' "$result" | grep -q '"ok":true' || fail_test "stale lock was not recovered: ${result}"
[ ! -d "${UPDATE_CHECK_LOCK_BASE}.luci" ] || fail_test "stale-lock recovery leaked its lock"

printf 'rpcd update check single-flight tests passed\n'
