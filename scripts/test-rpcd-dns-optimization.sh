#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
helper="${repo_root}/openwrt/luci-app-localclash/root/usr/libexec/rpcd/localclash"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

awk '/^method="\$\{1:-\}"/ { exit } { print }' "${helper}" > "${tmp_dir}/functions.sh"
# shellcheck disable=SC1090
. "${tmp_dir}/functions.sh"

STATE_DIR="${tmp_dir}/state"
LOG="${tmp_dir}/helper.log"
DNSQUALIFY="${tmp_dir}/dnsqualify"
mkdir -p "${STATE_DIR}"

cat > "${DNSQUALIFY}" <<'SH'
#!/bin/sh
if [ "${1:-}" = "--version" ]; then
	printf 'dnsqualify v0.1.0-41\n'
	exit 0
fi
output=""
ecs_interface=""
while [ "$#" -gt 0 ]; do
	case "$1" in
		--output) output="$2"; shift 2 ;;
		--ecs-interface) ecs_interface="$2"; shift 2 ;;
		*) shift ;;
	esac
done
[ -n "$output" ] || exit 2
[ "$ecs_interface" = "wan-test" ] || exit 4
printf '2026-08-01T06:16:32+08:00 dnsqualify 进度：仍在运行：正在进行 DNS 基础测试，第 1/3 轮；已用时 15 秒\n' >&2
cat > "$output" <<'JSON'
{
  "version": 2,
  "scope": {
    "type": "domains",
    "id": "mainland-known-services-v2",
    "domains": ["cdn.fastly.steamstatic.com", "devstreaming-cdn.apple.com"],
    "domain_sha256": "7613f0e62ec3d87bcb963e2d471b33983002f538c239771a7195d22447b3078a"
  },
  "resolver": {
    "candidate_id": "google-doh-wan-ecs",
    "source": "global_encrypted_ecs",
    "transport": "doh",
    "endpoint": "https://8.8.8.8/dns-query",
    "proxy": "DNSProxy"
  },
  "ecs": {"prefix": "114.114.114.0/24", "source": "stun_xor_mapped_address_mainland", "interface": "wan-test", "server": "stun.chat.bilibili.com:3478", "server_ip": "106.12.251.193"},
  "measurement": {
    "report_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "report_finished_at": "2026-07-31T08:00:00Z",
    "resolv_path": "/tmp/resolv.conf.d/resolv.conf.auto",
    "generated_at": "2026-07-31T08:00:01Z",
    "expires_at": "2026-07-31T08:30:01Z"
  }
}
JSON
printf '{"output":"%s","config":{"resolver":{"candidate_id":"google-doh-wan-ecs","endpoint":"https://8.8.8.8/dns-query"}}}\n' "$output"
SH
chmod +x "${DNSQUALIFY}"

fail_test() {
	printf 'test-rpcd-dns-optimization: %s\n' "$*" >&2
	exit 1
}

resolve_state_dir() {
	printf '%s\n' "${STATE_DIR}"
}

jsonfilter() {
	local input expression
	while [ "$#" -gt 0 ]; do
		case "$1" in
			-i) input="$2"; shift 2 ;;
			-e) expression="$2"; shift 2 ;;
			*) shift ;;
		esac
	done
	case "${expression:-}" in
		@.version) sed -n 's/.*"version": *\([0-9][0-9]*\).*/\1/p' "${input}" ;;
		@.scope.type) sed -n 's/.*"type": *"\([^"]*\)".*/\1/p' "${input}" ;;
		@.scope.id) sed -n 's/.*"id": *"\([^"]*\)".*/\1/p' "${input}" ;;
		@.resolver.candidate_id) sed -n 's/.*"candidate_id": *"\([^"]*\)".*/\1/p' "${input}" ;;
		@.resolver.source) sed -n 's/.*"source": *"\([^"]*\)".*/\1/p' "${input}" ;;
		@.resolver.transport) sed -n 's/.*"transport": *"\([^"]*\)".*/\1/p' "${input}" ;;
		@.resolver.endpoint) sed -n 's/.*"endpoint": *"\([^"]*\)".*/\1/p' "${input}" ;;
		@.ecs.prefix) sed -n 's/.*"ecs":.*"prefix": *"\([^"]*\)".*/\1/p' "${input}" ;;
		@.ecs.source) sed -n 's/.*"ecs":.*"source": *"\([^"]*\)".*/\1/p' "${input}" ;;
		@.ecs.interface) sed -n 's/.*"ecs":.*"interface": *"\([^"]*\)".*/\1/p' "${input}" ;;
		@.ecs.server) sed -n 's/.*"ecs":.*"server": *"\([^"]*\)".*/\1/p' "${input}" ;;
		@.ecs.server_ip) sed -n 's/.*"ecs":.*"server_ip": *"\([^"]*\)".*/\1/p' "${input}" ;;
		@.measurement.generated_at) sed -n 's/.*"generated_at": *"\([^"]*\)".*/\1/p' "${input}" ;;
		@.measurement.expires_at) sed -n 's/.*"expires_at": *"\([^"]*\)".*/\1/p' "${input}" ;;
	esac
}

call_core() {
	printf '%s\n' "$*" >> "${tmp_dir}/trace"
	case "$*" in
		config\ render\ --json)
			printf '{"ok":true,"status":{"render":{"resolver_config":{"version":2}}}}\n'
			;;
		mihomo\ config-test\ --json)
			if [ -f "${tmp_dir}/fail-config-test" ]; then
				rm -f "${tmp_dir}/fail-config-test"
				return 1
			fi
			printf '{"ok":true,"status":{"passed":true}}\n'
			;;
		*)
			return 1
			;;
	esac
}

installed_dnsqualify="${DNSQUALIFY}"
DNSQUALIFY="${tmp_dir}/missing-dnsqualify"
dnsqualify_ensure() {
	fail "dnsqualify_manifest_download_failed" "无法下载 dnsqualify Release 清单。"
	return 1
}
set +e
missing_result="$(dnsqualify_run)"
missing_rc=$?
set -e
[ "$missing_rc" -ne 0 ] || fail_test "missing standalone binary returned success"
printf '%s\n' "$missing_result" | grep -q '"code":"dnsqualify_manifest_download_failed"' || fail_test "missing binary install failure returned wrong error: ${missing_result}"
DNSQUALIFY="${installed_dnsqualify}"

network_get_ipaddr() {
	fail_test "network_get_ipaddr must not be used as public ECS identity"
}
network_get_device() {
	DNSQUALIFY_ECS_INTERFACE="wan-test"
}
network_flush_cache() {
	:
}
dnsqualify_wan_ecs
[ "$DNSQUALIFY_ECS_INTERFACE" = "wan-test" ] || fail_test "WAN device identity was not preserved"
dnsqualify_ensure() {
	ok '"changed":false,"summary":"dnsqualify 已安装。","dnsqualify":{"installed":true,"version":"v0.1.0-41"}}'
}

: > "${tmp_dir}/trace"
result="$(dnsqualify_run)"
printf '%s\n' "$result" | grep -q '"restart_required":true' || fail_test "successful dnsqualify run did not require explicit restart: ${result}"
[ -f "${STATE_DIR}/dnsqualify.json" ] || fail_test "standalone dnsqualify config was not created"
grep -q '"candidate_id": "google-doh-wan-ecs"' "${STATE_DIR}/dnsqualify.json" || fail_test "standalone config was not preserved"
grep -q '^config render --json$' "${tmp_dir}/trace" || fail_test "Core did not consume config through normal render"
grep -q '^mihomo config-test --json$' "${tmp_dir}/trace" || fail_test "rendered config was not tested"
grep -q 'dnsqualify 进度：仍在运行' "${LOG}" || fail_test "dnsqualify stderr progress was not preserved in the live task log"
if grep -q '^dns ' "${tmp_dir}/trace"; then
	fail_test "LuCI called a forbidden Core DNS command"
fi

dnsqualify_timestamp_epoch() { printf '200\n'; }
dnsqualify_now_epoch() { printf '100\n'; }
status_result="$(dnsqualify_status)"
printf '%s\n' "$status_result" | grep -q '"mode":"qualified_ecs"' || fail_test "status did not report standalone config: ${status_result}"
printf '%s\n' "$status_result" | grep -q '"prefix":"114.114.114.0/24"' || fail_test "status did not report ECS prefix: ${status_result}"
printf '%s\n' "$status_result" | grep -q '"source":"stun_xor_mapped_address_mainland"' || fail_test "status did not report STUN observation provenance: ${status_result}"
printf '%s\n' "$status_result" | grep -q '"server":"stun.chat.bilibili.com:3478"' || fail_test "status did not report mainland STUN server: ${status_result}"
printf '%s\n' "$status_result" | grep -q '"binary_version":"v0.1.0-41"' || fail_test "status did not report binary version: ${status_result}"

dnsqualify_timestamp_epoch() { printf '50\n'; }
status_result="$(dnsqualify_status)"
printf '%s\n' "$status_result" | grep -q '"enabled":false' || fail_test "expired optimization remained enabled: ${status_result}"
printf '%s\n' "$status_result" | grep -q '"disabled_reason":"expired"' || fail_test "expired optimization did not report its disabled reason: ${status_result}"
printf '%s\n' "$status_result" | grep -q '"retained_config":true' || fail_test "expired status did not report retained evidence: ${status_result}"

printf '{"marker":"wan-stable"}\n' > "${STATE_DIR}/dnsqualify.json"
ecs_read_count=0
dnsqualify_wan_ecs() {
	ecs_read_count=$((ecs_read_count + 1))
	if [ "$ecs_read_count" -eq 1 ]; then
		DNSQUALIFY_ECS_INTERFACE="wan-test"
	else
		DNSQUALIFY_ECS_INTERFACE="wan-changed"
	fi
}
set +e
result="$(dnsqualify_run)"
rc=$?
set -e
[ "$rc" -ne 0 ] || fail_test "WAN change during qualification returned success"
printf '%s\n' "$result" | grep -q '"code":"dnsqualify_wan_changed"' || fail_test "WAN change returned wrong error: ${result}"
grep -q '"marker":"wan-stable"' "${STATE_DIR}/dnsqualify.json" || fail_test "WAN change did not restore previous config"

dnsqualify_wan_ecs() {
	DNSQUALIFY_ECS_ADDRESS="114.114.114.114"
	DNSQUALIFY_ECS_INTERFACE="wan-test"
}
printf '{"marker":"old"}\n' > "${STATE_DIR}/dnsqualify.json"
touch "${tmp_dir}/fail-config-test"
set +e
result="$(dnsqualify_run)"
rc=$?
set -e
[ "$rc" -ne 0 ] || fail_test "failed config test returned success"
printf '%s\n' "$result" | grep -q '"code":"dnsqualify_validation_failed"' || fail_test "failed config test returned wrong error: ${result}"
grep -q '"marker":"old"' "${STATE_DIR}/dnsqualify.json" || fail_test "previous dnsqualify config was not restored"

list_result="$("${helper}" list)"
printf '%s\n' "$list_result" | grep -q '"dnsqualify_run_async": {}' || fail_test "rpcd list exposed an unexpected public-address input"

printf 'rpcd DNS optimization tests passed\n'
