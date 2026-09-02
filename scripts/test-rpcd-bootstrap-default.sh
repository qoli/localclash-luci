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

# Minimal JSON reader for the scalar fields used by the real helper validators.
jsonfilter() {
	python3 - "$@" <<'PY'
import json
import sys

args = iter(sys.argv[1:])
value, expr = None, ""
for arg in args:
    if arg == "-i":
        with open(next(args)) as source:
            value = json.load(source)
    elif arg == "-s":
        value = json.loads(next(args))
    elif arg == "-e":
        expr = next(args)
for field in expr.removeprefix("@.").split("."):
    if not isinstance(value, dict) or field not in value:
        sys.exit(0)
    value = value[field]
print(json.dumps(value) if isinstance(value, bool) else value)
PY
}

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

write_bootstrap_subscription_input() {
	trace "write_bootstrap_subscription_input"
	[ "$subscription_input_available" = true ] || return 1
	printf '{"version":1,"uris":["https://example.com/subscription"]}\n' > "$2"
}

service_start() {
	trace "service_start"
	printf '{"ok":true}\n'
}

call_core() {
	trace "call_core $*"
	if [ "$1 $2 $3" = "config apply-template --input" ]; then
		cp "$4" "${tmp_dir}/template-input.json"
		if grep -q '"refresh_subscription":[[:space:]]*true' "$4"; then
			printf '{"ok":false,"code":"command_failed","message":"material transaction path is unavailable during bootstrap"}\n'
			return 1
		fi
		: > "${tmp_dir}/template-ready"
	elif [ "$1 $2" = "subscription set" ] && [ "${MOCK_SET_FAIL:-0}" = 1 ]; then
		printf '{"ok":false,"code":"subscription_set_failed","message":"cannot save subscription"}\n'
		return 1
	elif [ "$1 $2" = "subscription status" ]; then
		if [ "${MOCK_STATUS_FAIL:-0}" = 1 ]; then
			printf '{"ok":false,"code":"subscription_status_failed","message":"cannot read sources"}\n'
			return 1
		fi
		if [ "${MOCK_STATUS_INVALID:-0}" = 1 ]; then
			printf '{"ok":true,"status":{"merged":{"exists":false}}}\n'
		else
			printf '{"ok":true,"status":{"configured":%s,"merged":{"exists":false}}}\n' "$configured_subscription_available"
		fi
		return 0
	elif [ "$1 $2" = "subscription refresh" ]; then
		[ -f "${tmp_dir}/template-ready" ] || {
			printf '{"ok":false,"code":"missing_capability_requirements","message":"template must be imported before capability refresh"}\n'
			return 1
		}
		if [ "${MOCK_REFRESH_FAIL:-0}" = 1 ]; then
			printf '{"ok":false,"code":"capability_refresh_failed","message":"capability probe failed"}\n'
			return 1
		fi
		: > "${tmp_dir}/capabilities-ready"
	elif [ "$1 $2" = "config render" ]; then
		[ -f "${tmp_dir}/capabilities-ready" ] || {
			printf '{"ok":false,"code":"snapshot_unavailable","message":"ChatGPT capability snapshot is unavailable"}\n'
			return 1
		}
	fi
	printf '{"ok":true}\n'
}

# Heartbeat timing has its own tests; these cases test the bootstrap dependency order.
run_with_heartbeat() {
	local output="$2"
	shift 2
	"$@" > "$output"
}

run_with_heartbeat_until_complete() {
	run_with_heartbeat "$@"
}

runtime_start_takeover_run() {
	trace "runtime_start_takeover_run $*"
	printf '{"ok":true}\n'
}

assert_refresh_order() {
	grep -q '"refresh_subscription":[[:space:]]*false' "${tmp_dir}/template-input.json" || fail_test "bootstrap requested an existing-material transaction"
	[ "$(grep -c '^call_core subscription refresh --json$' "${tmp_dir}/trace")" = 1 ] || fail_test "bootstrap must refresh subscriptions and capabilities exactly once"
	apply_line="$(grep -n '^call_core config apply-template ' "${tmp_dir}/trace" | cut -d: -f1)"
	capability_line="$(grep -n '^call_core subscription refresh --json$' "${tmp_dir}/trace" | cut -d: -f1)"
	render_line="$(grep -n '^call_core config render --json$' "${tmp_dir}/trace" | cut -d: -f1)"
	[ -n "$apply_line" ] && [ -n "$capability_line" ] && [ -n "$render_line" ] || fail_test "bootstrap capability refresh trace is incomplete"
	[ "$apply_line" -lt "$capability_line" ] && [ "$capability_line" -lt "$render_line" ] || fail_test "bootstrap did not refresh capabilities between template apply and render"
}

: > "${tmp_dir}/trace"
result="$(bootstrap_default_run)"

printf '%s\n' "$result" | grep -q '"ok":true' || fail_test "bootstrap_default_run did not succeed: ${result}"

first_call="$(sed -n '1p' "${tmp_dir}/trace")"
[ "$first_call" = "bootstrap_core" ] || fail_test "first bootstrap step = ${first_call}, want bootstrap_core"

if ! grep -Eq '^call_core config apply-template --input .*/template\.json --json$' "${tmp_dir}/trace"; then
	fail_test "config apply-template was not called"
fi

assert_refresh_order
set_line="$(grep -n '^call_core subscription set ' "${tmp_dir}/trace" | cut -d: -f1)"
[ -n "$set_line" ] && [ "$set_line" -lt "$apply_line" ] || fail_test "new subscription was not saved before template import"

: > "${tmp_dir}/trace"
rm -f "${tmp_dir}/template-ready" "${tmp_dir}/capabilities-ready"
subscription_input_available=false
configured_subscription_available=true
result="$(bootstrap_default_run)"

printf '%s\n' "$result" | grep -q '"ok":true' || fail_test "existing-subscription bootstrap did not succeed: ${result}"
assert_refresh_order
grep -q '^call_core subscription set ' "${tmp_dir}/trace" && fail_test "saved subscription was unexpectedly replaced"

: > "${tmp_dir}/trace"
rm -f "${tmp_dir}/template-ready" "${tmp_dir}/capabilities-ready"
configured_subscription_available=false
result="$(bootstrap_default_run)"
printf '%s\n' "$result" | grep -q '"ok":true' || fail_test "bootstrap without subscriptions failed: ${result}"
grep -Eq '^call_core (subscription refresh|config render)|^runtime_start_takeover_run' "${tmp_dir}/trace" && fail_test "bootstrap without subscriptions attempted runtime material or startup"

for subscription_input_available in true false; do
	: > "${tmp_dir}/trace"
	rm -f "${tmp_dir}/template-ready" "${tmp_dir}/capabilities-ready"
	configured_subscription_available=true
	MOCK_REFRESH_FAIL=1
	if result="$(bootstrap_default_run)"; then
		fail_test "capability refresh failure returned success"
	fi
	unset MOCK_REFRESH_FAIL
	printf '%s\n' "$result" | grep -q '"code":"capability_refresh_failed"' || fail_test "capability refresh cause was lost: ${result}"
	grep -Eq '^call_core config render|^service_start|^runtime_start_takeover_run' "${tmp_dir}/trace" && fail_test "bootstrap continued after capability refresh failure"
done

: > "${tmp_dir}/trace"
subscription_input_available=true
MOCK_SET_FAIL=1
if result="$(bootstrap_default_run)"; then
	fail_test "subscription save failure returned success"
fi
unset MOCK_SET_FAIL
printf '%s\n' "$result" | grep -q '"code":"subscription_set_failed"' || fail_test "subscription save cause was lost: ${result}"
grep -Eq '^call_core (config apply-template|subscription refresh|config render)|^runtime_start_takeover_run' "${tmp_dir}/trace" && fail_test "bootstrap continued after subscription save failure"

subscription_input_available=false
for status_failure in MOCK_STATUS_FAIL MOCK_STATUS_INVALID; do
	: > "${tmp_dir}/trace"
	printf -v "$status_failure" 1
	if result="$(bootstrap_default_run)"; then
		fail_test "invalid subscription status returned success"
	fi
	unset "$status_failure"
	printf '%s\n' "$result" | grep -Eq '"code":"subscription_status_(failed|invalid)"' || fail_test "subscription status failure was hidden: ${result}"
	grep -Eq '^call_core (subscription refresh|config render)|^service_start|^runtime_start_takeover_run' "${tmp_dir}/trace" && fail_test "bootstrap continued after subscription status failure"
done

printf 'rpcd bootstrap default tests passed\n'
