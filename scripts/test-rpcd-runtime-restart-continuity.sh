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
TAKEOVER_REPAIR_TICKET="${tmp_dir}/takeover/repair-ticket"
TAKEOVER_STATE_STATUS="${tmp_dir}/takeover/status"
BOOT_ID_FILE="${tmp_dir}/boot-id"
PROC_UPTIME="${tmp_dir}/uptime"
LOCK_DIR="${tmp_dir}/helper.lock"
printf 'test-boot-id\n' > "$BOOT_ID_FILE"
printf '12.0 0.0\n' > "$PROC_UPTIME"

fail_test() {
	printf 'test-rpcd-runtime-restart-continuity: %s\n' "$*" >&2
	exit 1
}

assert_json() {
	printf '%s\n' "$1" | python3 -m json.tool >/dev/null || fail_test "invalid JSON: $1"
}

reset_case() {
	: > "${tmp_dir}/trace"
	rm -f "$TAKEOVER_REPAIR_TICKET" "$TAKEOVER_STATE_STATUS"
	MOCK_PRE_EFFECTIVE=true
	MOCK_PRE_RUNTIME=true
	MOCK_PRE_PROFILE=router
	MOCK_POST_EFFECTIVE=true
	MOCK_POST_RUNTIME=true
	MOCK_POST_PROFILE=router
	MOCK_PRE_STATUS_RC=0
	MOCK_RESTART_RC=0
	MOCK_RUNTIME_AFTER=true
	MOCK_RUNTIME_STATUS_RC=0
	MOCK_APPLY_RC=0
	MOCK_POST_STATUS_RC=0
	status_calls=0
}

trace() {
	printf '%s\n' "$1" >> "${tmp_dir}/trace"
}

takeover_status_json() {
	local effective="$1" runtime="$2" profile="$3"
	if [ "$effective" = "missing" ]; then
		printf '{"ok":true,"status":{"runtime_running":%s,"profile_mode":"%s"}}\n' "$runtime" "$profile"
	else
		printf '{"ok":true,"status":{"effective":%s,"runtime_running":%s,"profile_mode":"%s"}}\n' "$effective" "$runtime" "$profile"
	fi
}

call_core() {
	trace "call_core $*"
	case "$*" in
		"takeover status --json")
			status_calls=$((status_calls + 1))
			if [ "$status_calls" -eq 1 ]; then
				if [ "$MOCK_PRE_STATUS_RC" -ne 0 ]; then
					printf '{"ok":false,"code":"mock_pre_status_failed","message":"pre status failed"}\n'
					return "$MOCK_PRE_STATUS_RC"
				fi
				takeover_status_json "$MOCK_PRE_EFFECTIVE" "$MOCK_PRE_RUNTIME" "$MOCK_PRE_PROFILE"
			else
				if [ "$MOCK_POST_STATUS_RC" -ne 0 ]; then
					printf '{"ok":false,"code":"mock_post_status_failed","message":"post status failed"}\n'
					return "$MOCK_POST_STATUS_RC"
				fi
				takeover_status_json "$MOCK_POST_EFFECTIVE" "$MOCK_POST_RUNTIME" "$MOCK_POST_PROFILE"
			fi
			;;
		"runtime restart --strategy process_restart --json")
			if [ "$MOCK_RESTART_RC" -ne 0 ]; then
				printf '{"ok":false,"code":"mock_restart_failed","message":"restart failed"}\n'
				return "$MOCK_RESTART_RC"
			fi
			printf '{"ok":true,"changed":true,"summary":"runtime restarted"}\n'
			;;
		"runtime status --json")
			if [ "$MOCK_RUNTIME_STATUS_RC" -ne 0 ]; then
				printf '{"ok":false,"code":"mock_runtime_status_failed","message":"runtime status failed"}\n'
				return "$MOCK_RUNTIME_STATUS_RC"
			fi
			printf '{"ok":true,"status":{"running":%s}}\n' "$MOCK_RUNTIME_AFTER"
			;;
		"takeover apply --json")
			if [ "$MOCK_APPLY_RC" -ne 0 ]; then
				printf '{"ok":false,"code":"mock_apply_failed","message":"apply failed"}\n'
				return "$MOCK_APPLY_RC"
			fi
			printf '{"ok":true,"changed":true,"summary":"takeover applied"}\n'
			;;
		*)
			printf '{"ok":false,"code":"unexpected_call","message":"%s"}\n' "$*"
			return 1
			;;
	esac
}

call_takeover() {
	trace "call_takeover $*"
	case "$*" in
		"status --json")
			status_calls=$((status_calls + 1))
			if [ "$status_calls" -eq 1 ]; then
				[ "$MOCK_PRE_STATUS_RC" -eq 0 ] || { printf '{"ok":false,"code":"mock_pre_status_failed","message":"pre status failed"}\n'; return "$MOCK_PRE_STATUS_RC"; }
				takeover_status_json "$MOCK_PRE_EFFECTIVE" "$MOCK_PRE_RUNTIME" "$MOCK_PRE_PROFILE"
			else
				[ "$MOCK_POST_STATUS_RC" -eq 0 ] || { printf '{"ok":false,"code":"mock_post_status_failed","message":"post status failed"}\n'; return "$MOCK_POST_STATUS_RC"; }
				takeover_status_json "$MOCK_POST_EFFECTIVE" "$MOCK_POST_RUNTIME" "$MOCK_POST_PROFILE"
			fi
			;;
		"apply --json")
			[ "$MOCK_APPLY_RC" -eq 0 ] || { printf '{"ok":false,"code":"mock_apply_failed","message":"apply failed"}\n'; return "$MOCK_APPLY_RC"; }
			mkdir -p "$(dirname "$TAKEOVER_REPAIR_TICKET")"
			printf 'applied\n' > "$TAKEOVER_REPAIR_TICKET"
			printf '{"ok":true,"changed":true,"summary":"takeover applied"}\n'
			;;
		*) return 1 ;;
	esac
}

capture_restart() {
	set +e
	result="$(runtime_restart)"
	result_rc=$?
	set -e
}

reset_case
capture_restart
assert_json "$result"
[ "$result_rc" -eq 0 ] || fail_test "effective takeover restart failed: $result"
printf '%s\n' "$result" | grep -q '"takeover_transition":"restored"' || fail_test "effective takeover was not restored: $result"
[ -f "$TAKEOVER_REPAIR_TICKET" ] || fail_test "successful restore did not retain repair ticket"
cat > "${tmp_dir}/expected-effective" <<'EOF'
call_takeover status --json
call_core runtime restart --strategy process_restart --json
call_core runtime status --json
call_takeover apply --json
call_takeover status --json
EOF
diff -u "${tmp_dir}/expected-effective" "${tmp_dir}/trace" || fail_test "effective takeover call order mismatch"

reset_case
MOCK_PRE_EFFECTIVE=false
MOCK_PRE_PROFILE=normal
MOCK_POST_EFFECTIVE=false
MOCK_POST_PROFILE=normal
capture_restart
assert_json "$result"
[ "$result_rc" -eq 0 ] || fail_test "inactive takeover restart failed: $result"
printf '%s\n' "$result" | grep -q '"takeover_transition":"preserved_inactive"' || fail_test "inactive takeover state was not preserved: $result"
grep -q 'takeover apply' "${tmp_dir}/trace" && fail_test "inactive takeover unexpectedly called apply"

reset_case
MOCK_PRE_EFFECTIVE=missing
capture_restart
assert_json "$result"
[ "$result_rc" -ne 0 ] || fail_test "malformed preflight status returned success"
printf '%s\n' "$result" | grep -q '"code":"runtime_restart_preflight_status_invalid"' || fail_test "malformed preflight status was not explicit: $result"
grep -q 'runtime restart' "${tmp_dir}/trace" && fail_test "restart ran after malformed preflight status"

reset_case
MOCK_PRE_PROFILE=normal
capture_restart
assert_json "$result"
[ "$result_rc" -ne 0 ] || fail_test "inconsistent active takeover snapshot returned success"
printf '%s\n' "$result" | grep -q '"code":"runtime_restart_snapshot_inconsistent"' || fail_test "inconsistent snapshot was not explicit: $result"
grep -q 'runtime restart' "${tmp_dir}/trace" && fail_test "restart ran after inconsistent snapshot"

reset_case
MOCK_RESTART_RC=19
capture_restart
assert_json "$result"
[ "$result_rc" -ne 0 ] || fail_test "restart failure returned success"
printf '%s\n' "$result" | grep -q '"code":"runtime_restart_failed"' || fail_test "restart failure code missing: $result"
printf '%s\n' "$result" | grep -q '"partial":true' || fail_test "restart failure did not report partial state: $result"
grep -q 'takeover apply' "${tmp_dir}/trace" && fail_test "takeover apply ran after restart failure"

reset_case
MOCK_RUNTIME_AFTER=false
capture_restart
assert_json "$result"
[ "$result_rc" -ne 0 ] || fail_test "stopped post-restart runtime returned success"
printf '%s\n' "$result" | grep -q '"code":"runtime_not_running_after_restart"' || fail_test "runtime verification failure code missing: $result"
grep -q 'takeover apply' "${tmp_dir}/trace" && fail_test "takeover apply ran while runtime was stopped"

reset_case
MOCK_APPLY_RC=23
capture_restart
assert_json "$result"
[ "$result_rc" -ne 0 ] || fail_test "takeover apply failure returned success"
printf '%s\n' "$result" | grep -q '"code":"takeover_restore_failed"' || fail_test "takeover restore failure code missing: $result"
printf '%s\n' "$result" | grep -q '"partial":true' || fail_test "takeover restore failure did not report partial state: $result"

reset_case
MOCK_POST_EFFECTIVE=false
capture_restart
assert_json "$result"
[ "$result_rc" -ne 0 ] || fail_test "postflight takeover mismatch returned success"
printf '%s\n' "$result" | grep -q '"code":"runtime_restart_postcondition_failed"' || fail_test "postflight mismatch code missing: $result"

grep -q 'runtime_restart) with_lock runtime_restart' "$helper" || fail_test "public runtime_restart dispatch is not lifecycle-locked"

printf 'rpcd runtime restart continuity tests passed\n'
