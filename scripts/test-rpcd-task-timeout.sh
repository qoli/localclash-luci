#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
helper="${repo_root}/openwrt/luci-app-localclash/root/usr/libexec/rpcd/localclash"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

export LOCALCLASH_TASK_STEP_TIMEOUT=1
export LOCALCLASH_TASK_HEARTBEAT_INTERVAL=1
awk '/^method="\$\{1:-\}"/ { exit } { print }' "${helper}" > "${tmp_dir}/functions.sh"
# shellcheck disable=SC1090
. "${tmp_dir}/functions.sh"

LOG="${tmp_dir}/helper.log"
output="${tmp_dir}/result.json"
run_with_heartbeat_until_complete "订阅刷新测试" "$output" sh -c 'sleep 2; printf %s\\n "{\"ok\":true}"'

grep -q '"ok":true' "$output"
grep -q '订阅刷新测试：仍在执行' "$LOG"
if grep -q 'step_timeout\|已停止等待' "$output" "$LOG" 2>/dev/null; then
	printf 'test-rpcd-task-timeout: unbounded core-owned step was timed out\n' >&2
	exit 1
fi

(
	TASK_HEARTBEAT_INTERVAL=30
	started="$(now_epoch)"
	if run_with_heartbeat_until_complete "快速结束测试" "$output" sh -c 'printf "fixture failure\\n"; exit 7'; then
		exit 1
	else
		[ "$?" -eq 7 ]
	fi
	grep -qx 'fixture failure' "$output"
	if [ "$(( $(now_epoch) - started ))" -gt 2 ]; then
		printf 'test-rpcd-task-timeout: completed step waited for the heartbeat\n' >&2
		exit 1
	fi
)

grep -q 'run_with_heartbeat_until_complete "一键更新：正在刷新订阅"' "$helper"
grep -q 'run_with_heartbeat_until_complete "一键更新：正在同步最新默认策略"' "$helper"
grep -q 'run_with_heartbeat_until_complete "订阅设置：正在刷新订阅"' "$helper"

if run_with_heartbeat "限时下载测试" "$output" sh -c 'sleep 20'; then
	printf 'test-rpcd-task-timeout: bounded step unexpectedly succeeded\n' >&2
	exit 1
else
	[ "$?" -eq 124 ]
fi
grep -q '"code":"step_timeout"' "$output"

(
	calls="${tmp_dir}/fetch-calls"
	FETCH_TIMEOUT=120
	now_epoch() { printf '100\n'; }
	uclient-fetch() {
		printf '%s\n' "$*" >> "$calls"
		while [ "$#" -gt 1 ]; do
			if [ "$1" = -O ]; then
				printf 'payload\n' > "$2"
				return 0
			fi
			shift
		done
		return 1
	}
	bounded_stage_deadline=103
	fetch_single_url https://example.invalid/first "${tmp_dir}/payload"
	grep -q '^-T 3 ' "$calls"

	bounded_stage_deadline=100
	if fetch_single_url https://example.invalid/late "${tmp_dir}/late"; then
		exit 1
	else
		[ "$?" -eq 124 ]
	fi
	if luci_update_retry "重试测试" fetch_single_url https://example.invalid/retry "${tmp_dir}/retry"; then
		exit 1
	else
		[ "$?" -eq 124 ]
	fi
	[ "$(wc -l < "$calls" | tr -d ' ')" -eq 1 ]
	[ ! -e "${tmp_dir}/late" ] && [ ! -e "${tmp_dir}/retry" ]
)

printf 'test-rpcd-task-timeout: PASS\n'
