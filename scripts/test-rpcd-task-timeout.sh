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
if grep -q 'step_timeout\|已停止等待' "$output" "$LOG" 2>/dev/null; then
	printf 'test-rpcd-task-timeout: unbounded core-owned step was timed out\n' >&2
	exit 1
fi

grep -q 'run_with_heartbeat_until_complete "一键更新：正在刷新订阅"' "$helper"
grep -q 'run_with_heartbeat_until_complete "一键更新：正在同步最新默认策略"' "$helper"
grep -q 'run_with_heartbeat_until_complete "订阅设置：正在刷新订阅"' "$helper"

printf 'test-rpcd-task-timeout: PASS\n'
