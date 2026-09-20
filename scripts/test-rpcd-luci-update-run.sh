#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
helper="${repo_root}/openwrt/luci-app-localclash/root/usr/libexec/rpcd/localclash"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

awk '/^method="\$\{1:-\}"/ { exit } { print }' "${helper}" > "${tmp_dir}/functions.sh"
# shellcheck disable=SC1090
. "${tmp_dir}/functions.sh"

LOCK_DIR="${tmp_dir}/helper.lock"
LOG="${tmp_dir}/helper.log"
TRACE="${tmp_dir}/trace"
export TRACE

sleep() {
	:
}

fail_test() {
	printf 'test-rpcd-luci-update-run: %s\n' "$*" >&2
	exit 1
}

for package_builder in "${repo_root}/scripts/build-openwrt-ipk.sh" "${repo_root}/scripts/build-openwrt-apk.sh"; do
	if grep -q 'service_start' "$package_builder"; then
		fail_test "package post-install must not own localclash-mcp restart: $package_builder"
	fi
	if grep -Eq '/etc/init[.]d/(rpcd|uhttpd) restart' "$package_builder"; then
		fail_test "package post-install must not restart RPC or Web services: $package_builder"
	fi
	if grep -q '/etc/init.d/uhttpd' "$package_builder"; then
		fail_test "package post-install must not assume that uhttpd owns the Web service: $package_builder"
	fi
done

if grep -q '/etc/init.d/uhttpd' "$helper"; then
	fail_test "LuCI update must not assume that uhttpd owns the Web service"
fi

cat > "${tmp_dir}/rpcd" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$TRACE"
EOF
chmod +x "${tmp_dir}/rpcd"
RPCD_SERVICE="${tmp_dir}/rpcd"
LUCI_RPCD_RELOAD_REQUIRED="${tmp_dir}/rpcd-reload-required"
LUCI_SUBSCRIPTION_SCHEDULER_RESTART_REQUIRED="${tmp_dir}/subscription-scheduler-restart-required"

cat > "${tmp_dir}/uci" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[ "$*" = '-q get localclash.subscription_schedule.enabled' ]
printf '%s\n' "${MOCK_SCHEDULER_ENABLED}"
EOF
cat > "${tmp_dir}/scheduler-service" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'scheduler %s\n' "$*" >> "$TRACE"
EOF
chmod +x "${tmp_dir}/uci" "${tmp_dir}/scheduler-service"
UCI_BIN="${tmp_dir}/uci"
SUBSCRIPTION_SCHEDULER_SERVICE="${tmp_dir}/scheduler-service"
MOCK_SCHEDULER_ENABLED=1
export MOCK_SCHEDULER_ENABLED

: > "$TRACE"
: > "$LUCI_RPCD_RELOAD_REQUIRED"
luci_schedule_rpcd_reload
for _ in $(seq 1 40); do
	[ -s "$TRACE" ] && break
	/bin/sleep 0.05
done
grep -qx 'reload' "$TRACE" || fail_test "LuCI update did not use rpcd reload exactly once"
grep -q 'rpcd 已重新加载' "$LOG" || fail_test "successful rpcd reload was not logged"
[ ! -e "$LUCI_RPCD_RELOAD_REQUIRED" ] || fail_test "successful rpcd reload did not clear its required marker"

: > "$TRACE"
: > "$LUCI_SUBSCRIPTION_SCHEDULER_RESTART_REQUIRED"
luci_schedule_rpcd_reload
for _ in $(seq 1 40); do
	grep -q 'scheduler restart' "$TRACE" 2>/dev/null && break
	/bin/sleep 0.05
done
grep -qx 'scheduler enable' "$TRACE" || fail_test "enabled subscription scheduler was not enabled after package update"
grep -qx 'scheduler restart' "$TRACE" || fail_test "enabled subscription scheduler was not restarted after package update"
[ ! -e "$LUCI_SUBSCRIPTION_SCHEDULER_RESTART_REQUIRED" ] || fail_test "successful scheduler restart did not clear its required marker"

: > "$TRACE"
MOCK_SCHEDULER_ENABLED=0
export MOCK_SCHEDULER_ENABLED
: > "$LUCI_SUBSCRIPTION_SCHEDULER_RESTART_REQUIRED"
luci_schedule_rpcd_reload
for _ in $(seq 1 40); do
	grep -q 'scheduler disable' "$TRACE" 2>/dev/null && break
	/bin/sleep 0.05
done
grep -qx 'scheduler stop' "$TRACE" || fail_test "disabled subscription scheduler was not stopped after package update"
grep -qx 'scheduler disable' "$TRACE" || fail_test "disabled subscription scheduler was not disabled after package update"
[ ! -e "$LUCI_SUBSCRIPTION_SCHEDULER_RESTART_REQUIRED" ] || fail_test "successful scheduler disable did not clear its required marker"

cat > "$RPCD_SERVICE" <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
chmod +x "$RPCD_SERVICE"
: > "$LOG"
: > "$LUCI_RPCD_RELOAD_REQUIRED"
luci_schedule_rpcd_reload
for _ in $(seq 1 40); do
	grep -q 'rpcd 重新加载失败' "$LOG" 2>/dev/null && break
	/bin/sleep 0.05
done
grep -q 'rpcd 重新加载失败' "$LOG" || fail_test "failed rpcd reload was not logged"
[ -f "$LUCI_RPCD_RELOAD_REQUIRED" ] || fail_test "failed rpcd reload discarded its required marker"

rm -f "$LUCI_RPCD_RELOAD_REQUIRED"
: > "${tmp_dir}/marker-target"
ln -s "${tmp_dir}/marker-target" "$LUCI_RPCD_RELOAD_REQUIRED"
set +e
luci_schedule_rpcd_reload
reload_rc=$?
set -e
[ "$reload_rc" -ne 0 ] || fail_test "symlinked rpcd reload marker was accepted"
grep -q '延后加载标记类型无效' "$LOG" || fail_test "invalid rpcd reload marker was not logged"
rm -f "$LUCI_RPCD_RELOAD_REQUIRED"

python3 - "$helper" <<'PY'
from pathlib import Path
import re
import sys

source = Path(sys.argv[1]).read_text()
for name in ("start_one_click_update", "start_luci_update"):
    match = re.search(rf"^{name}\(\) \{{\n(.*?)(?=^\}}\n)", source, re.M | re.S)
    if not match:
        raise SystemExit(f"missing function: {name}")
    body = match.group(1)
    if body.find("write_task_done") > body.find("luci_schedule_rpcd_reload"):
        raise SystemExit(f"{name} schedules rpcd reload before durable task completion")
PY

jsonfilter() {
	local payload="" expr=""
	while [ "$#" -gt 0 ]; do
		case "$1" in
			-s) payload="$2"; shift 2 ;;
			-e) expr="$2"; shift 2 ;;
			*) shift ;;
		esac
	done
	[ "$expr" = '@.changed' ] || return 1
	if printf '%s\n' "$payload" | grep -q '"changed":true'; then
		printf 'true\n'
	elif printf '%s\n' "$payload" | grep -q '"changed":false'; then
		printf 'false\n'
	else
		return 1
	fi
}

luci_update() {
	printf 'luci_update\n' >> "$TRACE"
	printf '{"ok":true,"changed":%s,"summary":"LuCI updated"}\n' "${MOCK_LUCI_CHANGED:-true}"
}

core_installed() {
	[ "${MOCK_CORE_MISSING:-0}" != "1" ]
}

cat > "${tmp_dir}/new-helper" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >> "$TRACE"
if [ "${MOCK_SERVICE_FAIL:-0}" = "1" ]; then
	printf '{"ok":false,"code":"service_restart_failed","message":"restart failed","details":{},"next_actions":[]}\n'
	exit 1
fi
printf '{"ok":true,"service":{"running":true},"mcp":{"healthy":true}}\n'
EOF
chmod +x "${tmp_dir}/new-helper"
HELPER_SELF="${tmp_dir}/new-helper"

capture_luci_update_run() {
	set +e
	result="$(luci_update_run)"
	result_rc=$?
	set -e
}

retry_probe() {
	printf 'attempt\n' >> "$TRACE"
	[ "$(wc -l < "$TRACE" | tr -d ' ')" -ge "${RETRY_PROBE_SUCCEEDS_AT:-999}" ]
}

: > "$TRACE"
RETRY_PROBE_SUCCEEDS_AT=3
export RETRY_PROBE_SUCCEEDS_AT
luci_update_retry "测试下载" retry_probe || fail_test "retry helper did not recover on the third attempt"
unset RETRY_PROBE_SUCCEEDS_AT
[ "$(wc -l < "$TRACE" | tr -d ' ')" -eq 3 ] || fail_test "retry helper did not stop after third-attempt success"
grep -q '测试下载在第 3/3 次尝试成功' "$LOG" || fail_test "retry recovery was not logged"

: > "$TRACE"
set +e
luci_update_retry "测试下载" retry_probe
retry_rc=$?
set -e
[ "$retry_rc" -ne 0 ] || fail_test "retry helper returned success after three failures"
[ "$(wc -l < "$TRACE" | tr -d ' ')" -eq 3 ] || fail_test "retry helper exceeded the three-attempt cap"
grep -q '测试下载失败，已达到 3 次尝试上限' "$LOG" || fail_test "retry exhaustion was not logged"

: > "$TRACE"
result="$(luci_update_run)"
printf '%s\n' "$result" | grep -q '"changed":true' || fail_test "standalone LuCI update failed: $result"
printf 'luci_update\ncall service_start\n' > "${tmp_dir}/expected-trace"
diff -u "${tmp_dir}/expected-trace" "$TRACE" || fail_test "standalone LuCI update did not delegate restart to the new helper"
[ ! -e "$LOCK_DIR" ] || fail_test "successful standalone LuCI update did not clean its lock"

: > "$TRACE"
MOCK_LUCI_CHANGED=false
export MOCK_LUCI_CHANGED
result="$(luci_update_run)"
unset MOCK_LUCI_CHANGED
printf '%s\n' "$result" | grep -q '"changed":false' || fail_test "unchanged LuCI update failed: $result"
printf 'luci_update\n' > "${tmp_dir}/expected-trace"
diff -u "${tmp_dir}/expected-trace" "$TRACE" || fail_test "unchanged LuCI update restarted the service"

: > "$TRACE"
MOCK_CORE_MISSING=1
export MOCK_CORE_MISSING
result="$(luci_update_run)"
unset MOCK_CORE_MISSING
printf '%s\n' "$result" | grep -q '"changed":true' || fail_test "core-missing LuCI update failed: $result"
printf 'luci_update\n' > "${tmp_dir}/expected-trace"
diff -u "${tmp_dir}/expected-trace" "$TRACE" || fail_test "LuCI update tried to restart a missing core"

: > "$TRACE"
MOCK_SERVICE_FAIL=1
export MOCK_SERVICE_FAIL
capture_luci_update_run
unset MOCK_SERVICE_FAIL
[ "$result_rc" -ne 0 ] || fail_test "new helper service failure returned success"
printf '%s\n' "$result" | grep -q '"code":"service_restart_failed"' || fail_test "new helper service failure was not preserved: $result"
[ ! -e "$LOCK_DIR" ] || fail_test "failed standalone LuCI update did not clean its lock"

cat > "${tmp_dir}/invalid-helper" <<'EOF'
#!/bin/sh
if
EOF
chmod +x "${tmp_dir}/invalid-helper"
HELPER_SELF="${tmp_dir}/invalid-helper"
capture_luci_update_run
[ "$result_rc" -ne 0 ] || fail_test "invalid new helper returned success"
printf '%s\n' "$result" | grep -q '"code":"luci_update_helper_invalid"' || fail_test "invalid new helper was not explicit: $result"

printf 'rpcd LuCI update run tests passed\n'
