#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
helper="${repo_root}/openwrt/luci-app-localclash/root/usr/libexec/rpcd/localclash"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

awk '/^method="\$\{1:-\}"/ { exit } { print }' "${helper}" > "${tmp_dir}/functions.sh"
# shellcheck disable=SC1090
. "${tmp_dir}/functions.sh"

LOCK_DIR="${tmp_dir}/lock"
LOG="${tmp_dir}/helper.log"
TASK_STATUS="${tmp_dir}/task-status.json"
TASK_RESULT="${tmp_dir}/task-result.json"
TASK_INPUT="${tmp_dir}/task-input.json"
TASK_PID="${tmp_dir}/task.pid"

fail_test() {
	printf 'test-rpcd-custom-sites: %s\n' "$*" >&2
	exit 1
}

jsonfilter() {
	return 1
}

call_core() {
	local input=""
	printf '%s\n' "$*" > "${tmp_dir}/args"
	while [ "$#" -gt 0 ]; do
		if [ "$1" = "--input" ]; then
			input="$2"
			break
		fi
		shift
	done
	if [ -n "$input" ]; then
		cp "$input" "${tmp_dir}/payload"
	fi
	if [ "${MOCK_FAIL:-false}" = "true" ]; then
		printf '{"ok":false,"code":"core_failure","message":"core failed"}\n'
		return 7
	fi
	printf '{"ok":true,"custom_sites":{"proxy":[],"direct":[]}}\n'
}

result="$(custom_sites_get)"
[ "$(cat "${tmp_dir}/args")" = 'custom-sites list --json' ] || fail_test "get did not call the fixed Core list contract"
printf '%s\n' "$result" | grep -q '"ok":true' || fail_test "get result was not passed through"

result="$(printf '{"ubus_rpc_session":"secret","operation":"add","pattern":"ABC.*cdn.com","route":"proxy"}' | with_lock custom_sites_transact)"
[ "$(cat "${tmp_dir}/args")" = 'custom-sites transact --input '"$(sed -n 's/.*--input \([^ ]*\) --json/\1/p' "${tmp_dir}/args")"' --json' ] || fail_test "transact command shape is invalid"
python3 - "${tmp_dir}/payload" <<'PY'
import json, sys
payload = json.load(open(sys.argv[1], encoding="utf-8"))
assert payload == {"version": 1, "operation": "add", "pattern": "ABC.*cdn.com", "route": "proxy"}, payload
PY
printf '%s\n' "$result" | grep -q '"ok":true' || fail_test "add result was not passed through"

printf '{"operation":"delete","id":"site-42"}' | with_lock custom_sites_transact >/dev/null
python3 - "${tmp_dir}/payload" <<'PY'
import json, sys
payload = json.load(open(sys.argv[1], encoding="utf-8"))
assert payload == {"version": 1, "operation": "delete", "id": "site-42"}, payload
PY

set +e
MOCK_FAIL=true
result="$(printf '{"operation":"delete","id":"site-99"}' | with_lock custom_sites_transact)"
result_rc=$?
set -e
[ "$result_rc" -eq 7 ] || fail_test "Core failure exit code was not preserved: ${result_rc}"
printf '%s\n' "$result" | grep -q '"code":"core_failure"' || fail_test "Core failure JSON was not preserved"

grep -q '"custom_sites_get"' "${helper}" || fail_test "rpcd list schema is missing custom_sites_get"
grep -q '"custom_sites_transact"' "${helper}" || fail_test "rpcd list schema is missing custom_sites_transact"
grep -q '"custom_sites_transact_async"' "${helper}" || fail_test "rpcd list schema is missing custom_sites_transact_async"
grep -q 'custom_sites_transact) with_lock custom_sites_transact' "${helper}" || fail_test "transact dispatch is not locked"
grep -q 'custom_sites_transact_async) start_custom_sites_transact' "${helper}" || fail_test "async transact dispatch is missing"
grep -q 'custom_sites_transact_run) with_lock custom_sites_transact_run' "${helper}" || fail_test "async transact runner is not locked"

printf '{"version":1,"operation":"add","pattern":"async.example","route":"direct"}\n' > "$TASK_INPUT"
MOCK_FAIL=false
result="$(with_lock custom_sites_transact_run)"
printf '%s\n' "$result" | grep -q '"ok":true' || fail_test "async runner result was not passed through"
grep -q '自訂網站：开始验证、渲染和运行时应用' "$LOG" || fail_test "async runner did not expose progress log"

printf 'rpcd custom sites tests passed\n'
