#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
helper="${repo_root}/openwrt/luci-app-localclash/root/usr/libexec/rpcd/localclash"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

mkdir -p "${tmp_dir}/bin"
cat > "${tmp_dir}/bin/uclient-fetch" <<'EOF'
#!/usr/bin/env sh
output=""
while [ "$#" -gt 0 ]; do
	case "$1" in
		-O) output="$2"; shift 2 ;;
		*) shift ;;
	esac
done
case "${MOCK_FETCH_MODE:-failure}" in
	failure)
		printf 'Failed to send request: Operation not permitted\n' >&2
		exit 4
		;;
	missing)
		exit 0
		;;
	empty)
		: > "$output"
		exit 0
		;;
	timeout)
		trap 'exit 0' TERM
		while :; do sleep 1; done
		;;
	*)
		exit 64
		;;
esac
EOF
cat > "${tmp_dir}/bin/nslookup" <<'EOF'
#!/usr/bin/env sh
cat <<OUT
Server:		127.0.0.1
Address:	127.0.0.1:53

Name:	example.invalid
Address: 192.0.2.1
OUT
EOF
chmod +x "${tmp_dir}/bin/uclient-fetch" "${tmp_dir}/bin/nslookup"
PATH="${tmp_dir}/bin:${PATH}"

awk '/^method="\$\{1:-\}"/ { exit } { print }' "${helper}" > "${tmp_dir}/functions.sh"
(
	unset LOCALCLASH_FETCH_TIMEOUT
	. "${tmp_dir}/functions.sh"
	[ "$FETCH_TIMEOUT" = 120 ] || {
		printf 'test-rpcd-download-logging: default fetch timeout must be 120s\n' >&2
		exit 1
	}
)
(
	LOCALCLASH_FETCH_TIMEOUT=7
	. "${tmp_dir}/functions.sh"
	[ "$FETCH_TIMEOUT" = 7 ] || {
		printf 'test-rpcd-download-logging: explicit fetch timeout override was ignored\n' >&2
		exit 1
	}
)
# shellcheck disable=SC1090
. "${tmp_dir}/functions.sh"

LOG="${tmp_dir}/helper.log"
FETCH_TIMEOUT=2
output="${tmp_dir}/download.out"

if fetch_single_url "https://example.invalid/release.json" "$output" 2>/dev/null; then
	printf 'test-rpcd-download-logging: failed download unexpectedly succeeded\n' >&2
	exit 1
fi

grep -q '下载：开始 downloader=uclient-fetch host=example.invalid timeout=2s' "$LOG"
grep -Fq '下载器[uclient-fetch]：Failed to send request: Operation not permitted' "$LOG"
grep -q 'reason=connect_failed' "$LOG"
grep -q 'DNS诊断 host=example.invalid exit_code=0 result=.*192.0.2.1' "$LOG"
grep -q '下载：失败 downloader=uclient-fetch host=example.invalid .* bytes=0 exit_code=4' "$LOG"

for mode in missing empty; do
	: > "$LOG"
	MOCK_FETCH_MODE="$mode"
	export MOCK_FETCH_MODE
	if fetch_single_url "https://example.invalid/release.json" "$output" 2>/dev/null; then
		printf 'test-rpcd-download-logging: %s downloader output unexpectedly succeeded\n' "$mode" >&2
		exit 1
	fi
	grep -q "下载：诊断 reason=output_${mode}" "$LOG"
	grep -q '下载：失败 downloader=uclient-fetch host=example.invalid .* bytes=0 exit_code=1' "$LOG"
done
unset MOCK_FETCH_MODE

: > "$LOG"
MOCK_FETCH_MODE=timeout
export MOCK_FETCH_MODE
FETCH_TIMEOUT=1
if fetch_single_url "https://example.invalid/release.json" "$output" 2>/dev/null; then
	printf 'test-rpcd-download-logging: watchdog timeout unexpectedly succeeded\n' >&2
	exit 1
fi
unset MOCK_FETCH_MODE
grep -q '下载：超时 https://example.invalid/release.json timeout=1s' "$LOG"
grep -q '下载：失败 downloader=uclient-fetch host=example.invalid .* bytes=0 exit_code=124' "$LOG"

: > "$LOG"
printf 'payload\n' > "${tmp_dir}/commit-source"
if commit_download_output "${tmp_dir}/commit-source" "${tmp_dir}/missing/output" 2>/dev/null; then
	printf 'test-rpcd-download-logging: failed atomic move unexpectedly succeeded\n' >&2
	exit 1
fi
grep -q '下载：提交失败 reason=atomic_move_failed' "$LOG"
[ -f "${tmp_dir}/commit-source" ]

printf '%s  package.ipk\n' 'ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789' > "${tmp_dir}/valid.sha256"
[ "$(sha256_expected_from_file "${tmp_dir}/valid.sha256")" = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789' ]
printf 'not-a-sha256 package.ipk\n' > "${tmp_dir}/invalid.sha256"
[ -z "$(sha256_expected_from_file "${tmp_dir}/invalid.sha256")" ]

: > "$LOG"
for line in $(seq 1 120); do
	printf 'line-%03d %s\n' "$line" '"quoted" backslash\' >> "$LOG"
done
bootstrap_logs > "${tmp_dir}/logs.json"
python3 - "${tmp_dir}/logs.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    payload = json.load(handle)

assert payload["ok"] is True
assert payload["complete"] is True
assert payload["line_count"] == 120
assert len(payload["logs"]) == 120
assert payload["logs"][0] == 'line-001 "quoted" backslash\\'
assert payload["logs"][-1] == 'line-120 "quoted" backslash\\'
PY

printf 'rpcd download logging tests passed\n'
