#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
helper="${repo_root}/openwrt/luci-app-localclash/root/usr/libexec/rpcd/localclash"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

awk '/^method="\$\{1:-\}"/ { exit } { print }' "${helper}" > "${tmp_dir}/functions.sh"
# shellcheck disable=SC1090
. "${tmp_dir}/functions.sh"

SERVICE="${tmp_dir}/localclash-mcp"
SERVICE_TRACE="${tmp_dir}/service-trace"
HEALTH_TRACE="${tmp_dir}/health-trace"
export SERVICE_TRACE

cat > "$SERVICE" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >> "$SERVICE_TRACE"
case "$*" in
	enabled) exit 0 ;;
	"running mcp") [ "${MOCK_MCP_STOPPED:-0}" != "1" ] ;;
	running) exit 99 ;;
	*) exit 1 ;;
esac
EOF
chmod +x "$SERVICE"

fail_test() {
	printf 'test-rpcd-service-status: %s\n' "$*" >&2
	exit 1
}

mcp_endpoint() {
	printf 'http://127.0.0.1:8765/mcp\n'
}

mcp_health_body() {
	printf 'probe\n' >> "$HEALTH_TRACE"
	printf '{"status":"ok"}\n'
}

: > "$SERVICE_TRACE"
rm -f "$HEALTH_TRACE"
result="$(service_body)"
printf '%s\n' "$result" | grep -q '"running":true' || fail_test "running mcp instance was not reported: $result"
printf '%s\n' "$result" | grep -q '"healthy":true' || fail_test "running mcp instance was not health checked: $result"
printf '%s\n' "$result" | grep -q '"pid":0' || fail_test "service status should not infer a PID: $result"
grep -qx 'running mcp' "$SERVICE_TRACE" || fail_test "service status did not query the mcp procd instance"
grep -qx 'running' "$SERVICE_TRACE" && fail_test "service status queried aggregate service state"
[ "$(wc -l < "$HEALTH_TRACE" | tr -d ' ')" = "1" ] || fail_test "running mcp instance was not probed exactly once"

: > "$SERVICE_TRACE"
rm -f "$HEALTH_TRACE"
MOCK_MCP_STOPPED=1
export MOCK_MCP_STOPPED
result="$(service_body)"
unset MOCK_MCP_STOPPED
printf '%s\n' "$result" | grep -q '"running":false' || fail_test "stopped mcp instance was reported running: $result"
printf '%s\n' "$result" | grep -q '"healthy":false' || fail_test "stopped mcp instance was reported healthy: $result"
[ ! -e "$HEALTH_TRACE" ] || fail_test "health probe ran for a stopped mcp instance"

printf 'rpcd service status tests passed\n'
