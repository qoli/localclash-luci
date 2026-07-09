#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
helper="${repo_root}/openwrt/luci-app-localclash/root/usr/libexec/rpcd/localclash"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

awk '/^method="\$\{1:-\}"/ { exit } { print }' "${helper}" > "${tmp_dir}/functions.sh"
# shellcheck disable=SC1090
. "${tmp_dir}/functions.sh"

LOCK_DIR="${tmp_dir}/helper.lock"
LOG="${tmp_dir}/helper.log"
TRACE="${tmp_dir}/trace"
export TRACE

fail_test() {
	printf 'test-rpcd-luci-update-run: %s\n' "$*" >&2
	exit 1
}

for package_builder in "${repo_root}/scripts/build-openwrt-ipk.sh" "${repo_root}/scripts/build-openwrt-apk.sh"; do
	if grep -q 'service_start' "$package_builder"; then
		fail_test "package post-install must not own localclash-mcp restart: $package_builder"
	fi
done

jsonfilter() {
	local payload="" expr=""
	while [ "$#" -gt 0 ]; do
		case "$1" in
			-s) payload="$2"; shift 2 ;;
			-e) expr="$2"; shift 2 ;;
			*) shift ;;
		esac
	done
	[ "$expr" = '@.changed' ] || return 1
	if printf '%s\n' "$payload" | grep -q '"changed":true'; then
		printf 'true\n'
	elif printf '%s\n' "$payload" | grep -q '"changed":false'; then
		printf 'false\n'
	else
		return 1
	fi
}

luci_update() {
	printf 'luci_update\n' >> "$TRACE"
	printf '{"ok":true,"changed":%s,"summary":"LuCI updated"}\n' "${MOCK_LUCI_CHANGED:-true}"
}

core_installed() {
	[ "${MOCK_CORE_MISSING:-0}" != "1" ]
}

cat > "${tmp_dir}/new-helper" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >> "$TRACE"
if [ "${MOCK_SERVICE_FAIL:-0}" = "1" ]; then
	printf '{"ok":false,"code":"service_restart_failed","message":"restart failed","details":{},"next_actions":[]}\n'
	exit 1
fi
printf '{"ok":true,"service":{"running":true},"mcp":{"healthy":true}}\n'
EOF
chmod +x "${tmp_dir}/new-helper"
HELPER_SELF="${tmp_dir}/new-helper"

capture_luci_update_run() {
	set +e
	result="$(luci_update_run)"
	result_rc=$?
	set -e
}

: > "$TRACE"
result="$(luci_update_run)"
printf '%s\n' "$result" | grep -q '"changed":true' || fail_test "standalone LuCI update failed: $result"
printf 'luci_update\ncall service_start\n' > "${tmp_dir}/expected-trace"
diff -u "${tmp_dir}/expected-trace" "$TRACE" || fail_test "standalone LuCI update did not delegate restart to the new helper"
[ ! -e "$LOCK_DIR" ] || fail_test "successful standalone LuCI update did not clean its lock"

: > "$TRACE"
MOCK_LUCI_CHANGED=false
export MOCK_LUCI_CHANGED
result="$(luci_update_run)"
unset MOCK_LUCI_CHANGED
printf '%s\n' "$result" | grep -q '"changed":false' || fail_test "unchanged LuCI update failed: $result"
printf 'luci_update\n' > "${tmp_dir}/expected-trace"
diff -u "${tmp_dir}/expected-trace" "$TRACE" || fail_test "unchanged LuCI update restarted the service"

: > "$TRACE"
MOCK_CORE_MISSING=1
export MOCK_CORE_MISSING
result="$(luci_update_run)"
unset MOCK_CORE_MISSING
printf '%s\n' "$result" | grep -q '"changed":true' || fail_test "core-missing LuCI update failed: $result"
printf 'luci_update\n' > "${tmp_dir}/expected-trace"
diff -u "${tmp_dir}/expected-trace" "$TRACE" || fail_test "LuCI update tried to restart a missing core"

: > "$TRACE"
MOCK_SERVICE_FAIL=1
export MOCK_SERVICE_FAIL
capture_luci_update_run
unset MOCK_SERVICE_FAIL
[ "$result_rc" -ne 0 ] || fail_test "new helper service failure returned success"
printf '%s\n' "$result" | grep -q '"code":"service_restart_failed"' || fail_test "new helper service failure was not preserved: $result"
[ ! -e "$LOCK_DIR" ] || fail_test "failed standalone LuCI update did not clean its lock"

cat > "${tmp_dir}/invalid-helper" <<'EOF'
#!/bin/sh
if
EOF
chmod +x "${tmp_dir}/invalid-helper"
HELPER_SELF="${tmp_dir}/invalid-helper"
capture_luci_update_run
[ "$result_rc" -ne 0 ] || fail_test "invalid new helper returned success"
printf '%s\n' "$result" | grep -q '"code":"luci_update_helper_invalid"' || fail_test "invalid new helper was not explicit: $result"

printf 'rpcd LuCI update run tests passed\n'
