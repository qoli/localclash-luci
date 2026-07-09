#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
helper="${repo_root}/openwrt/luci-app-localclash/root/usr/libexec/rpcd/localclash"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

awk '/^method="\$\{1:-\}"/ { exit } { print }' "${helper}" > "${tmp_dir}/functions.sh"
# shellcheck disable=SC1090
. "${tmp_dir}/functions.sh"

CORE="${tmp_dir}/localclash"
SERVICE="${tmp_dir}/localclash-mcp"
SERVICE_TRACE="${tmp_dir}/service-trace"
HEALTH_COUNT="${tmp_dir}/health-count"
export SERVICE_TRACE
printf 'core\n' > "$CORE"
chmod +x "$CORE"

cat > "$SERVICE" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >> "$SERVICE_TRACE"
case "$*" in
	enable) exit 0 ;;
	restart) [ "${MOCK_RESTART_FAIL:-0}" != "1" ] ;;
	"running mcp") [ "${MOCK_INSTANCE_STOPPED:-0}" != "1" ] ;;
	*) exit 1 ;;
esac
EOF
chmod +x "$SERVICE"

fail_test() {
	printf 'test-rpcd-service-start: %s\n' "$*" >&2
	exit 1
}

service_ensure() {
	if [ "${MOCK_ENSURE_FAIL:-0}" = "1" ]; then
		printf '{"ok":false,"code":"service_script_write_failed","message":"write failed","details":{},"next_actions":[]}\n'
		return 1
	fi
}

core_installed() {
	return 0
}

sleep() {
	printf 'sleep\n' >> "$SERVICE_TRACE"
}

mcp_health_body() {
	local count
	count=0
	[ ! -f "$HEALTH_COUNT" ] || count="$(cat "$HEALTH_COUNT")"
	count=$((count + 1))
	printf '%s\n' "$count" > "$HEALTH_COUNT"
	if [ "$count" -ge "${MOCK_HEALTHY_AFTER:-1}" ]; then
		printf '{"status":"ok"}\n'
		return 0
	fi
	return 1
}

service_status() {
	if [ "${MOCK_STATUS_UNHEALTHY:-0}" = "1" ]; then
		printf '{"ok":true,"service":{"running":false},"mcp":{"healthy":false}}\n'
	else
		printf '{"ok":true,"service":{"running":true},"mcp":{"healthy":true}}\n'
	fi
}

jsonfilter() {
	local payload="" expr=""
	while [ "$#" -gt 0 ]; do
		case "$1" in
			-s) payload="$2"; shift 2 ;;
			-e) expr="$2"; shift 2 ;;
			*) shift ;;
		esac
	done
	case "$expr:$payload" in
		'@.service.running:'*'"running":true'*) printf 'true\n' ;;
		'@.service.running:'*'"running":false'*) printf 'false\n' ;;
		'@.mcp.healthy:'*'"healthy":true'*) printf 'true\n' ;;
		'@.mcp.healthy:'*'"healthy":false'*) printf 'false\n' ;;
		*) return 1 ;;
	esac
}

capture_service_start() {
	set +e
	result="$(service_start)"
	result_rc=$?
	set -e
}

MCP_HEALTH_ATTEMPTS=3
: > "$SERVICE_TRACE"
rm -f "$HEALTH_COUNT"
MOCK_HEALTHY_AFTER=3
export MOCK_HEALTHY_AFTER
result="$(service_start)"
unset MOCK_HEALTHY_AFTER
printf '%s\n' "$result" | grep -q '"ok":true' || fail_test "service start failed: $result"
printf 'enable\nrestart\nsleep\nrunning mcp\nsleep\nrunning mcp\nsleep\nrunning mcp\n' > "${tmp_dir}/expected-trace"
diff -u "${tmp_dir}/expected-trace" "$SERVICE_TRACE" || fail_test "service restart or health polling order mismatch"
[ "$(cat "$HEALTH_COUNT")" = "3" ] || fail_test "health probe count mismatch"

: > "$SERVICE_TRACE"
rm -f "$HEALTH_COUNT"
MOCK_RESTART_FAIL=1
export MOCK_RESTART_FAIL
capture_service_start
unset MOCK_RESTART_FAIL
[ "$result_rc" -ne 0 ] || fail_test "restart failure returned success"
printf '%s\n' "$result" | grep -q '"code":"service_restart_failed"' || fail_test "restart failure was not explicit: $result"
[ ! -f "$HEALTH_COUNT" ] || fail_test "health probe ran after restart failure"
printf 'enable\nrestart\n' > "${tmp_dir}/expected-trace"
diff -u "${tmp_dir}/expected-trace" "$SERVICE_TRACE" || fail_test "restart failure used a start or readiness fallback"

: > "$SERVICE_TRACE"
rm -f "$HEALTH_COUNT"
MOCK_HEALTHY_AFTER=4
export MOCK_HEALTHY_AFTER
capture_service_start
unset MOCK_HEALTHY_AFTER
[ "$result_rc" -ne 0 ] || fail_test "health timeout returned success"
printf '%s\n' "$result" | grep -q '"code":"mcp_health_timeout"' || fail_test "health timeout was not explicit: $result"
[ "$(cat "$HEALTH_COUNT")" = "3" ] || fail_test "health timeout exceeded its attempt bound"

MCP_HEALTH_ATTEMPTS=invalid
capture_service_start
[ "$result_rc" -ne 0 ] || fail_test "invalid health attempt count returned success"
printf '%s\n' "$result" | grep -q '"code":"mcp_health_attempts_invalid"' || fail_test "invalid health attempt count was not explicit: $result"

MCP_HEALTH_ATTEMPTS=3
: > "$SERVICE_TRACE"
rm -f "$HEALTH_COUNT"
MOCK_STATUS_UNHEALTHY=1
export MOCK_STATUS_UNHEALTHY
capture_service_start
unset MOCK_STATUS_UNHEALTHY
[ "$result_rc" -ne 0 ] || fail_test "unhealthy service status returned success"
printf '%s\n' "$result" | grep -q '"code":"mcp_health_timeout"' || fail_test "unhealthy service status was not bounded: $result"
[ "$(cat "$HEALTH_COUNT")" = "3" ] || fail_test "unhealthy service status did not use the readiness bound"

: > "$SERVICE_TRACE"
rm -f "$HEALTH_COUNT"
MOCK_INSTANCE_STOPPED=1
export MOCK_INSTANCE_STOPPED
capture_service_start
unset MOCK_INSTANCE_STOPPED
[ "$result_rc" -ne 0 ] || fail_test "stopped procd instance returned success"
printf '%s\n' "$result" | grep -q '"code":"mcp_health_timeout"' || fail_test "stopped procd instance was not bounded: $result"
[ ! -f "$HEALTH_COUNT" ] || fail_test "health probe ran while the procd mcp instance was stopped"

: > "$SERVICE_TRACE"
MOCK_ENSURE_FAIL=1
export MOCK_ENSURE_FAIL
capture_service_start
unset MOCK_ENSURE_FAIL
[ "$result_rc" -ne 0 ] || fail_test "service ensure failure returned success"
printf '%s\n' "$result" | grep -q '"code":"service_script_write_failed"' || fail_test "service ensure failure was not preserved: $result"
[ ! -s "$SERVICE_TRACE" ] || fail_test "service actions ran after service ensure failure"

printf 'rpcd service start tests passed\n'
