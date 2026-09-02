#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
helper="${repo_root}/openwrt/luci-app-localclash/root/usr/libexec/rpcd/localclash"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

awk '/^method="\$\{1:-\}"/ { exit } { print }' "${helper}" > "${tmp_dir}/functions.sh"
# shellcheck disable=SC1090
. "${tmp_dir}/functions.sh"

TASK_INPUT="${tmp_dir}/bootstrap-input.json"
LOG="${tmp_dir}/helper.log"
subscription_input_available=true
configured_subscription_available=false

trace() {
	printf '%s\n' "$1" >> "${tmp_dir}/trace"
}

fail_test() {
	printf 'test-rpcd-bootstrap-default: %s\n' "$*" >&2
	exit 1
}

core_installed() {
	trace "core_installed"
	return 0
}

bootstrap_core() {
	trace "bootstrap_core"
	printf '{"ok":true,"changed":true}\n'
}

base_assets_installed() {
	trace "base_assets_installed"
	return 0
}

mihomo_core_installed() {
	trace "mihomo_core_installed"
	return 0
}

dashboard_installed() {
	trace "dashboard_installed"
	return 0
}

subscription_configured() {
	trace "subscription_configured"
	[ "$configured_subscription_available" = true ]
}

write_bootstrap_subscription_input() {
	trace "write_bootstrap_subscription_input"
	[ "$subscription_input_available" = true ] || return 1
	printf '{"version":1,"uris":["https://example.com/subscription"]}\n' > "$2"
}

subscription_save_refresh_file() {
	trace "subscription_save_refresh_file"
	printf '{"ok":true}\n'
}

service_start() {
	trace "service_start"
	printf '{"ok":true}\n'
}

call_core() {
	trace "call_core $*"
	if [ "$1 $2 $3" = "config apply-template --input" ]; then
		cp "$4" "${tmp_dir}/template-input.json"
	fi
	printf '{"ok":true}\n'
}

runtime_start_takeover_run() {
	trace "runtime_start_takeover_run $*"
	printf '{"ok":true}\n'
}

: > "${tmp_dir}/trace"
result="$(bootstrap_default_run)"

printf '%s\n' "$result" | grep -q '"ok":true' || fail_test "bootstrap_default_run did not succeed: ${result}"

first_call="$(sed -n '1p' "${tmp_dir}/trace")"
[ "$first_call" = "bootstrap_core" ] || fail_test "first bootstrap step = ${first_call}, want bootstrap_core"

if ! grep -Eq '^call_core config apply-template --input .*/template\.json --json$' "${tmp_dir}/trace"; then
	fail_test "config apply-template was not called"
fi

grep -q '"refresh_subscription":[[:space:]]*false' "${tmp_dir}/template-input.json" || fail_test "newly refreshed subscription requested a duplicate transactional refresh"

: > "${tmp_dir}/trace"
subscription_input_available=false
configured_subscription_available=true
result="$(bootstrap_default_run)"

printf '%s\n' "$result" | grep -q '"ok":true' || fail_test "existing-subscription bootstrap did not succeed: ${result}"
grep -q '"refresh_subscription":[[:space:]]*true' "${tmp_dir}/template-input.json" || fail_test "existing subscription did not retain the transactional refresh"

printf 'rpcd bootstrap default tests passed\n'
