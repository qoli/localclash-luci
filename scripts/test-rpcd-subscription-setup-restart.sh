#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
helper="${repo_root}/openwrt/luci-app-localclash/root/usr/libexec/rpcd/localclash"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

mkdir -p "${tmp_dir}/bin" "${tmp_dir}/state"
PATH="${tmp_dir}/bin:${PATH}"

cat > "${tmp_dir}/bin/jsonfilter" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
input=""
expr=""
while [ "$#" -gt 0 ]; do
	case "$1" in
		-i) input="$2"; shift 2 ;;
		-e) expr="$2"; shift 2 ;;
		*) shift ;;
	esac
done
content="$(cat "$input")"
json_bool() {
	local field="$1"
	if printf '%s\n' "$content" | grep -q "\"${field}\"[[:space:]]*:[[:space:]]*true"; then
		printf 'true\n'
	elif printf '%s\n' "$content" | grep -q "\"${field}\"[[:space:]]*:[[:space:]]*false"; then
		printf 'false\n'
	else
		exit 1
	fi
}
case "$expr" in
	@.ok) json_bool ok ;;
	@.running) json_bool running ;;
	@.cancellable) json_bool cancellable ;;
	@.started_at)
		printf '%s\n' "$content" | sed -n 's/.*"started_at"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p'
		;;
	@.task)
		printf '%s\n' "$content" | sed -n 's/.*"task"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p'
		;;
	@.status.effective) json_bool effective ;;
	@.status.runtime_running) json_bool runtime_running ;;
	@.status.running) json_bool running ;;
	@.status.profile_mode)
		printf '%s\n' "$content" | sed -n 's/.*"profile_mode"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p'
		;;
	@.code)
		printf '%s\n' "$content" | sed -n 's/.*"code"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p'
		;;
	@.message)
		printf '%s\n' "$content" | sed -n 's/.*"message"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p'
		;;
	*) exit 1 ;;
esac
EOF
chmod +x "${tmp_dir}/bin/jsonfilter"

awk '/^method="\$\{1:-\}"/ { exit } { print }' "$helper" > "${tmp_dir}/functions.sh"
# shellcheck disable=SC1090
. "${tmp_dir}/functions.sh"

LOG="${tmp_dir}/helper.log"
STATE_DIR="${tmp_dir}/state"
TAKEOVER_LOG="${tmp_dir}/takeover-events.jsonl"
TAKEOVER_LOG_LOCK_DIR="${tmp_dir}/takeover-events.lock"
TAKEOVER_STATE_STATUS="${tmp_dir}/takeover/status"
TASK_STATUS="${tmp_dir}/task-status.json"
TASK_RESULT="${tmp_dir}/task-result.json"
TASK_INPUT="${tmp_dir}/task-input.json"
TASK_PID="${tmp_dir}/task.pid"
LOCK_DIR="${tmp_dir}/helper.lock"
input="${tmp_dir}/subscriptions.json"
printf '{"version":1,"uris":["https://example.com/sub"]}\n' > "$input"

fail_test() {
	printf 'test-rpcd-subscription-setup-restart: %s\n' "$*" >&2
	exit 1
}

trace() {
	printf '%s\n' "$1" >> "${tmp_dir}/trace"
}

run_with_heartbeat() {
	local label="$1" output="$2"
	shift 2
	trace "heartbeat $label"
	"$@" > "$output"
}

run_with_heartbeat_until_complete() {
	run_with_heartbeat "$@"
}

takeover_event_scope() { :; }
takeover_log_event_safe() { :; }

MOCK_SET_FAIL=0
MOCK_REFRESH_FAIL=0
MOCK_RENDER_FAIL=0
MOCK_RESTART_FAIL=0
MOCK_RUNTIME_RUNNING=true
status_calls=0

reset_case() {
	: > "${tmp_dir}/trace"
	: > "$LOG"
	MOCK_SET_FAIL=0
	MOCK_REFRESH_FAIL=0
	MOCK_RENDER_FAIL=0
	MOCK_RESTART_FAIL=0
	MOCK_RUNTIME_RUNNING=true
	status_calls=0
	printf '{"ok":true,"running":true,"done":false,"started_at":123,"task":"subscription_set","summary":"saving"}\n' > "$TASK_STATUS"
}

call_core() {
	trace "call_core $*"
	case "$*" in
		"subscription set --input $input --json")
			[ "$MOCK_SET_FAIL" -eq 0 ] || { printf '{"ok":false,"code":"set_failed"}\n'; return 11; }
			printf '{"ok":true,"changed":true}\n'
			;;
		"subscription refresh --json")
			[ "$MOCK_REFRESH_FAIL" -eq 0 ] || { printf '{"ok":false,"code":"refresh_failed"}\n'; return 12; }
			printf '{"ok":true,"refreshed":true}\n'
			;;
		"config render --json")
			[ "$MOCK_RENDER_FAIL" -eq 0 ] || { printf '{"ok":false,"code":"render_failed"}\n'; return 13; }
			printf '{"ok":true,"changed":true}\n'
			;;
		"runtime restart --strategy process_restart --json")
			grep -q '"cancellable":false' "$TASK_STATUS" || fail_test "restart began before task became noncancellable"
			[ "$MOCK_RESTART_FAIL" -eq 0 ] || { printf '{"ok":false,"code":"mock_restart_failed","message":"restart failed"}\n'; return 14; }
			printf '{"ok":true,"changed":true,"summary":"runtime restarted"}\n'
			;;
		"runtime status --json")
			printf '{"ok":true,"status":{"running":%s}}\n' "$MOCK_RUNTIME_RUNNING"
			;;
		*)
			printf '{"ok":false,"code":"unexpected_call","message":"%s"}\n' "$*"
			return 99
			;;
	esac
}

call_takeover() {
	trace "call_takeover $*"
	case "$*" in
		"status --json")
			status_calls=$((status_calls + 1))
			printf '{"ok":true,"status":{"effective":false,"runtime_running":true,"profile_mode":"normal"}}\n'
			;;
		*) return 99 ;;
	esac
}

capture_setup() {
	set +e
	result="$(subscription_setup_file "$input")"
	result_rc=$?
	set -e
}

reset_case
capture_setup
[ "$result_rc" -eq 0 ] || fail_test "successful chain failed: $result"
printf '%s\n' "$result" | python3 -m json.tool >/dev/null || fail_test "success result is not JSON"
printf '%s\n' "$result" | grep -q '"runtime_restart"' || fail_test "success omitted restart result"
printf '%s\n' "$result" | grep -q '运行时已重启并验证生效' || fail_test "success summary omitted activation"
write_task_done 0 "$result"
grep -q '"cancellable":false' "$TASK_STATUS" || fail_test "terminal subscription status lost noncancellable policy"
mkdir -p "$LOCK_DIR"
printf '%s\n' "$$" > "$LOCK_DIR/pid"
set +e
terminal_cancel_result="$(task_cancel)"
terminal_cancel_rc=$?
set -e
[ "$terminal_cancel_rc" -eq 0 ] || fail_test "terminal noncancellable task did not return its existing result"
printf '%s\n' "$terminal_cancel_result" | grep -q '"exit_code":0' || fail_test "terminal result was replaced during lock cleanup: $terminal_cancel_result"
printf '%s\n' "$terminal_cancel_result" | grep -q 'task_cancelled' && fail_test "terminal result was overwritten by cancellation"
rm -rf "$LOCK_DIR"
cat > "${tmp_dir}/expected-success" <<EOF
call_core subscription set --input $input --json
heartbeat 订阅设置：正在刷新订阅
call_core subscription refresh --json
heartbeat 订阅设置：正在生成 Mihomo 配置
call_core config render --json
heartbeat 订阅设置：正在重启运行时并验证订阅生效
call_takeover status --json
call_core runtime restart --strategy process_restart --json
call_core runtime status --json
call_takeover status --json
EOF
diff -u "${tmp_dir}/expected-success" "${tmp_dir}/trace" || fail_test "successful call order mismatch"

reset_case
MOCK_REFRESH_FAIL=1
capture_setup
[ "$result_rc" -ne 0 ] || fail_test "refresh failure returned success"
grep -q 'refresh_failed' <<< "$result" || fail_test "refresh cause was lost: $result"
grep -q 'runtime restart' "${tmp_dir}/trace" && fail_test "restart ran after refresh failure"

reset_case
MOCK_RENDER_FAIL=1
capture_setup
[ "$result_rc" -ne 0 ] || fail_test "render failure returned success"
grep -q 'render_failed' <<< "$result" || fail_test "render cause was lost: $result"
grep -q 'runtime restart' "${tmp_dir}/trace" && fail_test "restart ran after render failure"

reset_case
MOCK_RESTART_FAIL=1
capture_setup
[ "$result_rc" -ne 0 ] || fail_test "restart failure returned success"
printf '%s\n' "$result" | grep -q '"code":"runtime_restart_failed"' || fail_test "restart cause was not wrapped explicitly: $result"
printf '%s\n' "$result" | grep -q '"partial":true' || fail_test "restart failure omitted partial state: $result"

reset_case
MOCK_RUNTIME_RUNNING=false
capture_setup
[ "$result_rc" -ne 0 ] || fail_test "stopped post-restart runtime returned success"
printf '%s\n' "$result" | grep -q '"code":"runtime_not_running_after_restart"' || fail_test "postflight failure was not explicit: $result"

reset_case
mkdir -p "$LOCK_DIR"
printf '%s\n' "$$" > "$LOCK_DIR/pid"
write_task_noncancellable "restart phase"
set +e
cancel_result="$(task_cancel)"
cancel_rc=$?
set -e
[ "$cancel_rc" -ne 0 ] || fail_test "noncancellable subscription restart phase accepted cancellation"
printf '%s\n' "$cancel_result" | grep -q '"code":"task_not_cancellable"' || fail_test "cancellation rejection code missing: $cancel_result"
rm -rf "$LOCK_DIR"

printf 'rpcd subscription setup restart chain tests passed\n'
