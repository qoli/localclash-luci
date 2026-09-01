#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
manager="${repo_root}/openwrt/luci-app-localclash/root/usr/libexec/localclash/takeover"
apply_impl="${repo_root}/openwrt/luci-app-localclash/root/usr/libexec/localclash/takeover-apply"
stop_impl="${repo_root}/openwrt/luci-app-localclash/root/usr/libexec/localclash/takeover-stop"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT
mkdir -p "${tmp_dir}/bin" "${tmp_dir}/work" "${tmp_dir}/state"

fail_test() {
	printf 'test-takeover-manager: %s\n' "$*" >&2
	exit 1
}

cat > "${tmp_dir}/bin/jsonfilter" <<'EOF'
#!/usr/bin/env python3
import json, sys
expr = None
args = iter(sys.argv[1:])
for arg in args:
    if arg == "-e": expr = next(args)
    elif arg == "-i":
        with open(next(args), encoding="utf-8") as handle: data = json.load(handle)
if "data" not in globals(): data = json.load(sys.stdin)
value = data
for key in (expr or "@").removeprefix("@.").split("."):
    if key: value = value[key]
if isinstance(value, bool): print(str(value).lower())
elif value is not None: print(value)
EOF

cat > "${tmp_dir}/bin/localclash" <<'EOF'
#!/bin/sh
[ "$*" = "runtime facts --json" ] || exit 91
cat "$MOCK_FACTS_FILE"
EOF

cat > "${tmp_dir}/bin/fw4" <<'EOF'
#!/bin/sh
exit 0
EOF

cat > "${tmp_dir}/bin/nft" <<'EOF'
#!/bin/sh
rules="${MOCK_RULES_FILE:?}"
case "$*" in
  "list tables") printf 'table inet fw4\n' ;;
  "list chain inet fw4 dstnat") [ -f "$rules" ] && printf 'localClash TCP redirect\nlocalClash DNS hijack\n' || printf 'base dstnat\n' ;;
  "list chain inet fw4 mangle_prerouting") [ -f "$rules" ] && printf 'localClash TUN mark\n' || printf 'base mangle\n' ;;
  "list chain inet fw4 forward"|"list chain inet fw4 input"|"list chain inet fw4 srcnat") printf 'base chain\n' ;;
  "list chain inet fw4 localclash"|"list chain inet fw4 localclash_mangle") [ -f "$rules" ] && printf 'owned\n' ;;
  "list chain inet fw4 localclash_dns_redirect") [ -f "$rules" ] && printf 'localClash DNS hijack\nlocalClash local DNS bypass\n' ;;
esac
exit 0
EOF

cat > "${tmp_dir}/bin/ip" <<'EOF'
#!/bin/sh
rules="${MOCK_RULES_FILE:?}"
case "$*" in
  "link show utun") [ -f "$rules" ] ;;
  "rule show") [ -f "$rules" ] && printf '1890: from all fwmark 0x6c63 lookup 27747\n' ;;
  "route show table 27747") [ -f "$rules" ] && printf 'default dev utun\n' ;;
  *) exit 0 ;;
esac
EOF

cat > "${tmp_dir}/fake-apply" <<'EOF'
#!/bin/sh
set -eu
mkdir -p "$STATE_DIR"
: > "$MOCK_RULES_FILE"
printf 'applied\n' > "$STATE_DIR/status"
EOF

cat > "${tmp_dir}/fake-stop" <<'EOF'
#!/bin/sh
set -eu
rm -f "$MOCK_RULES_FILE" "$STATE_DIR/status"
EOF
chmod 755 "${tmp_dir}/bin/"* "${tmp_dir}/fake-apply" "${tmp_dir}/fake-stop"

facts() {
	cat > "${tmp_dir}/facts.json" <<EOF
{"ok":true,"status":{"schema_version":1,"profile_mode":"router","runtime_running":$1,"controller_ready":$2,"config_sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","dns_port":7874,"redir_port":7892,"tproxy_port":7895,"tun_enabled":true,"tun_device":"utun","tun_auto_route":false,"tun_auto_redirect":false,"ipv6":true}}
EOF
}

run_manager() {
	PATH="${tmp_dir}/bin:${PATH}" \
	MOCK_FACTS_FILE="${tmp_dir}/facts.json" \
	MOCK_RULES_FILE="${tmp_dir}/rules" \
	LOCALCLASH_CORE="${tmp_dir}/bin/localclash" \
	LOCALCLASH_WORKDIR="${tmp_dir}/work" \
	LOCALCLASH_TAKEOVER_STATE_DIR="${tmp_dir}/state" \
	LOCALCLASH_TAKEOVER_APPLY_IMPL="${tmp_dir}/fake-apply" \
	LOCALCLASH_TAKEOVER_STOP_IMPL="${tmp_dir}/fake-stop" \
	"$manager" "$@"
}

facts false false
if output="$(run_manager apply --json)"; then
	fail_test "apply accepted a stopped runtime: ${output}"
fi
printf '%s\n' "$output" | grep -q 'takeover_runtime_not_running' || fail_test "stopped-runtime error missing: ${output}"

facts true true
output="$(run_manager apply --json)" || fail_test "ready apply failed: ${output}"
printf '%s\n' "$output" | grep -q '"effective":true' || fail_test "apply did not verify effective state: ${output}"
[ -f "${tmp_dir}/state/repair-ticket" ] || fail_test "apply did not create repair ticket"

output="$(run_manager status --json)" || fail_test "status failed after apply: ${output}"
printf '%s\n' "$output" | grep -q '"effective":true' || fail_test "status did not observe effective takeover: ${output}"

rm -f "${tmp_dir}/state/status"
if output="$(run_manager stop --json)"; then
	fail_test "stop accepted takeover rules without ownership state: ${output}"
fi
printf '%s\n' "$output" | grep -q 'takeover_ownership_unverified' || fail_test "ownership refusal missing: ${output}"
printf 'applied\n' > "${tmp_dir}/state/status"

PATH="${tmp_dir}/bin:${PATH}" MOCK_RULES_FILE="${tmp_dir}/rules" LOCALCLASH_CORE="${tmp_dir}/missing-core" LOCALCLASH_WORKDIR="${tmp_dir}/work" LOCALCLASH_TAKEOVER_STATE_DIR="${tmp_dir}/state" LOCALCLASH_TAKEOVER_STOP_IMPL="${tmp_dir}/fake-stop" "$manager" stop --json > "${tmp_dir}/stop.json" || fail_test "stop incorrectly depended on Core"
[ ! -f "${tmp_dir}/rules" ] || fail_test "stop left takeover rules"
[ ! -f "${tmp_dir}/state/repair-ticket" ] || fail_test "stop left repair ticket"

if output="$(PATH="${tmp_dir}/bin:${PATH}" MOCK_RULES_FILE="${tmp_dir}/rules" LOCALCLASH_CORE="${tmp_dir}/missing-core" LOCALCLASH_WORKDIR="${tmp_dir}/work" LOCALCLASH_TAKEOVER_STATE_DIR="${tmp_dir}/state" "$manager" status --json)"; then
	fail_test "status accepted missing Core facts: ${output}"
fi
printf '%s\n' "$output" | grep -q 'runtime_facts_core_missing' || fail_test "missing Core error was not explicit: ${output}"

for implementation in "$manager" "$apply_impl" "$stop_impl"; do
	sh -n "$implementation"
done
grep -Fq 'CORE="${LOCALCLASH_CORE:-/usr/local/bin/localclash}"' "$manager" || fail_test "takeover manager Core path does not match the installed product Core"
grep -Fq 'WORKDIR="${LOCALCLASH_WORKDIR:-/root/localclash}"' "$manager" || fail_test "takeover manager workdir does not match the installed product state directory"
grep -q 'ip rule add fwmark' "$apply_impl" || fail_test "apply implementation missing policy route"
grep -q 'localClash DNS hijack' "$apply_impl" || fail_test "apply implementation missing DNS hijack"
grep -q 'discover_lan_networks' "$apply_impl" || fail_test "apply implementation missing OpenWrt LAN discovery"
grep -q "localclash_bypass='1'" "$apply_impl" || fail_test "apply implementation missing explicit ingress-bypass discovery"
grep -q 'localclash iifname @localclash_bypass_iif' "$apply_impl" || fail_test "TCP redirect chain missing ingress bypass"
grep -q 'localclash_mangle iifname @localclash_bypass_iif' "$apply_impl" || fail_test "IPv4 TUN mark chain missing ingress bypass"
grep -q 'localclash_dns_redirect iifname @localclash_bypass_iif' "$apply_impl" || fail_test "DNS redirect chain missing ingress bypass"
grep -q 'localclash_mangle_v6 iifname @localclash_bypass_iif' "$apply_impl" || fail_test "IPv6 TUN mark chain missing ingress bypass"
grep -q 'nft delete chain inet fw4' "$stop_impl" || fail_test "stop implementation missing nft cleanup"
if grep -q 'localclash.*takeover' "$apply_impl"; then
	fail_test "OpenWrt implementation calls back into Core takeover"
fi

printf 'takeover manager tests passed\n'
