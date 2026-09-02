#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
helper="$repo_root/openwrt/luci-app-localclash/root/usr/libexec/rpcd/localclash"
hook="$repo_root/openwrt/luci-app-localclash/root/etc/hotplug.d/net/95-localclash-restore"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
awk '/^method="\$\{1:-\}"/ { exit } { print }' "$helper" > "$tmp_dir/functions.sh"
source "$tmp_dir/functions.sh"
mkdir -p "$tmp_dir/bin" "$tmp_dir/stamps"
cat > "$tmp_dir/bin/jsonfilter" <<'PY'
#!/usr/bin/env python3
import json, sys
args=sys.argv[1:]
data=json.load(open(args[args.index('-i')+1])) if '-i' in args else json.load(sys.stdin)
for field in args[args.index('-e')+1].removeprefix('@.').split('.'):
    data=data[field]
print(str(data).lower() if isinstance(data, bool) else data)
PY
chmod +x "$tmp_dir/bin/jsonfilter"
export PATH="$tmp_dir/bin:$PATH"
export LOCALCLASH_NET_RESTORE_STAMP_DIR="$tmp_dir/stamps"
export LOCALCLASH_NET_RESTORE_ATTEMPTS=3 LOCALCLASH_NET_RESTORE_INTERVAL=1
LOCK_DIR="$tmp_dir/lock"
TAKEOVER_REPAIR_TICKET="$tmp_dir/ticket"
TAKEOVER_STATE_STATUS="$tmp_dir/status"
TAKEOVER_SKIP_FILE="$tmp_dir/skip"
LOG="$tmp_dir/log"
TAKEOVER_LOG="$tmp_dir/events"
takeover_log_event_safe() { printf '%s\n' "$*" >> "$TAKEOVER_LOG"; }
takeover_event_scope() { :; }
clear_stale_lock() { :; }
fail_test() { echo "$*" >&2; exit 1; }
call_core() {
    [ "$*" = 'runtime facts --json' ] || return 91
    [ -d "$LOCK_DIR" ] || return 92
    cat "$tmp_dir/facts"
}
call_takeover() {
    [ -d "$LOCK_DIR" ] || return 93
    printf '%s\n' "$*" >> "$tmp_dir/calls"
    case "$1" in
        status) printf '{"status":{"effective":false,"runtime_running":true,"profile_mode":"router"}}\n' ;;
        apply) [ "$apply_rc" -eq 0 ] || { printf '{"ok":false,"code":"fixture_apply_failed","message":"failed"}\n'; return "$apply_rc"; }
            printf '{"ok":true,"status":{"effective":true}}\n' ;;
        *) return 94 ;;
    esac
}
write_facts() {
    printf '{"ok":true,"status":{"schema_version":1,"profile_mode":"%s","tun_device":"%s","tun_enabled":true,"runtime_running":true,"controller_ready":%s}}\n' "$profile" "$tun" "$ready" > "$tmp_dir/facts"
}
sleep() {
    [ ! -d "$LOCK_DIR" ] || fail_test 'worker slept while holding mutation lock'
    sleeps=$((sleeps + 1))
    case "$on_sleep" in
        ready) ready=true; write_facts ;;
        stop) rm -f "$TAKEOVER_REPAIR_TICKET" "$TAKEOVER_STATE_STATUS" ;;
        supersede) printf '2\n' > "$tmp_dir/stamps/managed-tun" ;;
        unlock) rm -rf "$LOCK_DIR" ;;
        fail) return 1 ;;
    esac
}
reset_case() {
    rm -rf "$LOCK_DIR"
    rm -f "$TAKEOVER_SKIP_FILE"
    printf applied > "$TAKEOVER_REPAIR_TICKET"
    printf '1\n' > "$tmp_dir/stamps/managed-tun"
    : > "$tmp_dir/calls"
    : > "$TAKEOVER_LOG"
    ready=true profile=router tun=managed-tun on_sleep=none sleeps=0 apply_rc=0
    write_facts
}
run_worker() {
    if takeover_net_restore managed-tun 1 > "$tmp_dir/result"; then rc=0; else rc=$?; fi
}
assert_no_apply() { ! grep -q '^apply ' "$tmp_dir/calls" || fail_test 'unexpected takeover apply'; }

reset_case
ready=false on_sleep=ready; write_facts
run_worker
[ "$rc" = 0 ] && [ "$sleeps" = 1 ] || fail_test 'delayed controller did not recover'
grep -q '^apply --json$' "$tmp_dir/calls" || fail_test 'ready runtime was not restored'

reset_case
ready=false on_sleep=stop; write_facts
run_worker
[ "$rc" = 0 ] || fail_test 'explicit stop was not respected'
assert_no_apply
grep -q repair_not_requested "$tmp_dir/result" || fail_test 'missing stop outcome'

reset_case
ready=false on_sleep=supersede; write_facts
run_worker
[ "$rc" = 0 ] || fail_test 'superseded worker failed'
assert_no_apply
grep -q event_superseded "$tmp_dir/result" || fail_test 'missing superseded outcome'

for mode in no_ticket unrelated non_router test_mode; do
    reset_case
    case "$mode" in
        no_ticket) rm "$TAKEOVER_REPAIR_TICKET" ;;
        unrelated) tun=another-tun; write_facts ;;
        non_router) profile=desktop; write_facts ;;
        test_mode) touch "$TAKEOVER_SKIP_FILE" ;;
    esac
    run_worker
    [ "$rc" = 0 ] || fail_test "$mode failed"
    assert_no_apply
done

reset_case
ready=false; write_facts
run_worker
[ "$rc" != 0 ] && [ "$sleeps" = 2 ] || fail_test 'readiness was not bounded'
grep -q net_restore_timeout "$tmp_dir/result" || fail_test 'missing timeout error'
assert_no_apply

reset_case
ready=false on_sleep=fail; write_facts
run_worker
[ "$rc" != 0 ] && [ "$sleeps" = 1 ] || fail_test 'sleep failure did not terminate worker'
grep -q net_restore_sleep_failed "$tmp_dir/result" || fail_test 'missing sleep failure error'
assert_no_apply

reset_case
printf '{"ok":true,"status":{"schema_version":2}}\n' > "$tmp_dir/facts"
run_worker
[ "$rc" != 0 ] || fail_test 'invalid facts accepted'
assert_no_apply
grep -q net_restore_facts_invalid "$tmp_dir/result" || fail_test 'missing invalid facts error'

reset_case
apply_rc=37
run_worker
[ "$rc" = 37 ] || fail_test 'apply failure lost'
grep -q fixture_apply_failed "$tmp_dir/result" || fail_test 'apply failure output lost'

# A live competing transaction is not entered. Its lock is released between
# attempts; then the same intent and event must be checked again.
reset_case
mkdir "$LOCK_DIR"
on_sleep=unlock
# Model another process holding the lock; sleep must not mistake it for ours.
sleep() { sleeps=$((sleeps + 1)); rm -rf "$LOCK_DIR"; }
run_worker
[ "$rc" = 0 ] && [ "$sleeps" = 1 ] || fail_test 'busy transaction was not deferred'
grep -q '^apply --json$' "$tmp_dir/calls" || fail_test 'deferred restore missing'

# Exercise the installed kernel hook, including remove invalidation and
# duplicate add tokens, independently of worker fixtures.
cat > "$tmp_dir/hook-helper" <<'SH'
#!/bin/sh
printf '%s\n' "$*" >> "$LOCALCLASH_HOOK_CALLS"
SH
chmod +x "$tmp_dir/hook-helper"
export LOCALCLASH_HELPER="$tmp_dir/hook-helper" LOCALCLASH_HOOK_CALLS="$tmp_dir/hook-calls"
ACTION=add INTERFACE=custom-tun "$hook"
first_token="$(cat "$tmp_dir/stamps/custom-tun")"
ACTION=add INTERFACE=custom-tun "$hook"
second_token="$(cat "$tmp_dir/stamps/custom-tun")"
[ "$first_token" != "$second_token" ] || fail_test 'duplicate add was not a new generation'
ACTION=remove INTERFACE=custom-tun "$hook"
[ "$(cat "$tmp_dir/stamps/custom-tun")" != "$second_token" ] || fail_test 'remove did not invalidate worker'
for _ in 1 2 3 4 5; do
    [ -f "$LOCALCLASH_HOOK_CALLS" ] && [ "$(wc -l < "$LOCALCLASH_HOOK_CALLS" | tr -d ' ')" = 2 ] && break
    command sleep 1
done
[ "$(wc -l < "$LOCALCLASH_HOOK_CALLS" | tr -d ' ')" = 2 ] || fail_test 'hook invoked restore for remove or lost add'
grep -q 'call takeover_net_restore custom-tun' "$LOCALCLASH_HOOK_CALLS" || fail_test 'hook lost device name'

# TERM while inside an attempt releases the owned lock and exits, rather than
# returning from the signal trap into the remaining network mutation.
cat > "$tmp_dir/signal-worker" <<'SH'
#!/bin/sh
. "$1/functions.sh"
LOCK_DIR="$1/signal-lock"
SIGNAL_DIR="$1"
takeover_net_restore_attempt() {
    touch "$SIGNAL_DIR/signal-started"
    sleep 1
    touch "$SIGNAL_DIR/signal-mutated"
}
takeover_net_restore_try managed-tun 1
SH
chmod +x "$tmp_dir/signal-worker"
"$tmp_dir/signal-worker" "$tmp_dir" &
worker_pid=$!
for _ in 1 2 3 4 5; do
    [ -f "$tmp_dir/signal-started" ] && break
    command sleep 0.1
done
[ -f "$tmp_dir/signal-started" ] || fail_test 'signal fixture failed to start'
kill -TERM "$worker_pid"
if wait "$worker_pid"; then fail_test 'TERM worker returned success'; else signal_rc=$?; fi
[ "$signal_rc" = 143 ] || fail_test 'TERM exit code was not preserved'
[ ! -e "$tmp_dir/signal-mutated" ] || fail_test 'TERM worker continued mutation'
[ ! -d "$tmp_dir/signal-lock" ] || fail_test 'TERM worker leaked its lock'
rm -rf "$tmp_dir"
printf '{"ok":true}\n'
