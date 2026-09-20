#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
helper="${repo_root}/openwrt/luci-app-localclash/root/usr/libexec/rpcd/localclash"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

mkdir -p "${tmp_dir}/bin"
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
    elif isinstance(value, (dict, list)): print(json.dumps(value, ensure_ascii=False, separators=(',', ':')))
    elif value is not None: print(value)
EOF
chmod +x "${tmp_dir}/bin/jsonfilter"

awk '/^method="\$\{1:-\}"/ { exit } { print }' "$helper" > "${tmp_dir}/functions.sh"
# shellcheck disable=SC1090
. "${tmp_dir}/functions.sh"

LOG="${tmp_dir}/helper.log"
LOCK_DIR="${tmp_dir}/helper.lock"
TASK_STATUS="${tmp_dir}/task-status.json"
TASK_RESULT="${tmp_dir}/task-result.json"
TASK_INPUT="${tmp_dir}/task-input.json"
TASK_PID="${tmp_dir}/task.pid"
SUBSCRIPTION_SCHEDULE_STATUS="${tmp_dir}/schedule-status.json"
SUBSCRIPTION_SCHEDULE_RUNTIME="${tmp_dir}/schedule-runtime.json"

fail_test() {
	printf 'test-rpcd-subscription-schedule: %s\n' "$*" >&2
	exit 1
}

run_with_heartbeat_until_complete() {
	local label="$1" output="$2"
	shift 2
	printf '%s\n' "$label" >> "${tmp_dir}/heartbeat"
	"$@" > "$output"
}

MOCK_RUNNING=true
MOCK_REFRESH_READY=true
MOCK_RESTART_FAIL=false
MOCK_RESTART_ERROR=""
MOCK_NODE_CHANGE=true
runtime_status_calls=0

reset_case() {
	rm -rf "$LOCK_DIR"
	rm -f "$SUBSCRIPTION_SCHEDULE_STATUS" "$SUBSCRIPTION_SCHEDULE_RUNTIME" "${tmp_dir}/calls" "${tmp_dir}/heartbeat"
	MOCK_RUNNING=true
	MOCK_REFRESH_READY=true
	MOCK_RESTART_FAIL=false
	MOCK_RESTART_ERROR=""
	MOCK_NODE_CHANGE=true
	runtime_status_calls=0
}

rpc_response() {
	printf '{"jsonrpc":"2.0","id":1,"result":{"content":[],"structuredContent":%s}}\n' "$1"
}

mcp_tool_call() {
	local tool="$1" arguments="$2" output="$3"
	printf '%s %s\n' "$tool" "$arguments" >> "${tmp_dir}/calls"
	case "$tool" in
		runtime_status)
			runtime_status_calls=$((runtime_status_calls + 1))
			rpc_response '{"running":'"$MOCK_RUNNING"',"pid":4242}' > "$output"
			;;
	subscriptions_refresh)
			if [ "$MOCK_NODE_CHANGE" = true ]; then
				node_diff='{"added":["Node A"],"removed":["Node Old"]}'
			else
				node_diff='{"added":[],"removed":[]}'
			fi
			rpc_response '{"node_diff":'"$node_diff"',"localclash_config":{"state":"auto_applied","hot_reload_ready":'"$MOCK_REFRESH_READY"',"proxy_groups":[{"id":"Auto"}]}}' > "$output"
			;;
		runtime_facts)
			rpc_response '{"config_sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}' > "$output"
			;;
		restart_runtime)
			if [ "$MOCK_RESTART_FAIL" = true ]; then
				printf '{"jsonrpc":"2.0","id":1,"error":{"message":"reload timeout"}}\n' > "$output"
				return 1
			fi
			rpc_response '{"reloaded":true,"applied_strategy":"hot_reload","config_sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","error":"'"$MOCK_RESTART_ERROR"'"}' > "$output"
			;;
	mihomo_api_request)
			rpc_response '{"status_code":200,"json":{"proxies":{"DIRECT":{"name":"DIRECT"},"Auto":{"name":"Auto"},"Node A":{"name":"Node A"}}}}' > "$output"
			;;
		*) fail_test "unexpected MCP tool: $tool" ;;
	esac
}

call_takeover() {
	[ "$*" = "status --json" ] || fail_test "unexpected takeover call: $*"
	printf '{"ok":true,"status":{"effective":true,"runtime_running":true,"profile_mode":"router"}}\n'
}

printf '{"jsonrpc":"2.0","error":{"message":"failed vless://user-secret@example.test:443/path"}}\n' > "${tmp_dir}/secret-error.json"
sanitized_error="$(subscription_schedule_mcp_error "${tmp_dir}/secret-error.json")"
printf '%s\n' "$sanitized_error" | grep -q '<uri>' || fail_test "subscription URI was not redacted from persisted error text"
printf '%s\n' "$sanitized_error" | grep -q 'user-secret' && fail_test "subscription credential leaked from persisted error text"

capture_run() {
	set +e
	result="$(subscription_schedule_run_locked manual)"
	result_rc=$?
	set -e
}

reset_case
capture_run
[ "$result_rc" -eq 0 ] || fail_test "running transaction failed: $result"
printf '%s\n' "$result" | python3 -c 'import json,sys; value=json.load(sys.stdin); assert value["ok"] is True; assert value["outcome"] == "reloaded"; assert value["pid"] == 4242' || fail_test "running result mismatch"
grep -q '^subscriptions_refresh {"force":true,"wait":true}$' "${tmp_dir}/calls" || fail_test "refresh did not use the synchronous MCP contract"
grep -q '^restart_runtime {"strategy":"hot_reload","wait":true}$' "${tmp_dir}/calls" || fail_test "restart did not use MCP hot_reload"
grep -q '^mihomo_api_request {"method":"GET","path":"/proxies"' "${tmp_dir}/calls" || fail_test "runtime /proxies read-back was not requested"

reset_case
MOCK_RUNNING=false
capture_run
[ "$result_rc" -eq 0 ] || fail_test "stopped runtime transaction failed: $result"
printf '%s\n' "$result" | python3 -c 'import json,sys; value=json.load(sys.stdin); assert value["outcome"] == "pending_next_start"; assert value["runtime_was_running"] is False' || fail_test "stopped runtime result mismatch"
grep -q '^restart_runtime ' "${tmp_dir}/calls" && fail_test "stopped runtime was hot reloaded"

reset_case
MOCK_REFRESH_READY=false
capture_run
[ "$result_rc" -ne 0 ] || fail_test "non-ready refresh returned success"
printf '%s\n' "$result" | grep -q '"code":"hot_reload_not_ready"' || fail_test "non-ready refresh failure was not explicit: $result"
grep -q '^restart_runtime ' "${tmp_dir}/calls" && fail_test "non-ready refresh reached hot reload"

reset_case
MOCK_RESTART_FAIL=true
capture_run
[ "$result_rc" -eq 0 ] || fail_test "read-back-confirmed hot reload did not recover indeterminate call: $result"
printf '%s\n' "$result" | python3 -c 'import json,sys; value=json.load(sys.stdin); assert value["outcome"] == "reloaded_after_indeterminate_call"; assert value["ok"] is True' || fail_test "read-back-confirmed result mismatch"
grep -q '^mihomo_api_request ' "${tmp_dir}/calls" || fail_test "indeterminate hot reload did not attempt controller read-back"

reset_case
MOCK_RESTART_FAIL=true
MOCK_NODE_CHANGE=false
capture_run
[ "$result_rc" -ne 0 ] || fail_test "non-discriminating hot reload read-back returned success"
printf '%s\n' "$result" | python3 -c 'import json,sys; value=json.load(sys.stdin); assert value["outcome"] == "attention_required"; assert value["code"] == "hot_reload_indeterminate"' || fail_test "non-discriminating result mismatch"

reset_case
mkdir -p "$LOCK_DIR"
printf '%s\n' "$$" > "$LOCK_DIR/pid"
subscription_schedule_tick
python3 - "$SUBSCRIPTION_SCHEDULE_STATUS" <<'PY'
import json, sys
value = json.load(open(sys.argv[1], encoding='utf-8'))
assert value['outcome'] == 'skipped_busy'
PY
rm -rf "$LOCK_DIR"

reset_case
mkdir -p "$LOCK_DIR"
printf '%s\n' "$$" > "$LOCK_DIR/pid"
printf '{"ok":true,"running":true,"done":false,"started_at":123,"task":"subscription_schedule","task_id":"task-123","cancellable":false}\n' > "$TASK_STATUS"
(subscription_schedule_run_task task-123)
python3 - "$TASK_STATUS" <<'PY'
import json, sys
value = json.load(open(sys.argv[1], encoding='utf-8'))
assert value['done'] is True
assert value['exit_code'] == 0
assert value['task_id'] == 'task-123'
assert value['result']['outcome'] == 'reloaded'
PY

printf 'rpcd subscription schedule tests passed\n'
