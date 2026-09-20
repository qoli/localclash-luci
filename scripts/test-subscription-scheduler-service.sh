#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
helper="${repo_root}/openwrt/luci-app-localclash/root/usr/libexec/rpcd/localclash"
init_script="${repo_root}/openwrt/luci-app-localclash/root/etc/init.d/localclash-subscription-scheduler"
worker="${repo_root}/openwrt/luci-app-localclash/root/usr/libexec/localclash/subscription-scheduler"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

mkdir -p "${tmp_dir}/bin"
PATH="${tmp_dir}/bin:${PATH}"

cat > "${tmp_dir}/bin/jsonfilter" <<'EOF'
#!/usr/bin/env python3
import json, sys
args = sys.argv[1:]
source = expression = None
while args:
    option = args.pop(0)
    if option == '-i': source = open(args.pop(0), encoding='utf-8').read()
    elif option == '-s': source = args.pop(0)
    elif option == '-e': expression = args.pop(0)
value = json.loads(source)
for key in expression[2:].split('.'):
    if not isinstance(value, dict) or key not in value: raise SystemExit(1)
    value = value[key]
if isinstance(value, bool): print('true' if value else 'false')
elif value is not None: print(value)
EOF

cat > "${tmp_dir}/bin/uci" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
state="${MOCK_UCI_STATE}"
[ "${1:-}" = -q ] && shift
command="${1:-}"
value="${2:-}"
case "$command" in
	get)
		case "$value" in
			localclash.subscription_schedule.enabled) result="$(sed -n '1p' "$state")" ;;
			localclash.subscription_schedule.update_hour) result="$(sed -n '2p' "$state")" ;;
			*) exit 1 ;;
		esac
		[ -n "$result" ] || exit 1
		printf '%s\n' "$result"
		;;
	set)
		key="${value%%=*}"
		new_value="${value#*=}"
		enabled="$(sed -n '1p' "$state")"
		update_hour="$(sed -n '2p' "$state")"
		case "$key" in
			localclash.subscription_schedule.enabled) enabled="$new_value" ;;
			localclash.subscription_schedule.update_hour) update_hour="$new_value" ;;
			*) exit 1 ;;
		esac
		printf '%s\n%s\n' "$enabled" "$update_hour" > "$state"
		;;
	commit) : ;;
	*) exit 1 ;;
esac
EOF

cat > "${tmp_dir}/scheduler-service" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$1" >> "${MOCK_SERVICE_TRACE}"
if [ "${MOCK_SERVICE_FAIL:-}" = "$1" ]; then
	exit 1
fi
EOF
chmod +x "${tmp_dir}/bin/jsonfilter" "${tmp_dir}/bin/uci" "${tmp_dir}/scheduler-service"

printf '0\n0\n' > "${tmp_dir}/uci-state"
MOCK_UCI_STATE="${tmp_dir}/uci-state"
MOCK_SERVICE_TRACE="${tmp_dir}/service-trace"
export MOCK_UCI_STATE MOCK_SERVICE_TRACE

awk '/^method="\$\{1:-\}"/ { exit } { print }' "$helper" > "${tmp_dir}/functions.sh"
# shellcheck disable=SC1090
. "${tmp_dir}/functions.sh"

UCI_BIN="${tmp_dir}/bin/uci"
SUBSCRIPTION_SCHEDULER_SERVICE="${tmp_dir}/scheduler-service"
SUBSCRIPTION_SCHEDULE_RUNTIME="${tmp_dir}/schedule-runtime.json"
service_status() {
	printf '{"ok":true,"mcp":{"healthy":true}}\n'
}

result="$(printf '{"enabled":true,"update_hour":23}\n' | subscription_schedule_set)"
printf '%s\n' "$result" | grep -q '"enabled":true' || { printf 'enable result mismatch: %s\n' "$result" >&2; exit 1; }
[ "$(sed -n '1p' "$MOCK_UCI_STATE")" = 1 ] || { printf 'enabled UCI state not saved\n' >&2; exit 1; }
[ "$(sed -n '2p' "$MOCK_UCI_STATE")" = 23 ] || { printf 'update hour UCI state not saved\n' >&2; exit 1; }
grep -qx enable "$MOCK_SERVICE_TRACE" || { printf 'scheduler service was not enabled\n' >&2; exit 1; }
grep -qx restart "$MOCK_SERVICE_TRACE" || { printf 'scheduler service was not restarted\n' >&2; exit 1; }

: > "$MOCK_SERVICE_TRACE"
result="$(printf '{"enabled":false,"update_hour":7}\n' | subscription_schedule_set)"
printf '%s\n' "$result" | grep -q '"enabled":false' || { printf 'disable result mismatch: %s\n' "$result" >&2; exit 1; }
grep -qx stop "$MOCK_SERVICE_TRACE" || { printf 'scheduler service was not stopped\n' >&2; exit 1; }
grep -qx disable "$MOCK_SERVICE_TRACE" || { printf 'scheduler service was not disabled\n' >&2; exit 1; }

set +e
invalid="$(printf '{"enabled":true,"update_hour":24}\n' | subscription_schedule_set)"
invalid_rc=$?
set -e
[ "$invalid_rc" -ne 0 ] || { printf 'invalid update hour returned success\n' >&2; exit 1; }
printf '%s\n' "$invalid" | grep -q 'subscription_schedule_hour_invalid' || { printf 'invalid update hour error mismatch\n' >&2; exit 1; }

set +e
negative="$(printf '{"enabled":true,"update_hour":-1}\n' | subscription_schedule_set)"
negative_rc=$?
set -e
[ "$negative_rc" -ne 0 ] || { printf 'negative update hour returned success\n' >&2; exit 1; }
printf '%s\n' "$negative" | grep -q 'subscription_schedule_hour_invalid' || { printf 'negative update hour error mismatch\n' >&2; exit 1; }

printf '0\n' > "$MOCK_UCI_STATE"
set +e
missing_hour="$(subscription_schedule_config)"
missing_hour_rc=$?
set -e
[ "$missing_hour_rc" -ne 0 ] || { printf 'missing update hour used an implicit fallback\n' >&2; exit 1; }
printf '%s\n' "$missing_hour" | grep -q 'subscription_schedule_config_missing' || { printf 'missing update hour error mismatch\n' >&2; exit 1; }
printf '0\n0\n' > "$MOCK_UCI_STATE"

grep -q '^define Package/luci-app-localclash/conffiles$' "${repo_root}/openwrt/luci-app-localclash/Makefile" || { printf 'OpenWrt conffiles declaration missing\n' >&2; exit 1; }
grep -q '^/etc/config/localclash$' "${repo_root}/openwrt/luci-app-localclash/Makefile" || { printf 'localclash UCI config is not package-preserved\n' >&2; exit 1; }
grep -q 'printf .*/etc/config/localclash.*CONTROL/conffiles' "${repo_root}/scripts/build-openwrt-ipk.sh" || { printf 'standalone IPK conffiles metadata missing\n' >&2; exit 1; }
for package_builder in "${repo_root}/scripts/build-openwrt-ipk.sh" "${repo_root}/scripts/build-openwrt-apk.sh"; do
	grep -q 'subscription-scheduler-restart-required' "$package_builder" || { printf 'scheduler package-reload marker missing: %s\n' "$package_builder" >&2; exit 1; }
	grep -q 'uclient-fetch.*curl' "$package_builder" || { printf 'curl package dependency missing: %s\n' "$package_builder" >&2; exit 1; }
done

procd_instances="${tmp_dir}/procd-instances"
procd_open_instance() { printf '%s\n' "$1" >> "$procd_instances"; }
procd_set_param() { :; }
procd_close_instance() { :; }
procd_add_reload_trigger() { :; }
# shellcheck disable=SC1090
. "$init_script"
WORKER="$worker"
HELPER="$helper"
printf '1\n23\n' > "$MOCK_UCI_STATE"
start_service
grep -qx subscription_scheduler "$procd_instances" || { printf 'procd scheduler instance was not created\n' >&2; exit 1; }

cat > "${tmp_dir}/bin/sleep" <<'EOF'
#!/usr/bin/env sh
[ -z "${MOCK_RUNTIME_CAPTURE:-}" ] || cp "$LOCALCLASH_SUBSCRIPTION_SCHEDULE_RUNTIME" "$MOCK_RUNTIME_CAPTURE"
printf '%s\n' "$1" > "${MOCK_SLEEP_CAPTURE}"
if [ "${MOCK_SLEEP_SUCCEED_ONCE:-0}" = 1 ] && [ ! -e "${MOCK_SLEEP_ONCE_MARKER}" ]; then
	: > "${MOCK_SLEEP_ONCE_MARKER}"
	exit 0
fi
exit 1
EOF
cat > "${tmp_dir}/bin/date" <<'EOF'
#!/usr/bin/env sh
case "${1:-}" in
	+%s) printf '%s\n' "${MOCK_DATE_EPOCH:-100000}" ;;
	+%H) printf '%s\n' "${MOCK_DATE_HOUR:-22}" ;;
	+%M) printf '%s\n' "${MOCK_DATE_MINUTE:-30}" ;;
	+%S) printf '%s\n' "${MOCK_DATE_SECOND:-00}" ;;
	*) exit 1 ;;
esac
EOF
cat > "${tmp_dir}/worker-helper" <<'EOF'
#!/usr/bin/env sh
printf '%s\n' "$*" > "${MOCK_WORKER_TRACE}"
EOF
chmod +x "${tmp_dir}/bin/sleep" "${tmp_dir}/bin/date" "${tmp_dir}/worker-helper"
MOCK_WORKER_TRACE="${tmp_dir}/worker-trace"
MOCK_RUNTIME_CAPTURE="${tmp_dir}/worker-runtime-capture.json"
MOCK_SLEEP_CAPTURE="${tmp_dir}/worker-sleep-capture"
MOCK_SLEEP_ONCE_MARKER="${tmp_dir}/worker-sleep-once"
export MOCK_WORKER_TRACE MOCK_RUNTIME_CAPTURE MOCK_SLEEP_CAPTURE MOCK_SLEEP_ONCE_MARKER
worker_runtime="${tmp_dir}/worker-runtime.json"
LOCALCLASH_HELPER="${tmp_dir}/worker-helper" LOCALCLASH_UCI_BIN="${tmp_dir}/bin/uci" LOCALCLASH_SUBSCRIPTION_SCHEDULE_RUNTIME="$worker_runtime" "$worker" run
[ ! -e "$worker_runtime" ] || { printf 'worker did not remove runtime state on exit\n' >&2; exit 1; }
python3 - "$MOCK_RUNTIME_CAPTURE" <<'PY'
import json, os, sys
value = json.load(open(sys.argv[1], encoding='utf-8'))
assert value['version'] == 1
assert value['running'] is True
assert value['pid'] > 0
assert value['update_hour'] == 23
assert value['next_run_at'] == 101800
PY
[ "$(cat "$MOCK_SLEEP_CAPTURE")" = 60 ] || { printf 'scheduler did not periodically recalculate wall-clock target\n' >&2; exit 1; }

rm -f "$MOCK_WORKER_TRACE" "$MOCK_SLEEP_ONCE_MARKER"
MOCK_SLEEP_SUCCEED_ONCE=1
MOCK_DATE_EPOCH=200000
MOCK_DATE_HOUR=22
MOCK_DATE_MINUTE=59
MOCK_DATE_SECOND=30
export MOCK_SLEEP_SUCCEED_ONCE MOCK_DATE_EPOCH MOCK_DATE_HOUR MOCK_DATE_MINUTE MOCK_DATE_SECOND
LOCALCLASH_HELPER="${tmp_dir}/worker-helper" LOCALCLASH_UCI_BIN="${tmp_dir}/bin/uci" LOCALCLASH_SUBSCRIPTION_SCHEDULE_RUNTIME="$worker_runtime" "$worker" run
[ "$(cat "$MOCK_SLEEP_CAPTURE")" = 30 ] || { printf 'scheduler did not wait until the selected whole hour\n' >&2; exit 1; }
[ "$(cat "$MOCK_WORKER_TRACE")" = 'call subscription_schedule_tick' ] || { printf 'scheduler did not invoke the scheduled transaction at the selected hour\n' >&2; exit 1; }

printf 'subscription scheduler service tests passed\n'
