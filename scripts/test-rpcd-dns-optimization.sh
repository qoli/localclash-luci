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
while [ "$#" -gt 0 ]; do
	case "$1" in
		--output) output="$2"; shift 2 ;;
		*) shift ;;
	esac
done
[ -n "$output" ] || exit 2
cat > "$output" <<'JSON'
{
  "version": 1,
  "scope": "geosite:cn",
  "resolver": {
    "candidate_id": "dnspod-udp",
    "source": "public_provider",
    "transport": "udp",
    "endpoint": "119.29.29.29"
  },
  "measurement": {
    "report_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "report_finished_at": "2026-07-31T08:00:00Z",
    "resolv_path": "/tmp/resolv.conf.d/resolv.conf.auto",
    "generated_at": "2026-07-31T08:00:01Z"
  }
}
JSON
printf '{"output":"%s","config":{"resolver":{"candidate_id":"dnspod-udp","endpoint":"119.29.29.29"}}}\n' "$output"
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
		@.scope) sed -n 's/.*"scope": *"\([^"]*\)".*/\1/p' "${input}" ;;
		@.resolver.candidate_id) sed -n 's/.*"candidate_id": *"\([^"]*\)".*/\1/p' "${input}" ;;
		@.resolver.source) sed -n 's/.*"source": *"\([^"]*\)".*/\1/p' "${input}" ;;
		@.resolver.transport) sed -n 's/.*"transport": *"\([^"]*\)".*/\1/p' "${input}" ;;
		@.resolver.endpoint) sed -n 's/.*"endpoint": *"\([^"]*\)".*/\1/p' "${input}" ;;
		@.measurement.generated_at) sed -n 's/.*"generated_at": *"\([^"]*\)".*/\1/p' "${input}" ;;
	esac
}

call_core() {
	printf '%s\n' "$*" >> "${tmp_dir}/trace"
	case "$*" in
		config\ render\ --json)
			printf '{"ok":true,"status":{"render":{"resolver_config":{"version":1}}}}\n'
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
dnsqualify_ensure() {
	ok '"changed":false,"summary":"dnsqualify 已安装。","dnsqualify":{"installed":true,"version":"v0.1.0-41"}}'
}

: > "${tmp_dir}/trace"
result="$(dnsqualify_run)"
printf '%s\n' "$result" | grep -q '"restart_required":true' || fail_test "successful dnsqualify run did not require explicit restart: ${result}"
[ -f "${STATE_DIR}/dnsqualify.json" ] || fail_test "standalone dnsqualify config was not created"
grep -q '"candidate_id": "dnspod-udp"' "${STATE_DIR}/dnsqualify.json" || fail_test "standalone config was not preserved"
grep -q '^config render --json$' "${tmp_dir}/trace" || fail_test "Core did not consume config through normal render"
grep -q '^mihomo config-test --json$' "${tmp_dir}/trace" || fail_test "rendered config was not tested"
if grep -q '^dns ' "${tmp_dir}/trace"; then
	fail_test "LuCI called a forbidden Core DNS command"
fi

status_result="$(dnsqualify_status)"
printf '%s\n' "$status_result" | grep -q '"mode":"dnsqualify"' || fail_test "status did not report standalone config: ${status_result}"
printf '%s\n' "$status_result" | grep -q '"binary_version":"v0.1.0-41"' || fail_test "status did not report binary version: ${status_result}"

printf '{"marker":"old"}\n' > "${STATE_DIR}/dnsqualify.json"
touch "${tmp_dir}/fail-config-test"
set +e
result="$(dnsqualify_run)"
rc=$?
set -e
[ "$rc" -ne 0 ] || fail_test "failed config test returned success"
printf '%s\n' "$result" | grep -q '"code":"dnsqualify_validation_failed"' || fail_test "failed config test returned wrong error: ${result}"
grep -q '"marker":"old"' "${STATE_DIR}/dnsqualify.json" || fail_test "previous dnsqualify config was not restored"

printf 'rpcd DNS optimization tests passed\n'
