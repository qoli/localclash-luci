#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
helper="${repo_root}/openwrt/luci-app-localclash/root/usr/libexec/rpcd/localclash"
tmp_dir="$(mktemp -d)"
state_handoff_dir="/tmp/localclash-one-click-update.$$"
trap 'rm -rf "${tmp_dir}" "${state_handoff_dir}"' EXIT

mkdir -p "${tmp_dir}/bin"
PATH="${tmp_dir}/bin:${PATH}"

cat > "${tmp_dir}/bin/jsonfilter" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
input=""
expr=""
mode=""
while [ "$#" -gt 0 ]; do
	case "$1" in
		-i) input="$2"; mode="file"; shift 2 ;;
		-s) input="$2"; mode="string"; shift 2 ;;
		-e) expr="$2"; shift 2 ;;
		*) shift ;;
	esac
done
if [ "$mode" = "string" ]; then
	content="$input"
else
	content="$(cat "$input")"
fi
json_bool() {
	field="$1"
	if printf '%s\n' "$content" | grep -q "\"$field\"[[:space:]]*:[[:space:]]*true"; then
		printf 'true\n'
		return 0
	fi
	if printf '%s\n' "$content" | grep -q "\"$field\"[[:space:]]*:[[:space:]]*false"; then
		printf 'false\n'
		return 0
	fi
	return 1
}
case "$expr" in
	@.sync_default_policy)
		json_bool sync_default_policy
		;;
	@.runtime_was_running)
		json_bool runtime_was_running
		;;
	@.takeover_was_effective)
		json_bool takeover_was_effective
		;;
	@.version)
		printf '%s\n' "$content" | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p'
		;;
	@.owner_pid)
		printf '%s\n' "$content" | sed -n 's/.*"owner_pid"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p'
		;;
	@.task)
		printf '%s\n' "$content" | sed -n 's/.*"task"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p'
		;;
	@.phase)
		printf '%s\n' "$content" | sed -n 's/.*"phase"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p'
		;;
	@.profile_mode)
		printf '%s\n' "$content" | sed -n 's/.*"profile_mode"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p'
		;;
	@.one_click_update.sync_default_policy)
		if printf '%s\n' "$content" | grep -q '"one_click_update"[[:space:]]*:[[:space:]]*{[^}]*"sync_default_policy"[[:space:]]*:[[:space:]]*true'; then
			printf 'true\n'
		elif printf '%s\n' "$content" | grep -q '"one_click_update"[[:space:]]*:[[:space:]]*{[^}]*"sync_default_policy"[[:space:]]*:[[:space:]]*false'; then
			printf 'false\n'
		else
			exit 1
		fi
		;;
	@.preferences.one_click_update.sync_default_policy)
		if printf '%s\n' "$content" | grep -q '"preferences"[[:space:]]*:[[:space:]]*{[^}]*"one_click_update"[[:space:]]*:[[:space:]]*{[^}]*"sync_default_policy"[[:space:]]*:[[:space:]]*true'; then
			printf 'true\n'
		elif printf '%s\n' "$content" | grep -q '"preferences"[[:space:]]*:[[:space:]]*{[^}]*"one_click_update"[[:space:]]*:[[:space:]]*{[^}]*"sync_default_policy"[[:space:]]*:[[:space:]]*false'; then
			printf 'false\n'
		else
			exit 1
		fi
		;;
	@.changed)
		json_bool changed
		;;
	@.luci.changed)
		printf '%s\n' "$content" | grep -q '"luci"[[:space:]]*:[[:space:]]*{[^}]*"changed"[[:space:]]*:[[:space:]]*true' && printf 'true\n' || printf 'false\n'
		;;
	@.status.running)
		json_bool running
		;;
	@.status.effective)
		json_bool effective
		;;
	@.status.configured)
		json_bool configured
		;;
	@.mcp.healthy)
		json_bool healthy
		;;
	@.status.profile_mode)
		printf '%s\n' "$content" | sed -n 's/.*"profile_mode"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p'
		;;
	@.status.runtime_profile.mode)
		printf '%s\n' "$content" | sed -n 's/.*"runtime_profile"[[:space:]]*:[[:space:]]*{[^}]*"mode"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p'
		;;
	@.status.runtime_profile.core)
		printf '%s\n' "$content" | sed -n 's/.*"runtime_profile"[[:space:]]*:[[:space:]]*{[^}]*"core"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p'
		;;
	*) exit 1 ;;
esac
EOF
chmod +x "${tmp_dir}/bin/jsonfilter"

awk '/^method="\$\{1:-\}"/ { exit } { print }' "${helper}" > "${tmp_dir}/functions.sh"
# shellcheck disable=SC1090
. "${tmp_dir}/functions.sh"

LOG="${tmp_dir}/helper.log"
LOCK_DIR="${tmp_dir}/helper.lock"
STATE_DIR="${tmp_dir}/state"
TASK_INPUT="${tmp_dir}/task-input.json"
mkdir -p "$STATE_DIR"

trace() {
	printf '%s\n' "$1" >> "${tmp_dir}/trace"
}

fail_test() {
	printf 'test-rpcd-one-click-update: %s\n' "$*" >&2
	exit 1
}

assert_json() {
	local payload="$1"
	printf '%s\n' "$payload" | python3 -m json.tool >/dev/null || fail_test "invalid JSON: ${payload}"
}

set_task_input() {
	printf '%s\n' "$1" > "$TASK_INPUT"
}

clear_task_input() {
	rm -f "$TASK_INPUT"
}

(
	LOG="${tmp_dir}/mirror-switch.log"
	MIRROR_CACHE_DIR="${tmp_dir}/mirror-cache"
	GITHUB_RELEASE_MIRRORS="https://mirror.example/https://github.com"
	downloaded="${tmp_dir}/mirror-download.out"
	stderr="${tmp_dir}/mirror-switch.stderr"
	: > "$LOG"
	fetch_single_url() {
		case "$1" in
			https://github.com/*)
				printf 'Failed to send request: Operation not permitted\n' >&2
				return 1
				;;
			https://mirror.example/*)
				printf 'ok\n' > "$2"
				return 0
				;;
		esac
		return 1
	}
	fetch_url_direct_first "https://github.com/qoli/localclash-luci/releases/download/v-test/luci-app-localclash_0.1.0-test_all.ipk.sha256" "$downloaded" 2>"$stderr" || fail_test "direct-first mirror fallback failed"
	grep -q 'Failed to send request: Operation not permitted' "$stderr" || fail_test "raw fetch stderr was not preserved"
	grep -q '下载：正在切换 GitHub 镜像' "$LOG" || fail_test "mirror switch log was not written"
	grep -q '^ok$' "$downloaded" || fail_test "mirror download output mismatch"
)

core_installed() {
	return 0
}

sleep() {
	:
}

luci_update() {
	trace "luci_update"
	case "${MOCK_LUCI_CHANGED:-true}" in
		true|false) printf '{"ok":true,"changed":%s,"summary":"LuCI updated"}\n' "${MOCK_LUCI_CHANGED:-true}" ;;
		missing) printf '{"ok":true,"summary":"LuCI updated"}\n' ;;
		*) printf '{"ok":true,"changed":"invalid","summary":"LuCI updated"}\n' ;;
	esac
}

one_click_update_reexec() {
	trace "one_click_update_reexec"
	one_click_update_resume
	exit $?
}

bootstrap_core() {
	trace "bootstrap_core"
	printf '{"ok":true,"changed":true,"summary":"core updated"}\n'
}

service_status() {
	trace "service_status"
	printf '{"ok":true,"mcp":{"healthy":true},"summary":"service running"}\n'
}

run_one_click_update() {
	with_lock one_click_update_run
}

capture_one_click_update() {
	set +e
	result="$(run_one_click_update)"
	result_rc=$?
	set -e
	return 0
}

capture_resume_failure() {
	set +e
	result="$(one_click_update_resume)"
	result_rc=$?
	set -e
	return 0
}

takeover_apply() {
	trace "takeover_apply"
	printf '{"ok":true,"changed":true,"summary":"takeover applied"}\n'
}

call_core() {
	trace "call_core $*"
	case "$*" in
		"runtime status --json")
			printf '{"status":{"running":true}}\n'
			;;
		"takeover status --json")
			printf '{"status":{"effective":true,"runtime_running":true,"profile_mode":"router"}}\n'
			;;
		"component update mihomo --json")
			if [ "${MOCK_MIHOMO_CHANGED_MISSING:-0}" = "1" ]; then
				printf '{"ok":true,"summary":"mihomo updated"}\n'
			else
				printf '{"ok":true,"changed":true,"summary":"mihomo updated"}\n'
			fi
			;;
		"component update dashboard --json")
			printf '{"ok":true,"changed":true,"summary":"dashboard updated"}\n'
			;;
		"subscription status --json")
			printf '{"status":{"configured":true}}\n'
			;;
		"subscription refresh --json")
			if [ "${MOCK_SUBSCRIPTION_REFRESH_FAIL:-0}" = "1" ]; then
				printf '{"ok":false,"code":"subscription_fetch_failed","message":"subscription source unavailable"}\nprovider timeout\n'
				return 1
			else
				printf '{"ok":true,"changed":true,"summary":"subscription refreshed"}\n'
			fi
			;;
		"config status --json")
			printf '{"status":{"runtime_profile":{"mode":"router","core":"smart"}}}\n'
			;;
		config\ apply-template\ --input\ *\ --json)
			cp "$4" "${tmp_dir}/template-sync-input.json"
			printf '{"ok":true,"changed":true,"summary":"default policy synced"}\n'
			;;
		"config render --json")
			if [ "${MOCK_CONFIG_RENDER_FAIL:-0}" = "1" ]; then
				printf '{"ok":false,"code":"cached_subscription_invalid","message":"cached subscription cannot render"}\n'
				return 1
			else
				printf '{"ok":true,"changed":true,"summary":"config rendered"}\n'
			fi
			;;
		"mihomo config-test --json")
			printf '{"ok":true,"changed":false,"summary":"config valid"}\n'
			;;
		"runtime restart --strategy process_restart --json")
			printf '{"ok":true,"changed":true,"summary":"runtime restarted"}\n'
			;;
		*)
			printf '{"ok":false,"code":"unexpected_call","message":"%s"}\n' "$*"
			return 1
			;;
	esac
}

: > "${tmp_dir}/trace"
result="$(one_click_update_preferences)"
assert_json "$result"
printf '%s\n' "$result" | grep -q '"sync_default_policy":true' || fail_test "default sync preference should be true: ${result}"

result="$(printf '{"sync_default_policy":false}' | one_click_update_preferences_set)"
assert_json "$result"
printf '%s\n' "$result" | grep -q '"sync_default_policy":false' || fail_test "sync preference false was not saved: ${result}"
grep -q '"sync_default_policy":false' "${STATE_DIR}/luci-preferences.json" || fail_test "sync preference file was not persisted"

set_task_input '{"version":1,"sync_default_policy":false}'
result="$(run_one_click_update)"
clear_task_input
assert_json "$result"
printf '%s\n' "$result" | grep -q '"ok":true' || fail_test "one_click_update_run failed: ${result}"
printf '%s\n' "$result" | grep -q '"restart_strategy":"process_restart"' || fail_test "restart strategy mismatch: ${result}"
printf '%s\n' "$result" | grep -q '"takeover_recovered":true' || fail_test "takeover was not recovered: ${result}"
one_click_update_luci_changed "$result" || fail_test "LuCI changed marker was not detected for service reload"
[ ! -e "$LOCK_DIR" ] || fail_test "successful handoff did not clean the task lock"
[ ! -e "$state_handoff_dir" ] || fail_test "successful handoff did not clean the state directory"

expected="${tmp_dir}/expected-trace"
cat > "$expected" <<EOF
call_core runtime status --json
call_core takeover status --json
luci_update
one_click_update_reexec
bootstrap_core
service_status
call_core component update mihomo --json
call_core component update dashboard --json
call_core subscription status --json
call_core subscription refresh --json
call_core config render --json
call_core mihomo config-test --json
call_core runtime restart --strategy process_restart --json
takeover_apply
call_core takeover status --json
service_status
EOF

if ! diff -u "$expected" "${tmp_dir}/trace"; then
	fail_test "one-click update order mismatch"
fi

: > "${tmp_dir}/trace"
set_task_input '{"version":1,"sync_default_policy":false}'
MOCK_LUCI_CHANGED=false
export MOCK_LUCI_CHANGED
result="$(run_one_click_update)"
clear_task_input
unset MOCK_LUCI_CHANGED
assert_json "$result"
printf '%s\n' "$result" | grep -q '"ok":true' || fail_test "unchanged LuCI update failed: ${result}"
grep -q '^one_click_update_reexec$' "${tmp_dir}/trace" && fail_test "unchanged LuCI update must not re-exec the helper"
grep -q '^bootstrap_core$' "${tmp_dir}/trace" || fail_test "unchanged LuCI update did not continue to core update"

: > "${tmp_dir}/trace"
set_task_input '{"version":1,"sync_default_policy":false}'
MOCK_LUCI_CHANGED=missing
export MOCK_LUCI_CHANGED
capture_one_click_update
clear_task_input
unset MOCK_LUCI_CHANGED
assert_json "$result"
[ "$result_rc" -ne 0 ] || fail_test "invalid LuCI update result returned success"
printf '%s\n' "$result" | grep -q '"code":"luci_update_result_invalid"' || fail_test "missing LuCI changed state was not explicit: ${result}"
grep -q '^bootstrap_core$' "${tmp_dir}/trace" && fail_test "core update ran after invalid LuCI update result"

rm -rf "$LOCK_DIR" "$state_handoff_dir"
mkdir -p "$LOCK_DIR" "$state_handoff_dir"
printf '%s\n' "$(( $$ + 1 ))" > "$LOCK_DIR/pid"
printf '{"version":1,"task":"one_click_update","owner_pid":%s,"phase":"awaiting_resume"}\n' "$$" > "$state_handoff_dir/state.json"
printf '{"version":1,"sync_default_policy":false,"runtime_was_running":true,"takeover_was_effective":true,"profile_mode":"router"}\n' > "$state_handoff_dir/snapshot.json"
printf '{"ok":true,"changed":true}\n' > "$state_handoff_dir/luci.json"
capture_resume_failure
assert_json "$result"
[ "$result_rc" -ne 0 ] || fail_test "foreign task lock returned success"
printf '%s\n' "$result" | grep -q '"code":"one_click_update_lock_owner_mismatch"' || fail_test "resume accepted a foreign task lock: ${result}"
[ -d "$LOCK_DIR" ] || fail_test "resume removed a foreign task lock"
rm -rf "$LOCK_DIR" "$state_handoff_dir"

mkdir -p "$LOCK_DIR" "$state_handoff_dir"
printf '%s\n' "$$" > "$LOCK_DIR/pid"
printf '{"version":2,"task":"one_click_update","owner_pid":%s,"phase":"awaiting_resume"}\n' "$$" > "$state_handoff_dir/state.json"
printf '{"version":1,"sync_default_policy":false,"runtime_was_running":true,"takeover_was_effective":true,"profile_mode":"router"}\n' > "$state_handoff_dir/snapshot.json"
printf '{"ok":true,"changed":true}\n' > "$state_handoff_dir/luci.json"
capture_resume_failure
assert_json "$result"
[ "$result_rc" -ne 0 ] || fail_test "unsupported state version returned success"
printf '%s\n' "$result" | grep -q '"code":"one_click_update_state_version_unsupported"' || fail_test "resume accepted an unsupported state version: ${result}"
[ ! -e "$LOCK_DIR" ] || fail_test "unsupported state version did not clean the owned task lock"
[ ! -e "$state_handoff_dir" ] || fail_test "unsupported state version did not clean the handoff state"
rm -rf "$LOCK_DIR" "$state_handoff_dir"

mkdir -p "$LOCK_DIR" "$state_handoff_dir"
printf '%s\n' "$$" > "$LOCK_DIR/pid"
printf '{"version":1,"task":"one_click_update","owner_pid":%s,"phase":"continuing"}\n' "$$" > "$state_handoff_dir/state.json"
printf '{"version":1,"sync_default_policy":false,"runtime_was_running":true,"takeover_was_effective":true,"profile_mode":"router"}\n' > "$state_handoff_dir/snapshot.json"
printf '{"ok":true,"changed":true}\n' > "$state_handoff_dir/luci.json"
capture_resume_failure
assert_json "$result"
[ "$result_rc" -ne 0 ] || fail_test "invalid resume phase returned success"
printf '%s\n' "$result" | grep -q '"code":"one_click_update_resume_phase_invalid"' || fail_test "resume accepted an invalid phase: ${result}"
[ ! -e "$LOCK_DIR" ] || fail_test "invalid resume phase did not clean the owned task lock"
[ ! -e "$state_handoff_dir" ] || fail_test "invalid resume phase did not clean the handoff state"
rm -rf "$LOCK_DIR" "$state_handoff_dir"

mkdir -p "$LOCK_DIR" "$state_handoff_dir"
printf '%s\n' "$$" > "$LOCK_DIR/pid"
printf 'sentinel\n' > "${tmp_dir}/state-target"
ln -s "${tmp_dir}/state-target" "$state_handoff_dir/state.json"
printf '{"version":1,"sync_default_policy":false,"runtime_was_running":true,"takeover_was_effective":true,"profile_mode":"router"}\n' > "$state_handoff_dir/snapshot.json"
printf '{"ok":true,"changed":true}\n' > "$state_handoff_dir/luci.json"
capture_resume_failure
assert_json "$result"
[ "$result_rc" -ne 0 ] || fail_test "symlinked state returned success"
printf '%s\n' "$result" | grep -q '"code":"one_click_update_state_missing"' || fail_test "resume accepted a symlinked state file: ${result}"
grep -qx 'sentinel' "${tmp_dir}/state-target" || fail_test "handoff cleanup followed a state symlink"
[ ! -e "$LOCK_DIR" ] || fail_test "symlinked state failure did not clean the owned task lock"
[ ! -e "$state_handoff_dir" ] || fail_test "symlinked state failure did not clean the handoff directory"

: > "${tmp_dir}/trace"
set_task_input '{"version":1,"sync_default_policy":false}'
MOCK_MIHOMO_CHANGED_MISSING=1
capture_one_click_update
clear_task_input
assert_json "$result"
unset MOCK_MIHOMO_CHANGED_MISSING
[ "$result_rc" -ne 0 ] || fail_test "invalid Mihomo update result returned success"
printf '%s\n' "$result" | grep -q '"ok":false' || fail_test "missing changed did not fail: ${result}"
printf '%s\n' "$result" | grep -q '"code":"component_update_result_invalid"' || fail_test "missing changed code mismatch: ${result}"

: > "${tmp_dir}/trace"
set_task_input '{"version":1,"sync_default_policy":false}'
MOCK_SUBSCRIPTION_REFRESH_FAIL=1
result="$(run_one_click_update 2>"${tmp_dir}/subscription-refresh-fallback.stderr")"
clear_task_input
assert_json "$result"
unset MOCK_SUBSCRIPTION_REFRESH_FAIL
printf '%s\n' "$result" | grep -q '"ok":true' || fail_test "subscription refresh fallback failed: ${result}"
printf '%s\n' "$result" | grep -q '"refresh_failed":true' || fail_test "subscription refresh failure was not reported: ${result}"
printf '%s\n' "$result" | grep -q '"used_cached_artifact":true' || fail_test "cached subscription use was not reported: ${result}"
printf '%s\n' "$result" | grep -q '"fallback_reason"' || fail_test "fallback reason missing: ${result}"

cat > "$expected" <<EOF
call_core runtime status --json
call_core takeover status --json
luci_update
one_click_update_reexec
bootstrap_core
service_status
call_core component update mihomo --json
call_core component update dashboard --json
call_core subscription status --json
call_core subscription refresh --json
call_core config render --json
call_core mihomo config-test --json
call_core runtime restart --strategy process_restart --json
takeover_apply
call_core takeover status --json
service_status
EOF

if ! diff -u "$expected" "${tmp_dir}/trace"; then
	fail_test "subscription refresh fallback order mismatch"
fi

: > "${tmp_dir}/trace"
set_task_input '{"version":1,"sync_default_policy":true}'
result="$(run_one_click_update)"
clear_task_input
assert_json "$result"
printf '%s\n' "$result" | grep -q '"ok":true' || fail_test "sync default policy run failed: ${result}"
printf '%s\n' "$result" | grep -q '"policy_template_sync"' || fail_test "policy sync result missing: ${result}"
grep -q '"sync_default_policy":true' "${STATE_DIR}/luci-preferences.json" || fail_test "one-click run did not persist true sync preference"
grep -q '"refresh_policy_template_patches":[[:space:]]*true' "${tmp_dir}/template-sync-input.json" || fail_test "template sync did not request policy-template-only refresh"
grep -q '"reset_patches"' "${tmp_dir}/template-sync-input.json" && fail_test "template sync should not request reset_patches"
grep -q '"core":[[:space:]]*"smart"' "${tmp_dir}/template-sync-input.json" || fail_test "template sync did not preserve current smart core"

sed -E 's#--input /tmp/localclash-one-click-update[.][^ ]+/template-sync[.]json#--input <template-sync>#' "${tmp_dir}/trace" > "${tmp_dir}/trace.normalized"
cat > "$expected" <<EOF
call_core runtime status --json
call_core takeover status --json
luci_update
one_click_update_reexec
bootstrap_core
service_status
call_core component update mihomo --json
call_core component update dashboard --json
call_core config status --json
call_core config apply-template --input <template-sync> --json
call_core subscription status --json
call_core subscription refresh --json
call_core config render --json
call_core mihomo config-test --json
call_core runtime restart --strategy process_restart --json
takeover_apply
call_core takeover status --json
service_status
EOF

if ! diff -u "$expected" "${tmp_dir}/trace.normalized"; then
	fail_test "sync default policy order mismatch"
fi

: > "${tmp_dir}/trace"
set_task_input '{"version":1,"sync_default_policy":false}'
MOCK_SUBSCRIPTION_REFRESH_FAIL=1
MOCK_CONFIG_RENDER_FAIL=1
set +e
result="$(run_one_click_update 2>"${tmp_dir}/subscription-cache-invalid.stderr")"
result_rc=$?
set -e
clear_task_input
assert_json "$result"
unset MOCK_SUBSCRIPTION_REFRESH_FAIL MOCK_CONFIG_RENDER_FAIL
[ "$result_rc" -ne 0 ] || fail_test "invalid cached subscription returned success"
printf '%s\n' "$result" | grep -q '"ok":false' || fail_test "invalid cached subscription did not fail: ${result}"
printf '%s\n' "$result" | grep -q '"code":"cached_subscription_invalid"' || fail_test "invalid cached subscription failure code mismatch: ${result}"

printf 'rpcd one-click update tests passed\n'
