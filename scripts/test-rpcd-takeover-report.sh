#!/usr/bin/env bash
# Host-only contracts; real LuCI/rpcd acceptance runs separately in iStoreOS.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
helper="$repo_root/openwrt/luci-app-localclash/root/usr/libexec/rpcd/localclash"
awk '/^method="\$\{1:-\}"/ { exit } { print }' "$helper" > "$tmp_dir/functions.sh"
# shellcheck disable=SC1090
. "$tmp_dir/functions.sh"
mkdir -p "$tmp_dir/bin"
cat > "$tmp_dir/bin/jsonfilter" <<'PY'
#!/usr/bin/env python3
import json, sys
args = sys.argv[1:]
try:
    if "-i" in args:
        with open(args[args.index("-i") + 1]) as f:
            value = json.load(f)
    elif "-s" in args:
        value = json.loads(args[args.index("-s") + 1])
    else:
        value = json.load(sys.stdin)
    for key in args[args.index("-e") + 1].removeprefix("@.").split("."):
        value = value[key]
    if isinstance(value, bool):
        print(str(value).lower())
    elif isinstance(value, (dict, list)):
        print(json.dumps(value))
    else:
        print(value)
except (OSError, ValueError, KeyError, IndexError, TypeError):
    sys.exit(1)
PY
chmod +x "$tmp_dir/bin/jsonfilter"
PATH="$tmp_dir/bin:$PATH"
STATE_DIR="$tmp_dir/state"
LOG="$tmp_dir/helper.log"
TAKEOVER_LOG="$STATE_DIR/logs/takeover-events.jsonl"
TAKEOVER_LOG_LOCK_DIR="$tmp_dir/event.lock"
TAKEOVER_LAST_FAILURE="$STATE_DIR/logs/takeover-last-failure.json"
TAKEOVER_REPAIR_TICKET="$tmp_dir/repair"
TAKEOVER_STATE_STATUS="$tmp_dir/takeover-status"
BOOT_AUTO_RESTORE_FILE="$tmp_dir/boot-restore"
BOOT_ID_FILE="$tmp_dir/boot-id"
PROC_UPTIME="$tmp_dir/uptime"
TASK_STATUS="$tmp_dir/task-status"
TASK_RESULT="$tmp_dir/task-result"
runtime_dir="$STATE_DIR/.runtime/mihomo"
mkdir -p "$runtime_dir"
printf 'boot-test\n' > "$BOOT_ID_FILE"
printf '128.00 0.00\n' > "$PROC_UPTIME"
printf 'helper original failure\n' > "$LOG"
printf '{"ok":true,"done":true,"result":{"ok":false}}\n' > "$TASK_STATUS"
printf '{"ok":false,"code":"last_task_error","message":"original task stderr"}\n' > "$TASK_RESULT"
python3 - "$runtime_dir" <<'PY'
import json, pathlib, sys
p = pathlib.Path(sys.argv[1])
(p / "mihomo.log").write_text("\n".join(f"Mihomo log {i}: original stderr" for i in range(250)) + "\n")
(p / "runtime-supervision.json").write_text(json.dumps({"state": "stopped", "log_path": str(p / "mihomo.log")}))
PY

luci_package_json() { printf '"luci_package":{"installed":true,"version":"test-candidate"}'; }
sleep() { :; }
run_with_heartbeat() { local output="$2"; shift 2; "$@" > "$output"; }
call_core() {
	case "$*" in
		"runtime start --json")
			printf '{"ok":false,"code":"command_failed","message":"controller /version connect: connection refused","details":{"stderr":"FATAL original Mihomo error","exit":17}}\n'
			return 17
			;;
		"runtime status --json")
			printf '{"ok":true,"status":{"running":false,"runtime_dir":"%s","log_file":"%s/mihomo.log"}}\n' "$STATE_DIR/.runtime/mihomo" "$STATE_DIR/.runtime/mihomo"
			;;
		"component status --json") printf '{"ok":true,"status":{"components":{"localclash":{"version":"test-core"}}}}\n' ;;
		*) printf 'unexpected command %s\n' "$*" >&2; return 99 ;;
	esac
}
call_takeover() {
	if [ "${MALFORMED_STATUS:-0}" = 1 ]; then printf 'ORIGINAL STATUS STDERR\n'; return 19; fi
	printf '{"ok":true,"status":{"runtime_running":false,"effective":false,"checks":{"fw4_table":false,"tun_interface":false}}}\n'
}
takeover_snapshot() {
	printf '[route-table-27747-v4]\nError: ipv4: FIB table does not exist.\nip route show failed rc=2\n[fw4-localclash-rules]\nError: No such file or directory\nnft list table failed rc=1\n' > "$1"
	printf 'route_table_v4_failed\nnft_snapshot_failed\n' > "$2"
	return 1
}
cat > "$tmp_dir/bin/logread" <<'SH'
#!/bin/sh
printf 'kernel: Out of memory: Killed process 123 (lc-mihomo-meta)\nuhttpd: unrelated event retained\n'
SH
chmod +x "$tmp_dir/bin/logread"

if runtime_start_takeover_run boot_auto_restore > "$tmp_dir/start.json"; then
	printf 'runtime failure unexpectedly succeeded\n' >&2
	exit 1
fi
python3 - "$TAKEOVER_LAST_FAILURE" <<'PY'
import json, os, sys
f = json.load(open(sys.argv[1]))
assert f["stage"] == "runtime_start" and f["exit_code"] == 17, f
assert f["result"]["details"]["stderr"] == "FATAL original Mihomo error"
assert f["evidence"]["mihomo_log"]["lines"][-1] == "Mihomo log 249: original stderr"
assert os.stat(sys.argv[1]).st_mode & 0o777 == 0o600
PY
cp "$TAKEOVER_LAST_FAILURE" "$tmp_dir/original-failure.json"
takeover_log_event_safe net_hotplug worker_started device SQM_IFB_test
cmp "$tmp_dir/original-failure.json" "$TAKEOVER_LAST_FAILURE"
takeover_logs > "$tmp_dir/report.json"
python3 - "$tmp_dir/report.json" <<'PY'
import json, sys
r = json.load(open(sys.argv[1]))
assert r["ok"] and r["schema_version"] == 2 and not r["complete"]
assert any("FIB table does not exist" in line for line in r["current_snapshot"])
assert any("Error: No such file or directory" in line for line in r["current_snapshot"])
assert any("Out of memory" in line for line in r["recent_system_events"])
assert any("unrelated event" in line for line in r["recent_system_events"])
e = r["evidence"]
assert "helper original failure" in e["helper_log"]["lines"]
assert json.loads("\n".join(e["task_result"]["lines"]))["code"] == "last_task_error"
f = json.loads("\n".join(e["last_failure"]["lines"]))
assert f["exit_code"] == 17 and f["result"]["details"]["stderr"] == "FATAL original Mihomo error"
assert e["mihomo_log"]["total_lines"] == 250 and e["mihomo_log"]["omitted_lines"] == 50
assert len(e["mihomo_log"]["lines"]) == 200
assert e["mihomo_log"]["lines"][-1] == "Mihomo log 249: original stderr"
assert not e["watchdog_events"]["available"] and e["watchdog_events"]["reason"] == "file_missing"
assert r["environment"]["luci_package"]["version"] == "test-candidate"
PY

# Later cleanup/restarts may replace the current log; the failure-time snapshot
# must still explain the original failure.
printf 'a later operation replaced the current log\n' > "$runtime_dir/mihomo.log"
takeover_logs > "$tmp_dir/later.json"
python3 - "$tmp_dir/later.json" <<'PY'
import json, sys
r = json.load(open(sys.argv[1]))
e = r["evidence"]
assert e["mihomo_log"]["lines"] == ["a later operation replaced the current log"]
f = json.loads("\n".join(e["last_failure"]["lines"]))
assert f["evidence"]["mihomo_log"]["lines"][-1] == "Mihomo log 249: original stderr"
PY

MALFORMED_STATUS=1
takeover_logs > "$tmp_dir/malformed.json"
python3 - "$tmp_dir/malformed.json" <<'PY'
import json, sys
r = json.load(open(sys.argv[1]))
assert r["current_status"] is None and not r["current_status_json_valid"]
assert r["current_status_exit_code"] == 19
assert r["current_status_output"] == ["ORIGINAL STATUS STDERR"]
assert r["evidence"]["helper_log"]["available"]
PY

(
	call_takeover() { printf '%s\n' "$*"; }
	[ "$(printf '{}' | takeover_status)" = 'status --json' ]
	[ "$(printf '{"probe_dns":false}' | takeover_status)" = 'status --json' ]
	[ "$(printf '{"probe_dns":true}' | takeover_status)" = 'status --json --probe-dns' ]
)

(
	takeover="$repo_root/openwrt/luci-app-localclash/root/usr/libexec/localclash/takeover"
	awk '/^command_name=/ { exit } { print }' "$takeover" > "$tmp_dir/takeover-functions.sh"
	# shellcheck disable=SC1090
	. "$tmp_dir/takeover-functions.sh"
	STATE_DIR="$tmp_dir/takeover-state"
	DNS_PROBE="$tmp_dir/bin/dns-probe"
	mkdir -p "$STATE_DIR"
	printf '{"result":"success","reason":"runtime_lease_refreshed","updated_at_epoch":123}\n' > "$STATE_DIR/dns-guard-status.json"
	export PROBE_CALLS="$tmp_dir/probe-calls"
	export PROBE_RESULT=failed
	cat > "$DNS_PROBE" <<'SH'
#!/bin/sh
[ "$1" = 127.0.0.1 ] && [ "$2" = 7874 ] && [ "$4" = udp ] || exit 99
case "$3" in localclash-*.google.com) ;; *) exit 99 ;; esac
printf '%s\n' "$3" >> "$PROBE_CALLS"
case "$PROBE_RESULT" in
	failed) printf 'dns-probe: DNS response returned unhealthy rcode 2\n' >&2; exit 1 ;;
	unavailable) printf 'lua: module nixio not found\n' >&2; exit 1 ;;
	passed) printf '{"ok":true,"rcode":3}\n' ;;
esac
SH
	chmod +x "$DNS_PROBE"
	probe_runtime=true
	probe_lease=true
	require_tools() { :; }
	read_runtime_facts() {
		PROFILE_MODE=router RUNTIME_RUNNING="$probe_runtime" CONTROLLER_READY="$probe_runtime" IPV6=true
		CONFIG_SHA256=test DNS_PORT=7874 DNS_PORT_JSON=7874 REDIR_PORT_JSON=7892 TPROXY_PORT_JSON=7895 TUN_DEVICE=utun
	}
	observe_rules() {
		FW4_AVAILABLE=true NFT_AVAILABLE=true FW4_TABLE=true FW4_BASE_CHAINS=true TUN_INTERFACE=true
		FWMARK_ROUTE_V4=true NFT_CHAINS=true TCP_REDIRECT=true UDP_TUN_MARK=true DNS_HIJACK=true LOCAL_DNS_BYPASS=true
		DNS_ACTIVE_SETS=true DNS_INGRESS_REDIRECT=true DNS_LOCAL_REDIRECT=true STATE_OWNED=true DNS_LEASE_ACTIVE="$probe_lease"
	}
	status_json > "$tmp_dir/plain.json"
	probe_runtime=false status_json --probe-dns > "$tmp_dir/stopped.json"
	probe_lease=false status_json --probe-dns > "$tmp_dir/no-lease.json"
	[ ! -e "$PROBE_CALLS" ]
	status_json --probe-dns > "$tmp_dir/failed-probe.json"
	PROBE_RESULT=unavailable status_json --probe-dns > "$tmp_dir/unavailable-probe.json"
	PROBE_RESULT=passed status_json --probe-dns > "$tmp_dir/passed-probe.json"
	python3 - "$tmp_dir" <<'PY'
import json, pathlib, sys
root = pathlib.Path(sys.argv[1])
def status(filename):
    return json.loads((root / filename).read_text())["status"]
for name in ("plain", "stopped", "no-lease"):
    assert "probe" not in status(f"{name}.json")["dns"]
assert len((root / "probe-calls").read_text().splitlines()) == 3
for state in ("failed", "unavailable", "passed"):
    sample = status(f"{state}-probe.json")
    assert sample["runtime_running"] and sample["effective"]
    dns = sample["dns"]
    assert dns["path"] == "mihomo" and dns["lease_active"] and dns["guard_reason"] == "runtime_lease_refreshed"
    probe = dns["probe"]
    assert probe["state"] == state and probe["port"] == 7874 and probe["observed_at"]
assert "unhealthy rcode 2" in status("failed-probe.json")["dns"]["probe"]["output"]
assert "module nixio not found" in status("unavailable-probe.json")["dns"]["probe"]["output"]
PY
)
printf 'rpcd takeover evidence and runtime DNS probe contracts passed\n'
