#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
helper="$root/openwrt/luci-app-localclash/root/usr/libexec/rpcd/localclash"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT
export fixture
export LOCALCLASH_UPDATE_CHECK_DIR="$fixture/runs"
export LOCALCLASH_HELPER_SELF="$fixture/check"
mkdir "$fixture/bin"
export PATH="$fixture/bin:$PATH"
cat > "$fixture/bin/jsonfilter" <<'SH'
#!/bin/sh
sed -n 's/.*"run_id":"\([^"]*\)".*/\1/p'
SH
cat > "$fixture/check" <<'SH'
#!/bin/sh
case "$2" in
	luci_update_check) printf '{"ok":true,"update_available":false}\n' ;;
	core_update_check)
		while [ -d "$fixture" ] && [ ! -e "$fixture/finish" ]; do sleep 0.1; done
		printf '{"ok":false,"message":"endpoint timed out"}\n'
		exit 1
		;;
	*) exit 1 ;;
esac
SH
chmod +x "$fixture/bin/jsonfilter" "$fixture/check"
start_check() {
	sh "$helper" call update_checks_start | sed -n 's/.*"run_id":"\([^"]*\)".*/\1/p'
}
status_check() {
	printf '{"run_id":"%s"}\n' "$1" | sh "$helper" call update_checks_status | tr -d '\n'
}

# Independent tabs use the same running worker. Stdin/stdout must already be
# detached when start returns even while Core is still waiting.
start_check > "$fixture/first" &
first=$!
start_check > "$fixture/second" &
wait "$first"
wait
run="$(cat "$fixture/first")"
[[ "$run" == run.???????? ]]
[ "$(cat "$fixture/second")" = "$run" ]
for _ in {1..50}; do
	[ ! -s "$fixture/runs/$run/luci.json" ] || break
	sleep 0.1
done
partial="$(status_check "$run")"
[[ "$partial" == *'"luci":{"ok":true,"update_available":false}'* && "$partial" == *'"core":null'* ]]
touch "$fixture/finish"
for _ in {1..50}; do
	[ ! -s "$fixture/runs/$run/core.json" ] || break
	sleep 0.1
done
complete="$(status_check "$run")"
[[ "$complete" == *'"core":{"ok":false,"message":"endpoint timed out"}'* ]]
fresh="$(start_check)"
[[ -n "$fresh" && "$fresh" != "$run" ]]
[ "$(status_check "$run")" = "$complete" ]
[[ "$(status_check '../bad')" == *'"code":"update_check_unknown"'* ]]
mkdir "$fixture/runs/run.00000000"
: > "$fixture/runs/run.00000000/worker.lock"
[[ "$(status_check run.00000000)" == *'"code":"update_check_interrupted"'* ]]
echo 'rpcd background update check tests passed'
