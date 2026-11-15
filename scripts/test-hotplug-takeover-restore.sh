#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
hook="${repo_root}/openwrt/luci-app-localclash/root/etc/hotplug.d/iface/95-localclash-restore"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

calls="${tmp_dir}/calls"
trace="${tmp_dir}/trace"
helper="${tmp_dir}/helper"
stamp="${tmp_dir}/restore.stamp"
success_result='{"ok":true,"changed":false,"summary":"mock restore"}'

fail_test() {
	printf 'test-hotplug-takeover-restore: %s\n' "$*" >&2
	exit 1
}

cat > "$helper" <<'EOF'
#!/bin/sh
case "$2" in
	takeover_trace)
		printf '%s %s\n' "$LOCALCLASH_TAKEOVER_EVENT_ID" "$*" >> "$LOCALCLASH_TEST_TRACE"
		printf '{"ok":true,"recorded":true}\n'
		;;
	takeover_restore)
		printf '%s %s %s\n' "$LOCALCLASH_TAKEOVER_EVENT_ID" "$LOCALCLASH_TAKEOVER_RESTORE_SOURCE" "$*" >> "$LOCALCLASH_TEST_CALLS"
		printf '%s\n' "$LOCALCLASH_TEST_RESTORE_RESULT"
		exit "$LOCALCLASH_TEST_RESTORE_RC"
		;;
	*) exit 31 ;;
esac
EOF
chmod +x "$helper"

mkdir "${tmp_dir}/bin"
cat > "${tmp_dir}/bin/jsonfilter" <<'PY'
#!/usr/bin/env python3
import json
import sys

if sys.argv[1:] != ["-e", "@.code"]:
    sys.exit(1)
try:
    result = json.load(sys.stdin)
except ValueError:
    sys.exit(1)
if not isinstance(result, dict) or not isinstance(result.get("code"), str):
    sys.exit(1)
print(result["code"])
PY
chmod +x "${tmp_dir}/bin/jsonfilter"
export PATH="${tmp_dir}/bin:${PATH}"

run_hook() {
	ACTION="$1" \
	INTERFACE="$2" \
	LOCALCLASH_HELPER="$helper" \
	LOCALCLASH_RESTORE_DELAY="${3:-1}" \
	LOCALCLASH_RESTORE_HOTPLUG_STAMP="$stamp" \
	LOCALCLASH_TEST_CALLS="$calls" \
	LOCALCLASH_TEST_TRACE="$trace" \
	LOCALCLASH_TEST_RESTORE_RC="${4:-0}" \
	LOCALCLASH_TEST_RESTORE_RESULT="${5-$success_result}" \
	"$hook"
}

# The first worker must be superseded by the second event. Exactly one restore
# is allowed, and it must run only after the last event's quiet period.
run_hook ifup wan
sleep 0.1
run_hook ifupdate wan
sleep 2

[ -f "$calls" ] || fail_test "latest event did not trigger restore"
[ -s "$stamp" ] || fail_test "latest event token was not persisted"
token="$(cat "$stamp")"
[ "$(cat "$calls")" = "$token iface_hotplug call takeover_restore" ] || fail_test "expected one restore call with the latest event ID"
grep -q "^$token call takeover_trace iface_hotplug scheduled " "$trace" || fail_test "hotplug schedule was not traced"
grep -q 'call takeover_trace iface_hotplug superseded' "$trace" || fail_test "superseded hotplug worker was not traced"
grep -q "^$token call takeover_trace iface_hotplug restore_started " "$trace" || fail_test "restore start was not correlated with the latest event"
grep -q "^$token call takeover_trace iface_hotplug restore_finished .*result success exit_code 0$" "$trace" || fail_test "successful hotplug restore was not traced"

check_failure() {
	local restore_result="$1" rc="$2" stage="$3" code="$4" output token
	: > "$calls"
	: > "$trace"
	# Capturing output waits for the background worker to close its stdout.
	output="$(run_hook ifupdate wan_6 0 "$rc" "$restore_result" 2>&1)"
	[ -z "$output" ] || fail_test "failed restore wrote to hotplug output"
	token="$(cat "$stamp")"
	[ "$(cat "$calls")" = "$token iface_hotplug call takeover_restore" ] || fail_test "expected one failing restore with the latest event ID"
	grep -q "^$token call takeover_trace iface_hotplug scheduled .*interface wan_6 " "$trace" || fail_test "failed restore schedule was not traced"
	grep -q "^$token call takeover_trace iface_hotplug restore_started " "$trace" || fail_test "failed restore start was not traced"
	grep -q "^$token call takeover_trace iface_hotplug restore_finished .*token $token .*result failure exit_code $rc stage $stage core_code $code$" "$trace" ||
		fail_test "failed restore trace did not preserve exit code $rc, stage $stage and RPC code '$code': $(tail -n 1 "$trace")"
}

check_failure '{"ok":false,"code":"task_locked","message":"mock lock timeout","details":{"code":"ignored"}}' 1 task_lock task_locked
check_failure '{"ok":false,"code":"tmpdir_failed","message":"mock temp directory failure"}' 1 create_tmpdir tmpdir_failed
check_failure '{"ok":false,"code":"mock_restore_failed"}' 37 takeover_restore mock_restore_failed
check_failure '{"ok":false,"code":"task_locked"' 37 takeover_restore ''

if ACTION=ifup INTERFACE=wan LOCALCLASH_HELPER="$helper" LOCALCLASH_RESTORE_DELAY=invalid LOCALCLASH_RESTORE_HOTPLUG_STAMP="${tmp_dir}/invalid.stamp" "$hook"; then
	fail_test "invalid restore delay should fail explicitly"
fi

printf '{"ok":true}\n'
