#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
helper="${repo_root}/openwrt/luci-app-localclash/root/usr/libexec/rpcd/localclash"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

mkdir -p "${tmp_dir}/bin" "${tmp_dir}/state"
PATH="${tmp_dir}/bin:${PATH}"

cat > "${tmp_dir}/bin/jsonfilter" <<'EOF'
#!/usr/bin/env python3
import json, sys

args = sys.argv[1:]
source = None
expression = None
while args:
    option = args.pop(0)
    if option == '-i':
        source = open(args.pop(0), encoding='utf-8').read()
    elif option == '-s':
        source = args.pop(0)
    elif option == '-e':
        expression = args.pop(0)
if source is None or expression is None or not expression.startswith('@.'):
    raise SystemExit(1)
values = [json.loads(source)]
for part in expression[2:].split('.'):
    wildcard = part.endswith('[*]')
    key = part[:-3] if wildcard else part
    selected = []
    for value in values:
        if not isinstance(value, dict) or key not in value:
            continue
        item = value[key]
        if wildcard:
            if isinstance(item, dict): selected.extend(item.values())
            elif isinstance(item, list): selected.extend(item)
        else:
            selected.append(item)
    values = selected
if not values:
    raise SystemExit(1)
for value in values:
    if isinstance(value, bool): print('true' if value else 'false')
    elif isinstance(value, (dict, list)):
        # OpenWrt jsonfilter prints whitespace inside an empty array.
        print('[ ]' if value == [] else json.dumps(value, ensure_ascii=False, separators=(',', ':')))
    elif value is not None: print(value)
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
MOCK_PRE_RUNNING=true
MOCK_SUPPORT_FAIL=0
MOCK_VERIFY_FAIL=0
MOCK_VERIFY_SHA=abc123
MOCK_VERIFY_FALSE=0
status_calls=0

reset_case() {
	mkdir -p "$LOCK_DIR"
	printf '%s\n' "$$" > "$LOCK_DIR/pid"
	: > "${tmp_dir}/trace"
	: > "$LOG"
	MOCK_SET_FAIL=0
	MOCK_REFRESH_FAIL=0
	MOCK_RENDER_FAIL=0
	MOCK_RESTART_FAIL=0
	MOCK_RUNTIME_RUNNING=true
	MOCK_PRE_RUNNING=true
	MOCK_SUPPORT_FAIL=0
	MOCK_VERIFY_FAIL=0
	MOCK_VERIFY_SHA=abc123
	MOCK_VERIFY_FALSE=0
	status_calls=0
	rm -f "${tmp_dir}/saved-input"
	printf '{"ok":true,"running":true,"done":false,"started_at":123,"task":"subscription_set","task_id":"save-123","cancellable":false,"summary":"saving"}\n' > "$TASK_STATUS"
}

call_core() {
	trace "call_core $*"
	case "$*" in
		"subscription verify-runtime --check-support --json")
			[ "$MOCK_SUPPORT_FAIL" -eq 0 ] || { printf '{"ok":false,"code":"unsupported_verification","message":"old core"}\n'; return 10; }
			printf '{"ok":true,"status":{"supported":true}}\n'
			;;
		"subscription verify-runtime --json")
			[ "$MOCK_VERIFY_FAIL" -eq 0 ] || { printf '{"ok":false,"code":"subscription_runtime_verification_failed","details":{"missing":["NewNode"],"unexpected":["OldNode"]}}\n'; return 15; }
			if [ "$MOCK_VERIFY_FALSE" -eq 1 ]; then
				printf '{"ok":true,"status":{"verified":false,"config_sha256":"abc123"},"warnings":[]}\n'
			else
				printf '{"ok":true,"status":{"verified":true,"config_sha256":"%s"},"warnings":[]}\n' "$MOCK_VERIFY_SHA"
			fi
			;;
		"subscription set --input $input --json")
			[ "$MOCK_SET_FAIL" -eq 0 ] || { printf '{"ok":false,"code":"set_failed"}\n'; return 11; }
			cp "$input" "${tmp_dir}/saved-input"
			printf '{"ok":true,"changed":true,"warnings":[]}\n'
			;;
		"subscription refresh --json")
			[ "$MOCK_REFRESH_FAIL" -eq 0 ] || { printf '{"ok":false,"code":"refresh_failed"}\n'; return 12; }
			printf '{"ok":true,"status":{"sources":[{"id":"source-a","status":"cached"},{"id":"source-b","status":"failed"}]},"warnings":["source-a used cache\\nHTTP 522","source-b was skipped"]}\n'
			;;
		"config render --json")
			[ "$MOCK_RENDER_FAIL" -eq 0 ] || { printf '{"ok":false,"code":"render_failed"}\n'; return 13; }
			printf '{"ok":true,"changed":true,"warnings":[]}\n'
			;;
		"runtime restart --strategy process_restart --json")
			grep -q '"cancellable":false' "$TASK_STATUS" || fail_test "restart began before task became noncancellable"
			[ "$MOCK_RESTART_FAIL" -eq 0 ] || { printf '{"ok":false,"code":"mock_restart_failed","message":"restart failed"}\n'; return 14; }
			printf '{"ok":true,"changed":true,"summary":"runtime restarted","warnings":["connections interrupted"],"status":{"config_validation":{"config_sha256":"abc123"}}}\n'
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
			printf '{"ok":true,"status":{"effective":false,"runtime_running":%s,"profile_mode":"normal"}}\n' "$MOCK_PRE_RUNNING"
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
printf '%s\n' "$result" | grep -q '运行时已重启并验证订阅节点' || fail_test "success summary omitted activation"
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
call_takeover status --json
call_core subscription verify-runtime --check-support --json
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
call_core subscription verify-runtime --json
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


assert_result() {
	printf '%s\n' "$result" | python3 -c "$1"
}

reset_case
capture_setup
assert_result 'import json,sys; r=json.load(sys.stdin); assert r["ok"] and not r["partial"]; assert all(r["stages"].values()); assert r["warnings"] == ["source-a used cache\nHTTP 522", "source-b was skipped", "connections interrupted"]; assert [s["status"] for s in r["sources"]] == ["cached", "failed"]'

# Reproduce iStoreOS tr without POSIX class expansion while keeping the real
# pipeline result checks: spaced empty arrays must not add empty comma items.
tr() {
	if [ "${1:-}" = -d ] && [ "${2:-}" = '[:space:]' ]; then
		cat
	else
		command tr "$@"
	fi
}
reset_case
capture_setup
unset -f tr
[ "$result_rc" -eq 0 ] || fail_test "BusyBox warning aggregation failed: $result"
assert_result 'import json,sys; r=json.load(sys.stdin); assert r["ok"] and all(r["stages"].values()); assert r["warnings"] == ["source-a used cache\nHTTP 522", "source-b was skipped", "connections interrupted"]'

reset_case
MOCK_PRE_RUNNING=false
capture_setup
[ "$result_rc" -ne 0 ] || fail_test "stopped preflight succeeded"
[ ! -f "${tmp_dir}/saved-input" ] || fail_test "stopped preflight saved input"
! grep -q 'call_core' "${tmp_dir}/trace" || fail_test "stopped preflight called Core"
assert_result 'import json,sys; r=json.load(sys.stdin); assert not r["changed"] and not r["partial"]; assert not any(r["stages"].values())'

reset_case
MOCK_SUPPORT_FAIL=1
capture_setup
[ "$result_rc" -ne 0 ] || fail_test "old Core was accepted"
[ ! -f "${tmp_dir}/saved-input" ] || fail_test "old Core was detected after saving"

reset_case
MOCK_REFRESH_FAIL=1
capture_setup
[ -f "${tmp_dir}/saved-input" ] || fail_test "refresh failure did not reflect saved input"
assert_result 'import json,sys; r=json.load(sys.stdin); assert r["partial"] and r["changed"]; assert r["phase"] == "refresh"; assert r["stages"]["sources_saved"]; assert not r["stages"]["config_rendered"]; assert r["details"]["cause"]["code"] == "refresh_failed"'

reset_case
MOCK_SET_FAIL=1
capture_setup
[ "$result_rc" -ne 0 ] || fail_test "set failure succeeded"
[ ! -f "${tmp_dir}/saved-input" ] || fail_test "set failure mutated saved input"
assert_result 'import json,sys; r=json.load(sys.stdin); assert not r["changed"] and not r["partial"]; assert r["phase"] == "set"'
! grep -q 'subscription refresh' "${tmp_dir}/trace" || fail_test "set failure continued to refresh"

reset_case
MOCK_PRE_RUNNING=null
capture_setup
[ "$result_rc" -ne 0 ] || fail_test "invalid preflight succeeded"
[ ! -f "${tmp_dir}/saved-input" ] || fail_test "invalid preflight saved input"
assert_result 'import json,sys; r=json.load(sys.stdin); assert r["code"] == "subscription_preflight_invalid"; assert not r["changed"]'

for verification_failure in missing_nodes different_config false_verified; do
	reset_case
	case "$verification_failure" in
		missing_nodes) MOCK_VERIFY_FAIL=1 ;;
		different_config) MOCK_VERIFY_SHA=other ;;
		false_verified) MOCK_VERIFY_FALSE=1 ;;
	esac
	capture_setup
	[ "$result_rc" -ne 0 ] || fail_test "invalid readback succeeded: $verification_failure"
	assert_result 'import json,sys; r=json.load(sys.stdin); assert not r["ok"] and r["partial"] and r["changed"]; assert r["phase"] == "verify"; assert r["stages"]["runtime_restart_completed"]; assert not r["stages"]["runtime_verified"]; assert r["warnings"]'
done

printf 'rpcd subscription setup restart chain tests passed\n'
