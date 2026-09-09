#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
guard="$repo_root/openwrt/luci-app-localclash/root/usr/libexec/localclash/dns-guard"
tmp_dir="$(mktemp -d)"
runtime_pid=""
cleanup() {
	[ -z "$runtime_pid" ] || kill "$runtime_pid" >/dev/null 2>&1 || true
	rm -rf "$tmp_dir"
}
trap cleanup EXIT

fail_test() {
	printf 'test-dns-guard-deadman: %s\n' "$*" >&2
	exit 1
}

mkdir -p "$tmp_dir/bin" "$tmp_dir/state"
sleep 60 &
runtime_pid=$!
printf 'applied\n' > "$tmp_dir/state/status"
printf 'test-generation\n' > "$tmp_dir/state/generation"
printf '%s\n' "$tmp_dir/runtime.json" > "$tmp_dir/state/runtime-state-file"
printf '{}\n' > "$tmp_dir/runtime.json"

cat > "$tmp_dir/bin/jsonfilter" <<'EOF_JSONFILTER'
#!/bin/sh
expression=""
while [ "$#" -gt 0 ]; do
	case "$1" in
		-e) expression="$2"; shift 2 ;;
		*) shift ;;
	esac
done
case "$expression" in
	@.state) printf 'running\n' ;;
	@.boot_id) printf 'test-boot-id\n' ;;
	@.pid) printf '%s\n' "$MOCK_RUNTIME_PID" ;;
	@.launcher_path) printf '/mock/mihomo\n' ;;
	*) exit 1 ;;
esac
EOF_JSONFILTER

cat > "$tmp_dir/bin/cat" <<'EOF_CAT'
#!/bin/sh
case "$1" in
	/proc/sys/kernel/random/boot_id) printf 'test-boot-id\n' ;;
	*) exec /bin/cat "$@" ;;
esac
EOF_CAT

cat > "$tmp_dir/bin/readlink" <<'EOF_READLINK'
#!/bin/sh
case "$1" in
	/proc/*/exe) printf '/mock/mihomo\n' ;;
	*) exec /usr/bin/readlink "$@" ;;
esac
EOF_READLINK

cat > "$tmp_dir/bin/nft" <<'EOF_NFT'
#!/bin/sh
[ "$1" != -f ] || {
	cp "$2" "$MOCK_NFT_BATCH_LOG"
	exit 0
}
case "$1 $2 $3 $4 $5" in
	'list chain inet fw4 localclash_dns_redirect')
		printf 'comment "localClash DNS hijack to dnsmasq"\ncomment "localClash active DNS redirect"\n'
		;;
	'list chain inet fw4 nat_output')
		printf 'comment "localClash active local DNS redirect"\n'
		;;
	'list set inet fw4 localclash_dns_active4'|'list set inet fw4 localclash_dns_active6')
		printf 'set present\n'
		;;
	*) exit 1 ;;
esac
EOF_NFT
chmod +x "$tmp_dir/bin/jsonfilter" "$tmp_dir/bin/cat" "$tmp_dir/bin/readlink" "$tmp_dir/bin/nft"

PATH="$tmp_dir/bin:$PATH" \
MOCK_RUNTIME_PID="$runtime_pid" \
MOCK_NFT_BATCH_LOG="$tmp_dir/batch.nft" \
LOCALCLASH_TAKEOVER_STATE_DIR="$tmp_dir/state" \
LOCALCLASH_NFT="$tmp_dir/bin/nft" \
LOCALCLASH_DNS_LEASE_SECONDS=15 \
LOCALCLASH_DNS_GUARD_INTERVAL_SECONDS=5 \
"$guard" once

cat > "$tmp_dir/expected.nft" <<'EOF_EXPECTED'
flush set inet fw4 localclash_dns_active4
flush set inet fw4 localclash_dns_active6
add element inet fw4 localclash_dns_active4 { 0.0.0.0/0 timeout 15s }
add element inet fw4 localclash_dns_active6 { ::/0 timeout 15s }
EOF_EXPECTED
diff -u "$tmp_dir/expected.nft" "$tmp_dir/batch.nft" || fail_test 'lease batch did not atomically replace both active tokens'
grep -q '"result":"success","reason":"runtime_lease_refreshed","dns_path":"mihomo"' "$tmp_dir/state/dns-guard-status.json" || fail_test 'successful renewal status is incorrect'

kill "$runtime_pid"
wait "$runtime_pid" 2>/dev/null || true
runtime_pid=""
rm -f "$tmp_dir/batch.nft"
if PATH="$tmp_dir/bin:$PATH" \
	MOCK_RUNTIME_PID=999999 \
	MOCK_NFT_BATCH_LOG="$tmp_dir/batch.nft" \
	LOCALCLASH_TAKEOVER_STATE_DIR="$tmp_dir/state" \
	LOCALCLASH_NFT="$tmp_dir/bin/nft" \
	"$guard" once; then
	fail_test 'inactive runtime unexpectedly renewed the lease'
fi
[ ! -e "$tmp_dir/batch.nft" ] || fail_test 'inactive runtime wrote an nft lease batch'
grep -q '"result":"failure","reason":"mihomo_runtime_inactive","dns_path":"lease_expiring"' "$tmp_dir/state/dns-guard-status.json" || fail_test 'inactive runtime status is incorrect'

rm -f "$tmp_dir/state/generation"
PATH="$tmp_dir/bin:$PATH" \
MOCK_RUNTIME_PID=999999 \
MOCK_NFT_BATCH_LOG="$tmp_dir/batch.nft" \
LOCALCLASH_TAKEOVER_STATE_DIR="$tmp_dir/state" \
LOCALCLASH_NFT="$tmp_dir/bin/nft" \
"$guard" once
[ ! -e "$tmp_dir/state/dns-guard-status.json" ] || fail_test 'inactive takeover retained stale guard status'

printf 'dns guard dead-man contract tests passed\n'
