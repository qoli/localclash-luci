#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
guard="${repo_root}/openwrt/luci-app-localclash/root/usr/libexec/localclash/dns-guard"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT
mkdir -p "${tmp_dir}/state" "${tmp_dir}/bin"

fail_test() {
	printf 'test-dns-health-lease: %s\n' "$*" >&2
	exit 1
}

cat > "${tmp_dir}/bin/dns-probe" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >> "$MOCK_PROBE_LOG"
[ "${MOCK_PROBE_FAIL:-0}" = 0 ] || exit 1
[ "${MOCK_CHANGE_GENERATION:-0}" = 0 ] || case "$*" in *tcp*) printf 'generation-2\n' > "$MOCK_GENERATION_FILE" ;; esac
[ "${MOCK_REMOVE_GENERATION:-0}" = 0 ] || case "$*" in *tcp*) rm -f "$MOCK_GENERATION_FILE"; exit 1 ;; esac
printf '{"ok":true}\n'
EOF

cat > "${tmp_dir}/bin/nft" <<'EOF'
#!/bin/sh
case "$*" in
	"list chain inet fw4 localclash_dns_redirect") printf 'localClash DNS hijack to dnsmasq\n' ;;
	"list chain inet fw4 nat_output") printf 'localClash DNS lease redirect\n' ;;
	"list set inet fw4 localclash_dns_proxy_lease4"|"list set inet fw4 localclash_dns_proxy_lease6") printf 'set lease\n' ;;
	-f*) cat "$2" >> "$MOCK_NFT_LOG" ;;
	*) exit 2 ;;
esac
EOF
chmod 755 "${tmp_dir}/bin/dns-probe" "${tmp_dir}/bin/nft" "$guard"

printf 'applied\n' > "${tmp_dir}/state/status"
printf 'generation-1\n' > "${tmp_dir}/state/generation"
printf '7874\n' > "${tmp_dir}/state/dns-port"
cat > "${tmp_dir}/resolv.auto" <<'EOF'
nameserver 202.96.134.133
nameserver 2001:4860:4860::8888
nameserver 127.0.0.1
EOF

run_guard() {
	MOCK_PROBE_LOG="${tmp_dir}/probe.log" \
	MOCK_NFT_LOG="${tmp_dir}/nft.log" \
	LOCALCLASH_DNS_PROBE="${tmp_dir}/bin/dns-probe" \
	LOCALCLASH_NFT="${tmp_dir}/bin/nft" \
	LOCALCLASH_TAKEOVER_STATE_DIR="${tmp_dir}/state" \
	LOCALCLASH_DNS_GUARD_STATUS_FILE="${tmp_dir}/state/guard.json" \
	LOCALCLASH_WAN_RESOLV_FILES="${tmp_dir}/resolv.auto" \
	LOCALCLASH_DNS_PROBE_TIMEOUT_SECONDS=1 \
	MOCK_PROBE_FAIL="${MOCK_PROBE_FAIL:-0}" \
	MOCK_CHANGE_GENERATION="${MOCK_CHANGE_GENERATION:-0}" \
	MOCK_REMOVE_GENERATION="${MOCK_REMOVE_GENERATION:-0}" \
	MOCK_GENERATION_FILE="${tmp_dir}/state/generation" \
	"$guard" once
}

run_guard || fail_test "healthy guard renewal failed"
[ "$(wc -l < "${tmp_dir}/probe.log" | tr -d ' ')" = 2 ] || fail_test "guard did not probe UDP and TCP"
grep -q '^127.0.0.1 7874 .* udp 1$' "${tmp_dir}/probe.log" || fail_test "UDP probe did not target Mihomo DNS"
grep -q '^127.0.0.1 7874 .* tcp 1$' "${tmp_dir}/probe.log" || fail_test "TCP probe did not target Mihomo DNS"
grep -q '^flush set inet fw4 localclash_dns_proxy_lease4$' "${tmp_dir}/nft.log" || fail_test "IPv4 lease was not atomically replaced"
grep -q '202.96.134.133 timeout 15s' "${tmp_dir}/nft.log" || fail_test "WAN IPv4 resolver was not leased"
grep -q '2001:4860:4860::8888 timeout 15s' "${tmp_dir}/nft.log" || fail_test "WAN IPv6 resolver was not leased"
! grep -q '127.0.0.1 timeout' "${tmp_dir}/nft.log" || fail_test "loopback resolver entered the WAN lease"
grep -q '"result":"success"' "${tmp_dir}/state/guard.json" || fail_test "successful renewal status missing"

rm -f "${tmp_dir}/nft.log"
MOCK_PROBE_FAIL=1
if run_guard; then
	fail_test "failed DNS probe returned success"
fi
[ ! -e "${tmp_dir}/nft.log" ] || fail_test "failed probe mutated the lease"
grep -q 'mihomo_dns_probe_failed' "${tmp_dir}/state/guard.json" || fail_test "probe failure status missing"

MOCK_PROBE_FAIL=0
MOCK_CHANGE_GENERATION=1
printf 'generation-1\n' > "${tmp_dir}/state/generation"
rm -f "${tmp_dir}/nft.log" "${tmp_dir}/state/guard.json"
run_guard || fail_test "generation change should be a successful no-op"
[ ! -e "${tmp_dir}/nft.log" ] || fail_test "stale guard generation renewed the lease"
[ ! -e "${tmp_dir}/state/guard.json" ] || fail_test "stale guard generation wrote status"

MOCK_CHANGE_GENERATION=0
printf 'generation-1\n' > "${tmp_dir}/state/generation"
rm -f "${tmp_dir}/nft.log" "${tmp_dir}/state/guard.json"
MOCK_REMOVE_GENERATION=1
if run_guard; then
	fail_test "probe interrupted by takeover stop returned success"
fi
[ ! -e "${tmp_dir}/nft.log" ] || fail_test "stopped takeover guard mutated the lease"
[ ! -e "${tmp_dir}/state/guard.json" ] || fail_test "stopped takeover guard recreated status"

MOCK_REMOVE_GENERATION=0
rm -f "${tmp_dir}/state/status" "${tmp_dir}/state/generation" "${tmp_dir}/nft.log"
printf '{"result":"stale"}\n' > "${tmp_dir}/state/guard.json"
run_guard || fail_test "inactive guard should be a successful no-op"
[ ! -e "${tmp_dir}/nft.log" ] || fail_test "inactive guard mutated the lease"
[ ! -e "${tmp_dir}/state/guard.json" ] || fail_test "inactive guard status was not removed"

printf '{"result":"stale"}\n' > "${tmp_dir}/state/guard.json"
if LOCALCLASH_DNS_GUARD_INTERVAL_SECONDS=invalid run_guard; then
	fail_test "invalid inactive guard settings returned success"
fi
[ ! -e "${tmp_dir}/state/guard.json" ] || fail_test "invalid inactive guard recreated status"

printf 'dns health lease tests passed\n'
