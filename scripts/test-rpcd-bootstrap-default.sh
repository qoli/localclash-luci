#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
helper="${repo_root}/openwrt/luci-app-localclash/root/usr/libexec/rpcd/localclash"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

awk '/^method="\$\{1:-\}"/ { exit } { print }' "${helper}" > "${tmp_dir}/functions.sh"
# shellcheck disable=SC1090
. "${tmp_dir}/functions.sh"

TASK_INPUT="${tmp_dir}/missing-input.json"
LOG="${tmp_dir}/helper.log"

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
	return 1
}

service_start() {
	trace "service_start"
	printf '{"ok":true}\n'
}

call_core() {
	trace "call_core $*"
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

printf 'rpcd bootstrap default tests passed\n'
