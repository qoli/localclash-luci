#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
helper="$repo_root/openwrt/luci-app-localclash/root/usr/libexec/rpcd/localclash"
init_script="$repo_root/openwrt/luci-app-localclash/root/etc/init.d/localclash-pool-scheduler"
test_dir="$(mktemp -d)"
trap 'rm -rf "$test_dir"' EXIT
export test_dir
awk '/^method="\$\{1:-\}"/ { exit } { print }' "$helper" > "$test_dir/helper.sh"
. "$test_dir/helper.sh"
LOG="$test_dir/log"

mkdir "$test_dir/workspace"
STATE_DIR="$(cd "$test_dir/workspace" && pwd -P)"
arch="$(router_arch)"
worker="$STATE_DIR/bin/linux-$arch/localclash-pools"
mkdir -p "$(dirname "$worker")" "$test_dir/uci"
uci() {
	shift
	local action="$1" key="${2%%=*}"
	case "$action:$key" in
		get:system.*) printf 'Asia/Shanghai\n' ;;
		get:*) cat "$test_dir/uci/$key" ;;
		set:*) printf '%s\n' "${2#*=}" > "$test_dir/uci/$key" ;;
		delete:localclash.pool_schedule) rm -f "$test_dir"/uci/localclash.pool_schedule* ;;
		delete:*) rm -f "$test_dir/uci/$key" ;;
		commit:localclash) : ;;
		*) return 1 ;;
	esac
}
jsonfilter() {
	local value="$2" expression="$4"
	if [ "$1" = -i ]; then
		jq -er ".${expression#@.}" "$value"
	else
		printf '%s\n' "$value" | jq -er ".${expression#@.}"
	fi
}
POOL_SCHEDULER_SERVICE="$test_dir/service"
cat > "$POOL_SCHEDULER_SERVICE" <<'SERVICE'
#!/bin/sh
case "$1" in
	running) [ -f "$test_dir/running" ] ;;
	enable) touch "$test_dir/enabled" ;;
	disable) rm -f "$test_dir/enabled" ;;
	stop) rm -f "$test_dir/running" ;;
	restart)
		if [ -f "$test_dir/fail-once" ]; then
			rm "$test_dir/fail-once"
			exit 1
		fi
		touch "$test_dir/running"
		;;
	*) exit 1 ;;
esac
SERVICE
chmod +x "$POOL_SCHEDULER_SERVICE"

pool_schedule_get | jq -e '.schedule == {"enabled":false,"period":"15m"} and .available == false' >/dev/null
if result="$(printf '{"enabled":true,"period":"15m"}\n' | pool_schedule_set)"; then
	echo "Enabled without pool worker" >&2
	exit 1
fi
printf '%s\n' "$result" | jq -e '.code == "pool_worker_missing"' >/dev/null
touch "$worker"
chmod +x "$worker"
if result="$(printf '{"enabled":true,"period":"10m"}\n' | pool_schedule_set)"; then
	echo "Accepted an unsupported period" >&2
	exit 1
fi
printf '%s\n' "$result" | jq -e '.code == "pool_schedule_period_invalid"' >/dev/null

touch "$test_dir/fail-once"
if result="$(printf '{"enabled":true,"period":"5m"}\n' | pool_schedule_set)"; then
	echo "Ignored failure to start the service" >&2
	exit 1
fi
printf '%s\n' "$result" | jq -e '.code == "pool_schedule_save_failed"' >/dev/null
[ ! -f "$test_dir/uci/localclash.pool_schedule" ] && [ ! -f "$test_dir/enabled" ]

for period in 5m 15m 30m 1h daily-08; do
	result="$(printf '{"enabled":true,"period":"%s"}\n' "$period" | pool_schedule_set)"
	printf '%s\n' "$result" | jq -e --arg period "$period" '.ok and .schedule == {"enabled":true,"period":$period}' >/dev/null
	[ -f "$test_dir/enabled" ] && [ -f "$test_dir/running" ]
done
touch "$test_dir/fail-once"
if result="$(printf '{"enabled":true,"period":"30m"}\n' | pool_schedule_set)"; then
	echo "Ignored failure to change the service period" >&2
	exit 1
fi
pool_schedule_get | jq -e '.schedule == {"enabled":true,"period":"daily-08"}' >/dev/null

procd_open_instance() { printf '%s\n' "$1" > "$test_dir/instance"; }
procd_set_param() {
	case "$1" in command|env) printf '%s\n' "$@" > "$test_dir/$1" ;; esac
}
procd_close_instance() { :; }
. "$init_script"
export LOCALCLASH_STATE_DIR="$STATE_DIR"
start_service
grep -qx pool_scheduler "$test_dir/instance"
printf '%s\n' command "$worker" schedule --runtime "$STATE_DIR/.runtime/mihomo" --period daily-08 | cmp - "$test_dir/command"
grep -qx 'TZ=Asia/Shanghai' "$test_dir/env"

call_core() {
	[ "$1:$2" = config:pools ] || return 1
	local enabled=true profile="$STATE_DIR/localclash-runtime.json"
	if [ "$3" = --enabled ]; then
		enabled="$4"
		jq -n --argjson enabled "$enabled" '{pools_disabled: ($enabled | not)}' > "$profile"
	elif [ -f "$profile" ]; then
		enabled="$(jq -r '.pools_disabled | not' "$profile")"
	fi
	jq -n --argjson enabled "$enabled" '{ok:true,status:{enabled:$enabled}}'
}
pool_capability_get | jq -e '.status.enabled == true' >/dev/null
apply_pool_capability false | jq -e '.status.enabled == false' >/dev/null
[ ! -f "$test_dir/enabled" ] && [ ! -f "$test_dir/running" ]
pool_schedule_get | jq -e '.schedule == {"enabled":true,"period":"daily-08"} and .next_run_at == ""' >/dev/null
rm "$test_dir/instance"
start_service
[ ! -f "$test_dir/instance" ]
printf '{"enabled":true,"period":"30m"}\n' | pool_schedule_set | jq -e '.schedule.period == "30m"' >/dev/null
[ ! -f "$test_dir/running" ]
apply_pool_capability true | jq -e '.status.enabled == true' >/dev/null
[ -f "$test_dir/enabled" ] && [ -f "$test_dir/running" ]
pool_schedule_get | jq -e '.schedule == {"enabled":true,"period":"30m"}' >/dev/null

result="$(printf '{"enabled":false,"period":"15m"}\n' | pool_schedule_set)"
printf '%s\n' "$result" | jq -e '.schedule == {"enabled":false,"period":"15m"}' >/dev/null
[ ! -f "$test_dir/enabled" ] && [ ! -f "$test_dir/running" ]
apply_pool_capability true | jq -e '.status.enabled == true' >/dev/null
[ ! -f "$test_dir/enabled" ] && [ ! -f "$test_dir/running" ]
printf 'pool scheduler service tests passed\n'
