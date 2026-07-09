#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
helper="${repo_root}/openwrt/luci-app-localclash/root/usr/libexec/rpcd/localclash"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

awk '/^method="\$\{1:-\}"/ { exit } { print }' "${helper}" > "${tmp_dir}/functions.sh"
# shellcheck disable=SC1090
. "${tmp_dir}/functions.sh"

CORE="${tmp_dir}/localclash"
STATE_DIR="${tmp_dir}/state"
SERVICE="${tmp_dir}/init.d/localclash-mcp"
LOG="${tmp_dir}/helper.log"

fail_test() {
	printf 'test-rpcd-service-ensure: %s\n' "$*" >&2
	exit 1
}

capture_service_ensure() {
	set +e
	result="$(service_ensure 2>"${tmp_dir}/ensure.stderr")"
	result_rc=$?
	set -e
}

result="$(service_ensure)"
printf '%s\n' "$result" | grep -q '"ok":true' || fail_test "service ensure failed: $result"
[ -x "$SERVICE" ] || fail_test "service script was not installed executable"
sh -n "$SERVICE" || fail_test "generated service script has invalid shell syntax"
grep -q 'procd_open_instance mcp' "$SERVICE" || fail_test "generated service script is missing the mcp instance"
grep -q 'procd_open_instance boot_restore' "$SERVICE" || fail_test "generated service script is missing the boot_restore instance"
[ ! -e "$SERVICE.tmp.$$" ] || fail_test "service ensure left its temporary file behind"

blocked="${tmp_dir}/blocked"
printf 'not-a-directory\n' > "$blocked"
SERVICE="$blocked/localclash-mcp"
capture_service_ensure
[ "$result_rc" -ne 0 ] || fail_test "service directory failure returned success"
printf '%s\n' "$result" | grep -q '"code":"service_script_dir_failed"' || fail_test "service directory failure was not explicit: $result"

SERVICE="${tmp_dir}/service-directory"
mkdir -p "$SERVICE"
capture_service_ensure
[ "$result_rc" -ne 0 ] || fail_test "invalid service path type returned success"
printf '%s\n' "$result" | grep -q '"code":"service_script_path_invalid"' || fail_test "invalid service path type was not explicit: $result"
[ -d "$SERVICE" ] || fail_test "invalid service path was replaced"

printf 'rpcd service ensure tests passed\n'
