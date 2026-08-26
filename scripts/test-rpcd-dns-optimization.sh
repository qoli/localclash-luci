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
report_output=""
ecs_interface=""
ecs_doh_proxy=""
while [ "$#" -gt 0 ]; do
	case "$1" in
		--output) output="$2"; shift 2 ;;
		--report-output) report_output="$2"; shift 2 ;;
		--ecs-interface) ecs_interface="$2"; shift 2 ;;
		--ecs-doh-proxy) ecs_doh_proxy="$2"; shift 2 ;;
		*) shift ;;
	esac
done
[ -n "$output" ] || exit 2
[ -n "$report_output" ] || exit 3
[ "$ecs_interface" = "wan-test" ] || exit 4
[ "$ecs_doh_proxy" = "http://127.0.0.1:7894" ] || exit 5
printf '2026-08-01T06:16:32+08:00 dnsqualify 进度：仍在运行：正在进行 DNS 基础测试，第 1/3 轮；已用时 15 秒\n' >&2
cat > "$output" <<'JSON'
{
  "version": 2,
  "expires_at": "2026-07-31T08:30:01Z",
  "nameserver_policy": {
    "cdn.fastly.steamstatic.com": ["https://8.8.8.8/dns-query#DNSProxy&ecs=114.114.114.0/24&ecs-override=true"],
    "devstreaming-cdn.apple.com": ["https://8.8.8.8/dns-query#DNSProxy&ecs=114.114.114.0/24&ecs-override=true"]
  }
}
JSON
cat > "$report_output" <<'JSON'
{"version":1,"measurement":{"finished_at":"2026-07-31T08:00:00Z","service_catalog":{"id":"mainland-known-services-v2"}},"selection":{"selected_id":"google-doh-wan-ecs","candidates":[{"id":"google-doh-wan-ecs","source":"global_encrypted_ecs","transport":"doh","endpoint":"https://8.8.8.8/dns-query","ecs_prefix":"114.114.114.0/24","ecs_source":"stun_xor_mapped_address_mainland","ecs_interface":"wan-test","ecs_server":"stun.chat.bilibili.com:3478","ecs_server_ip":"106.12.251.193"}]},"selected":{"id":"google-doh-wan-ecs","source":"global_encrypted_ecs","transport":"doh","endpoint":"https://8.8.8.8/dns-query","ecs_prefix":"114.114.114.0/24","ecs_source":"stun_xor_mapped_address_mainland","ecs_interface":"wan-test","ecs_server":"stun.chat.bilibili.com:3478","ecs_server_ip":"106.12.251.193"},"expires_at":"2026-07-31T08:30:01Z"}
JSON
printf '{"output":"%s","recommended_id":"google-doh-wan-ecs"}\n' "$output"
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
		@.expires_at) sed -n 's/.*"expires_at": *"\([^"]*\)".*/\1/p' "${input}" ;;
		@.selection.selected_id) sed -n 's/.*"selected_id": *"\([^"]*\)".*/\1/p' "${input}" ;;
		@.measurement.service_catalog.id) sed -n 's/.*"service_catalog": *{"id": *"\([^"]*\)".*/\1/p' "${input}" ;;
		@.measurement.finished_at) sed -n 's/.*"finished_at": *"\([^"]*\)".*/\1/p' "${input}" ;;
		@.selected.ecs_source) sed -n 's/.*"selected":.*"ecs_source": *"\([^"]*\)".*/\1/p' "${input}" ;;
		@.selected.ecs_interface) sed -n 's/.*"selected":.*"ecs_interface": *"\([^"]*\)".*/\1/p' "${input}" ;;
		@.selected.ecs_server_ip) sed -n 's/.*"selected":.*"ecs_server_ip": *"\([^"]*\)".*/\1/p' "${input}" ;;
		@.selected.ecs_server) sed -n 's/.*"selected":.*"ecs_server": *"\([^"]*\)".*/\1/p' "${input}" ;;
		@.selected.ecs_country_code) sed -n 's/.*"selected":.*"ecs_country_code": *"\([^"]*\)".*/\1/p' "${input}" ;;
		@.selected.ecs_prefix) sed -n 's/.*"selected":.*"ecs_prefix": *"\([^"]*\)".*/\1/p' "${input}" ;;
		@.selected.transport) sed -n 's/.*"selected":.*"transport": *"\([^"]*\)".*/\1/p' "${input}" ;;
		@.selected.endpoint) sed -n 's/.*"selected":.*"endpoint": *"\([^"]*\)".*/\1/p' "${input}" ;;
		@.selected.source) sed -n 's/.*"selected":.*"source": *"\([^"]*\)".*/\1/p' "${input}" ;;
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
[ "$(dnsqualify_timestamp_epoch '2026-08-26T09:00:00Z')" = "1787734800" ] || fail_test "UTC RFC3339 timestamp was not parsed"
[ "$(dnsqualify_timestamp_epoch '2026-08-26T17:00:00.123456789+08:00')" = "1787734800" ] || fail_test "fractional offset RFC3339 timestamp was not parsed"
if dnsqualify_timestamp_epoch '2026-08-26 17:00:00' >/dev/null 2>&1; then
	fail_test "non-RFC3339 timestamp was unexpectedly accepted"
fi
dnsqualify_ensure() {
	ok '"changed":false,"summary":"dnsqualify 已安装。","dnsqualify":{"installed":true,"version":"v0.1.0-41"}}'
}

: > "${tmp_dir}/trace"
result="$(dnsqualify_run)"
printf '%s\n' "$result" | grep -q '"restart_required":true' || fail_test "successful dnsqualify run did not require explicit restart: ${result}"
[ -f "${STATE_DIR}/dnsqualify.json" ] || fail_test "standalone dnsqualify config was not created"
[ -f "${STATE_DIR}/dnsqualify-report.json" ] || fail_test "dnsqualify evidence report was not published"
grep -q '"nameserver_policy"' "${STATE_DIR}/dnsqualify.json" || fail_test "Core overlay was not preserved"
if grep -Eq 'candidate_id|ecs_source|country_code|server_ip|interface' "${STATE_DIR}/dnsqualify.json"; then
	fail_test "Core overlay leaked dnsqualify implementation provenance"
fi
grep -q '"selected_id":"google-doh-wan-ecs"' "${STATE_DIR}/dnsqualify-report.json" || fail_test "selection provenance was not kept in the report"
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

cp "${STATE_DIR}/dnsqualify-report.json" "${tmp_dir}/stun-report.json"
sed -e 's/stun_xor_mapped_address_mainland/https_json_ipapi_is/g' \
	-e 's/stun.chat.bilibili.com:3478/api.ipapi.is:443/g' \
	-e 's/106.12.251.193/5.223.55.72/g' \
	-e 's/"ecs_server_ip":"5.223.55.72"/"ecs_server_ip":"5.223.55.72","ecs_country_code":"CN"/g' \
	"${tmp_dir}/stun-report.json" > "${STATE_DIR}/dnsqualify-report.json"
status_result="$(dnsqualify_status)"
printf '%s\n' "$status_result" | grep -q '"source":"https_json_ipapi_is"' || fail_test "status did not report JSON observation source: ${status_result}"
printf '%s\n' "$status_result" | grep -q '"country_code":"CN"' || fail_test "status did not report strict JSON country code: ${status_result}"
sed 's/"ecs_country_code":"CN"/"ecs_country_code":"HK"/g' "${STATE_DIR}/dnsqualify-report.json" > "${tmp_dir}/non-cn.json"
mv "${tmp_dir}/non-cn.json" "${STATE_DIR}/dnsqualify-report.json"
status_result="$(dnsqualify_status)"
printf '%s\n' "$status_result" | grep -q '"country_code":"HK"' || fail_test "LuCI did not remain a presentation-only report reader"
cp "${tmp_dir}/stun-report.json" "${STATE_DIR}/dnsqualify-report.json"

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
