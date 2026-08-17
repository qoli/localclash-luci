#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
helper="${repo_root}/openwrt/luci-app-localclash/root/usr/libexec/rpcd/localclash"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

awk '/^method="\$\{1:-\}"/ { exit } { print }' "${helper}" > "${tmp_dir}/functions.sh"
# shellcheck disable=SC1090
. "${tmp_dir}/functions.sh"

PATH="${tmp_dir}/bin:${PATH}"
mkdir -p "${tmp_dir}/bin"
cat > "${tmp_dir}/bin/jsonfilter" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
file=""
expr=""
while [ "$#" -gt 0 ]; do
	case "$1" in
		-i) file="$2"; shift 2 ;;
		-e) expr="$2"; shift 2 ;;
		*) shift ;;
	esac
done
case "$expr" in
	@.status.effective)
		grep -q '"effective"[[:space:]]*:[[:space:]]*true' "$file" && printf 'true\n' || printf 'false\n'
		;;
	@.status.runtime_running)
		grep -q '"runtime_running"[[:space:]]*:[[:space:]]*true' "$file" && printf 'true\n' || printf 'false\n'
		;;
	@.status.running)
		grep -q '"running"[[:space:]]*:[[:space:]]*true' "$file" && printf 'true\n' || printf 'false\n'
		;;
	@.running)
		grep -q '"running"[[:space:]]*:[[:space:]]*true' "$file" && printf 'true\n' || printf 'false\n'
		;;
	@.status.profile_mode)
		sed -n 's/.*"profile_mode"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$file"
		;;
	@.started_at)
		sed -n 's/.*"started_at"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$file"
		;;
	@.task)
		sed -n 's/.*"task"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$file"
		;;
	@.code)
		sed -n 's/.*"code"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$file"
		;;
	@.message)
		sed -n 's/.*"message"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$file"
		;;
	@.ok)
		grep -q '"ok"[[:space:]]*:' "$file"
		;;
	*) exit 1 ;;
esac
EOF
chmod +x "${tmp_dir}/bin/jsonfilter"

STATE_DIR="${tmp_dir}/state"
LOG="${tmp_dir}/helper.log"
TAKEOVER_LOG="${tmp_dir}/state/logs/takeover-events.jsonl"
TAKEOVER_LOG_LOCK_DIR="${TAKEOVER_LOG}.lock"
BOOT_ID_FILE="${tmp_dir}/boot-id"
TAKEOVER_REPAIR_TICKET="${tmp_dir}/repair-ticket"
TAKEOVER_STATE_STATUS="${tmp_dir}/runtime-status"
BOOT_AUTO_RESTORE_FILE="${STATE_DIR}/boot-auto-restore-enabled"
LEGACY_TAKEOVER_INTENT_FILE="${STATE_DIR}/takeover-enabled"
LOCK_DIR="${tmp_dir}/lock"
TASK_STATUS="${tmp_dir}/task-status.json"
TASK_RESULT="${tmp_dir}/task-result.json"
TASK_PID="${tmp_dir}/task.pid"
PROC_UPTIME="${tmp_dir}/uptime"
mkdir -p "$STATE_DIR"
printf '999.00 0.00\n' > "$PROC_UPTIME"
printf 'test-boot-id\n' > "$BOOT_ID_FILE"

trace() {
	printf '%s\n' "$1" >> "${tmp_dir}/trace"
}

fail_test() {
	printf 'test-rpcd-takeover-restore: %s\n' "$*" >&2
	exit 1
}

core_installed() {
	return 0
}

sleep() {
	:
}

call_core() {
	trace "call_core $*"
	case "$*" in
		"runtime start --json")
			printf '{"ok":true,"changed":true,"summary":"runtime started"}\n'
			;;
		"runtime status --json")
			printf '{"status":{"running":true}}\n'
			;;
		"takeover status --json")
			if [ "${MOCK_TAKEOVER_STATUS_RC:-0}" -ne 0 ]; then
				printf '{"ok":false,"code":"mock_status_failed"}\n'
				return "$MOCK_TAKEOVER_STATUS_RC"
			fi
			printf '%s\n' "${MOCK_TAKEOVER_STATUS}"
			;;
		"takeover apply --json")
			if [ "${MOCK_TAKEOVER_APPLY_RC:-0}" -ne 0 ]; then
				printf '{"ok":false,"code":"mock_apply_failed"}\n'
				return "$MOCK_TAKEOVER_APPLY_RC"
			fi
			printf '{"ok":true,"changed":true,"summary":"applied"}\n'
			;;
		"takeover stop --json")
			if [ "${MOCK_TAKEOVER_STOP_RC:-0}" -ne 0 ]; then
				printf '{"ok":false,"code":"mock_stop_failed"}\n'
				return "$MOCK_TAKEOVER_STOP_RC"
			fi
			printf '{"ok":true,"changed":true,"summary":"stopped"}\n'
			;;
		*)
			printf '{"ok":false,"code":"unexpected_call","message":"%s"}\n' "$*"
			return 1
			;;
	esac
}

: > "${tmp_dir}/trace"
rm -f "$TAKEOVER_REPAIR_TICKET" "$TAKEOVER_STATE_STATUS" "$BOOT_AUTO_RESTORE_FILE" "$LEGACY_TAKEOVER_INTENT_FILE"
MOCK_TAKEOVER_STATUS='{"ok":true,"status":{"effective":false,"runtime_running":true,"profile_mode":"router"}}'
result="$(takeover_restore_run)"
printf '%s\n' "$result" | grep -q '"skipped":true' || fail_test "restore without intent should skip: ${result}"
if grep -q 'call_core' "${tmp_dir}/trace"; then
	fail_test "restore without intent should not call core"
fi

: > "${tmp_dir}/trace"
printf 'applied\n' > "$TAKEOVER_STATE_STATUS"
result="$(takeover_restore_run)"
printf '%s\n' "$result" | grep -q '"changed":true' || fail_test "restore should reapply takeover: ${result}"
grep -q '^call_core takeover status --json$' "${tmp_dir}/trace" || fail_test "restore did not inspect status"
grep -q '^call_core takeover apply --json$' "${tmp_dir}/trace" || fail_test "restore did not apply takeover"
grep -q '网络接管恢复：重新应用接管已验证生效' "$LOG" || fail_test "restore did not log verified takeover success"
grep -q '"event":"repair_apply_finished".*"result":"success"' "$TAKEOVER_LOG" || fail_test "restore success was not retained in takeover event log"
[ -f "$TAKEOVER_REPAIR_TICKET" ] || fail_test "restore should keep same-boot repair ticket after reapply"
[ ! -f "$LEGACY_TAKEOVER_INTENT_FILE" ] || fail_test "restore should not create legacy persistent takeover intent"

: > "${tmp_dir}/trace"
MOCK_TAKEOVER_STATUS='{"ok":true,"status":{"effective":true,"runtime_running":true,"profile_mode":"router"}}'
rm -f "$TAKEOVER_REPAIR_TICKET" "$LEGACY_TAKEOVER_INTENT_FILE"
printf 'applied\n' > "$TAKEOVER_STATE_STATUS"
result="$(takeover_restore_run)"
printf '%s\n' "$result" | grep -q '"changed":false' || fail_test "effective takeover should be unchanged: ${result}"
if grep -q '^call_core takeover apply --json$' "${tmp_dir}/trace"; then
	fail_test "effective takeover should not be applied again"
fi
[ -f "$TAKEOVER_REPAIR_TICKET" ] || fail_test "effective restore should keep same-boot repair ticket"
[ ! -f "$LEGACY_TAKEOVER_INTENT_FILE" ] || fail_test "effective restore should not create legacy persistent takeover intent"

MOCK_TAKEOVER_STATUS_RC=17
if result="$(takeover_restore_run)"; then
	fail_test "status failure should propagate a non-zero exit: ${result}"
else
	rc=$?
fi
[ "$rc" = "17" ] || fail_test "status failure exit = ${rc}, want 17"
grep -q '"event":"status_failed".*"exit_code":"17"' "$TAKEOVER_LOG" || fail_test "status failure was not retained in takeover event log"
MOCK_TAKEOVER_STATUS_RC=0

MOCK_TAKEOVER_APPLY_RC=23
if result="$(takeover_apply)"; then
	fail_test "manual apply failure should propagate a non-zero exit: ${result}"
else
	rc=$?
fi
[ "$rc" = "23" ] || fail_test "manual apply failure exit = ${rc}, want 23"
grep -q '"event":"apply_finished".*"result":"failure".*"exit_code":"23".*"core_code":"mock_apply_failed"' "$TAKEOVER_LOG" || fail_test "manual apply failure was not retained in takeover event log"
MOCK_TAKEOVER_APPLY_RC=0

MOCK_TAKEOVER_STOP_RC=29
if result="$(takeover_stop)"; then
	fail_test "manual stop failure should propagate a non-zero exit: ${result}"
else
	rc=$?
fi
[ "$rc" = "29" ] || fail_test "manual stop failure exit = ${rc}, want 29"
grep -q '"event":"stop_finished".*"result":"failure".*"exit_code":"29"' "$TAKEOVER_LOG" || fail_test "manual stop failure was not retained in takeover event log"
MOCK_TAKEOVER_STOP_RC=0

diagnostics="$(takeover_logs)"
printf '%s\n' "$diagnostics" | grep -q '"current_snapshot"' || fail_test "takeover diagnostics missing current snapshot"
printf '%s\n' "$diagnostics" | grep -q '"current_status"' || fail_test "takeover diagnostics missing current status"
printf '%s\n' "$diagnostics" | grep -q 'test-boot-id' || fail_test "takeover diagnostics missing boot id"
printf '%s\n' "$diagnostics" | python3 -c 'import json, sys; json.load(sys.stdin)' || fail_test "takeover diagnostics is not valid JSON"
python3 -c 'import json, sys; [json.loads(line) for line in open(sys.argv[1], encoding="utf-8") if line.strip()]' "$TAKEOVER_LOG" || fail_test "takeover event log is not valid JSONL"

result="$(takeover_stop)"
printf '%s\n' "$result" | grep -q '"ok":true' || fail_test "takeover_stop failed: ${result}"
[ ! -f "$TAKEOVER_REPAIR_TICKET" ] || fail_test "takeover_stop should clear same-boot repair ticket"
[ ! -f "$TAKEOVER_STATE_STATUS" ] || fail_test "takeover_stop should clear runtime takeover status"

result="$(boot_restore_enable)"
printf '%s\n' "$result" | grep -q '"enabled":true' || fail_test "boot restore enable failed: ${result}"
[ -f "$BOOT_AUTO_RESTORE_FILE" ] || fail_test "boot restore enable should persist boot policy"

: > "${tmp_dir}/trace"
rm -f "$TAKEOVER_REPAIR_TICKET"
MOCK_TAKEOVER_STATUS='{"ok":true,"status":{"effective":false,"runtime_running":true,"profile_mode":"router"}}'
result="$(boot_restore_run)"
printf '%s\n' "$result" | grep -q '"changed":true' || fail_test "boot restore run should start runtime and apply takeover: ${result}"
grep -q '^call_core runtime start --json$' "${tmp_dir}/trace" || fail_test "boot restore did not start runtime"
grep -q '^call_core runtime status --json$' "${tmp_dir}/trace" || fail_test "boot restore did not verify runtime"
grep -q '^call_core takeover apply --json$' "${tmp_dir}/trace" || fail_test "boot restore did not apply takeover"
[ -f "$TAKEOVER_REPAIR_TICKET" ] || fail_test "boot restore should create same-boot repair ticket after applying takeover"

BOOT_RESTORE_MAX_UPTIME=1
: > "${tmp_dir}/trace"
result="$(boot_restore_startup_run)"
printf '%s\n' "$result" | grep -q '"skipped":true' || fail_test "boot restore startup should skip outside boot window: ${result}"
if grep -q 'call_core' "${tmp_dir}/trace"; then
	fail_test "boot restore startup outside boot window should not call core"
fi

BOOT_RESTORE_MAX_UPTIME=0
: > "${tmp_dir}/trace"
result="$(boot_restore_startup_run)"
printf '%s\n' "$result" | grep -q '"changed":true' || fail_test "boot restore startup should run when uptime guard is disabled: ${result}"
grep -q '^call_core runtime start --json$' "${tmp_dir}/trace" || fail_test "boot restore startup did not start runtime when allowed"

printf '{"ok":true,"running":true,"done":false,"started_at":1,"task":"one_click_update","summary":"一键更新任务正在运行。"}\n' > "$TASK_STATUS"
rm -f "$TASK_PID" "$TASK_RESULT"
reconcile_task_status
grep -q '一键更新任务已中断' "$TASK_RESULT" || fail_test "stale one-click task message should name one-click update"
grep -q '点击一键更新重试' "$TASK_STATUS" || fail_test "stale one-click task action should name one-click retry"

result="$(boot_restore_disable)"
printf '%s\n' "$result" | grep -q '"enabled":false' || fail_test "boot restore disable failed: ${result}"
[ ! -f "$BOOT_AUTO_RESTORE_FILE" ] || fail_test "boot restore disable should clear boot policy"

saved_event_id="${LOCALCLASH_TAKEOVER_EVENT_ID:-}"
unset LOCALCLASH_TAKEOVER_EVENT_ID
takeover_event_scope
scoped_event_id="$LOCALCLASH_TAKEOVER_EVENT_ID"
takeover_log_event_safe test correlation_started
takeover_log_event_safe test correlation_finished
python3 - "$TAKEOVER_LOG" "$scoped_event_id" <<'PY' || fail_test "one operation did not retain a stable event id"
import json, sys
events = [json.loads(line) for line in open(sys.argv[1], encoding="utf-8") if line.strip()]
selected = [event for event in events if event.get("event", "").startswith("correlation_")]
assert len(selected) == 2
assert {event["event_id"] for event in selected} == {sys.argv[2]}
PY
if [ -n "$saved_event_id" ]; then
	LOCALCLASH_TAKEOVER_EVENT_ID="$saved_event_id"
	export LOCALCLASH_TAKEOVER_EVENT_ID
else
	unset LOCALCLASH_TAKEOVER_EVENT_ID
fi

printf 'escape:\033 backspace:\b quote:" slash:\\\n' > "${tmp_dir}/control.log"
file_lines_json "${tmp_dir}/control.log" | python3 -c 'import json, sys; json.load(sys.stdin)' || fail_test "control bytes produced invalid JSON"
LOCALCLASH_TAKEOVER_EVENT_ID=control-event takeover_log_event_safe test control_value message "$(printf 'escape:\033 backspace:\b')"
python3 -c 'import json, sys; [json.loads(line) for line in open(sys.argv[1], encoding="utf-8") if line.strip()]' "$TAKEOVER_LOG" || fail_test "control bytes produced invalid event JSONL"

redacted="$(printf '12:34:56 wan=192.168.8.1 wan6=2001:db8:1234::5/64 full6=2001:0db8:0000:0000:0000:ff00:0042:8329 mac=aa:bb:cc:dd:ee:ff url=https://example.test/path?token=secret\n' | redact_diagnostic_stream)"
printf '%s\n' "$redacted" | grep -q '<ipv4>' || fail_test "IPv4 address was not redacted"
printf '%s\n' "$redacted" | grep -q '<ipv6>' || fail_test "IPv6 address was not redacted"
printf '%s\n' "$redacted" | grep -q '<mac>' || fail_test "MAC address was not redacted"
printf '%s\n' "$redacted" | grep -q '<url>' || fail_test "URL was not redacted"
printf '%s\n' "$redacted" | grep -q 'secret' && fail_test "URL query leaked after redaction"
printf '%s\n' "$redacted" | grep -q '12:34:56' || fail_test "ordinary log timestamp was mistaken for IPv6"

MOCK_TAKEOVER_STATUS='not-json'
diagnostics="$(takeover_logs)"
printf '%s\n' "$diagnostics" | python3 -c '
import json, sys
report = json.load(sys.stdin)
assert report["complete"] is False
assert report["current_status_json_valid"] is False
assert report["current_status"] is None
assert report["current_status_output"] == ["not-json"]
' || fail_test "malformed Core status was not reported as incomplete diagnostics"
MOCK_TAKEOVER_STATUS='{"ok":true,"status":{"effective":false,"runtime_running":true,"profile_mode":"router"}}'

saved_max="$TAKEOVER_LOG_MAX_BYTES"
saved_keep="$TAKEOVER_LOG_KEEP_BYTES"
TAKEOVER_LOG_MAX_BYTES=768
TAKEOVER_LOG_KEEP_BYTES=384
for i in $(seq 1 8); do
	(
		unset -f sleep
		LOCALCLASH_TAKEOVER_EVENT_ID="concurrent-${i}"
		export LOCALCLASH_TAKEOVER_EVENT_ID
		takeover_log_event_safe test concurrent_rotate seq "$i"
	) &
done
wait
TAKEOVER_LOG_MAX_BYTES="$saved_max"
TAKEOVER_LOG_KEEP_BYTES="$saved_keep"
python3 -c 'import json, sys; [json.loads(line) for line in open(sys.argv[1], encoding="utf-8") if line.strip()]' "$TAKEOVER_LOG" || fail_test "concurrent rotation produced invalid JSONL"
[ ! -e "$TAKEOVER_LOG_LOCK_DIR" ] || fail_test "takeover log lock leaked after concurrent rotation"
if find "$(dirname "$TAKEOVER_LOG")" -maxdepth 1 \( -name 'takeover-events.jsonl.tail.*' -o -name 'takeover-events.jsonl.rotate.*' \) | grep -q .; then
	fail_test "takeover log rotation left temporary files"
fi

mkdir "$TAKEOVER_LOG_LOCK_DIR"
if result="$(takeover_trace test write_while_locked)"; then
	fail_test "takeover_trace should fail when the journal cannot be locked: ${result}"
else
	rc=$?
fi
[ "$rc" = "1" ] || fail_test "takeover_trace lock failure exit = ${rc}, want 1"
printf '%s\n' "$result" | grep -q '"ok":false' || fail_test "takeover_trace lock failure was not JSON failure: ${result}"
printf '%s\n' "$result" | grep -q '"code":"takeover_log_write_failed"' || fail_test "takeover_trace lock failure code missing: ${result}"
rmdir "$TAKEOVER_LOG_LOCK_DIR"

printf 'rpcd takeover restore tests passed\n'
