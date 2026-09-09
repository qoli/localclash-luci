#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
apply_impl="${repo_root}/openwrt/luci-app-localclash/root/usr/libexec/localclash/takeover-apply"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT
mkdir -p "${tmp_dir}/bin" "${tmp_dir}/state"

fail_test() {
	printf 'test-takeover-dns-policy: %s\n' "$*" >&2
	exit 1
}

cat > "${tmp_dir}/bin/fw4" <<'EOF'
#!/bin/sh
exit 0
EOF

cat > "${tmp_dir}/bin/modprobe" <<'EOF'
#!/bin/sh
exit 0
EOF

cat > "${tmp_dir}/bin/nft" <<'EOF'
#!/bin/sh
case "$*" in
	"list table inet fw4"|"list chain inet fw4 dstnat"|"list chain inet fw4 mangle_prerouting"|"list chain inet fw4 forward"|"list chain inet fw4 input"|"list chain inet fw4 srcnat") exit 0 ;;
	"-f -") cat >/dev/null; exit 0 ;;
	*) exit 0 ;;
esac
EOF

cat > "${tmp_dir}/bin/ip" <<'EOF'
#!/bin/sh
case "$*" in
	"link show utun"|"link set utun up") exit 0 ;;
	"rule del "*|"-6 rule del "*) exit 1 ;;
	"rule show"|"-6 rule show"|"route show table 0x162"|"-6 route show table 0x162") exit 0 ;;
	"-o -4 addr show"*|"-o -6 addr show"*) exit 0 ;;
	*) exit 0 ;;
esac
EOF

cat > "${tmp_dir}/bin/uci" <<'EOF'
#!/bin/sh
case "$*" in
	"-q get dhcp.@dnsmasq[0].noresolv") printf '%s\n' "${MOCK_NORESOLV:-}"; [ -n "${MOCK_NORESOLV:-}" ] ;;
	"-q get dhcp.@dnsmasq[0].server") printf '%s\n' "${MOCK_SERVERS:-}"; [ -n "${MOCK_SERVERS:-}" ] ;;
	"-q get dhcp.@dnsmasq[0].serversfile") printf '%s\n' "${MOCK_SERVERSFILE:-}"; [ -n "${MOCK_SERVERSFILE:-}" ] ;;
	"-q get dhcp.@dnsmasq[0].domain") printf 'lan\n' ;;
	"-q get dhcp.@dnsmasq[0].local") printf '/lan/\n' ;;
	"-q show network") exit 0 ;;
	*) exit 1 ;;
esac
EOF
chmod 755 "${tmp_dir}/bin/"*

cat > "${tmp_dir}/resolv.auto" <<'EOF'
nameserver 202.96.134.133
nameserver 202.96.128.166
nameserver 240e:1f:1::1
EOF

run_apply() {
	PATH="${tmp_dir}/bin:${PATH}" \
	STATE_DIR="${tmp_dir}/state" \
	DNS_PORT=7874 \
	REDIR_PORT=7892 \
	TUN_DEVICE=utun \
	LOCALCLASH_DNSMASQ_UID=453 \
	LOCALCLASH_WAN_RESOLV_FILES="${tmp_dir}/resolv.auto" \
	MOCK_NORESOLV="${MOCK_NORESOLV:-}" \
	MOCK_SERVERS="${MOCK_SERVERS:-}" \
	MOCK_SERVERSFILE="${MOCK_SERVERSFILE:-}" \
	"$apply_impl"
}

MOCK_NORESOLV=1
MOCK_SERVERS='202.96.134.133 202.96.128.166'
MOCK_SERVERSFILE=
if ! output="$(run_apply 2>&1)"; then
	fail_test "live noresolv plus explicit WAN baseline was rejected: ${output}"
fi
[ "$(cat "${tmp_dir}/state/dns-failure-policy")" = fail_open ] || fail_test "explicit WAN baseline was not classified fail_open"

rm -rf "${tmp_dir}/state"
mkdir -p "${tmp_dir}/state"
MOCK_SERVERS='127.0.0.1#7874'
if ! output="$(run_apply 2>&1)"; then
	fail_test "managed direct Mihomo DNS mode was rejected: ${output}"
fi
[ "$(cat "${tmp_dir}/state/dns-failure-policy")" = fail_closed ] || fail_test "managed direct mode was not classified fail_closed"

printf 'applied\n' > "${tmp_dir}/state/status"
MOCK_SERVERS='9.9.9.9'
if output="$(run_apply 2>&1)"; then
	fail_test "foreign upstream absent from WAN resolver set was accepted"
fi
printf '%s\n' "$output" | grep -q 'not present in the current WAN resolver set' || fail_test "foreign upstream error was not explicit: ${output}"
[ "$(cat "${tmp_dir}/state/status")" = applied ] || fail_test "DNS preflight failure destroyed existing takeover state"

MOCK_SERVERS='127.0.0.1#7874 202.96.134.133'
if output="$(run_apply 2>&1)"; then
	fail_test "mixed managed and WAN catch-all upstreams were accepted"
fi
printf '%s\n' "$output" | grep -q 'mixes managed Mihomo and WAN catch-all upstreams' || fail_test "mixed upstream error was not explicit: ${output}"
[ "$(cat "${tmp_dir}/state/status")" = applied ] || fail_test "mixed-mode preflight failure destroyed existing takeover state"

MOCK_SERVERS='202.96.134.133#5353'
if output="$(run_apply 2>&1)"; then
	fail_test "WAN baseline on a non-intercepted port was accepted"
fi
printf '%s\n' "$output" | grep -q 'upstream port that the DNS health lease cannot intercept' || fail_test "non-intercepted port error was not explicit: ${output}"
[ "$(cat "${tmp_dir}/state/status")" = applied ] || fail_test "upstream-port preflight failure destroyed existing takeover state"

MOCK_SERVERS='202.96.134.133'
MOCK_SERVERSFILE='/tmp/foreign.servers'
if output="$(run_apply 2>&1)"; then
	fail_test "unowned servers-file was accepted"
fi
printf '%s\n' "$output" | grep -q 'servers-file outside localClash ownership' || fail_test "servers-file conflict was not explicit: ${output}"
[ "$(cat "${tmp_dir}/state/status")" = applied ] || fail_test "servers-file preflight failure destroyed existing takeover state"

printf 'takeover DNS policy tests passed\n'
