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

fail_test() {
	printf 'test-hotplug-takeover-restore: %s\n' "$*" >&2
	exit 1
}

cat > "$helper" <<'EOF'
#!/bin/sh
case "$2" in
	takeover_trace)
		printf '%s\n' "$*" >> "$LOCALCLASH_TEST_TRACE"
		printf '{"ok":true,"recorded":true}\n'
		;;
	takeover_restore)
		printf '%s\n' "$*" >> "$LOCALCLASH_TEST_CALLS"
		printf '{"ok":true,"changed":false,"summary":"mock restore"}\n'
		exit "${LOCALCLASH_TEST_RESTORE_RC:-0}"
		;;
	*) exit 31 ;;
esac
EOF
chmod +x "$helper"

run_hook() {
	ACTION="$1" \
	INTERFACE="$2" \
	LOCALCLASH_HELPER="$helper" \
	LOCALCLASH_RESTORE_DELAY=1 \
	LOCALCLASH_RESTORE_HOTPLUG_STAMP="$stamp" \
	LOCALCLASH_TEST_CALLS="$calls" \
	LOCALCLASH_TEST_TRACE="$trace" \
	"$hook"
}

# The first worker must be superseded by the second event. Exactly one restore
# is allowed, and it must run only after the last event's quiet period.
run_hook ifup wan
sleep 0.1
run_hook ifupdate wan
sleep 2

[ -f "$calls" ] || fail_test "latest event did not trigger restore"
[ "$(wc -l < "$calls" | tr -d ' ')" = "1" ] || fail_test "superseded event also triggered restore"
[ "$(cat "$calls")" = "call takeover_restore" ] || fail_test "restore call = $(cat "$calls"), want call takeover_restore"
[ -s "$stamp" ] || fail_test "latest event token was not persisted"
grep -q 'call takeover_trace iface_hotplug scheduled' "$trace" || fail_test "hotplug schedule was not traced"
grep -q 'call takeover_trace iface_hotplug superseded' "$trace" || fail_test "superseded hotplug worker was not traced"
grep -q 'call takeover_trace iface_hotplug restore_finished.*result success.*exit_code 0' "$trace" || fail_test "successful hotplug restore was not traced"

: > "$calls"
: > "$trace"
ACTION=ifupdate \
INTERFACE=wan \
LOCALCLASH_HELPER="$helper" \
LOCALCLASH_RESTORE_DELAY=0 \
LOCALCLASH_RESTORE_HOTPLUG_STAMP="$stamp" \
LOCALCLASH_TEST_CALLS="$calls" \
LOCALCLASH_TEST_TRACE="$trace" \
LOCALCLASH_TEST_RESTORE_RC=37 \
"$hook"
sleep 1
grep -q 'call takeover_trace iface_hotplug restore_finished.*result failure.*exit_code 37' "$trace" || fail_test "failed hotplug restore was not traced with its exit code"

if ACTION=ifup INTERFACE=wan LOCALCLASH_HELPER="$helper" LOCALCLASH_RESTORE_DELAY=invalid LOCALCLASH_RESTORE_HOTPLUG_STAMP="${tmp_dir}/invalid.stamp" "$hook"; then
	fail_test "invalid restore delay should fail explicitly"
fi

printf '{"ok":true}\n'
