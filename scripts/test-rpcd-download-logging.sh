#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
helper="${repo_root}/openwrt/luci-app-localclash/root/usr/libexec/rpcd/localclash"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

mkdir -p "${tmp_dir}/bin"
cat > "${tmp_dir}/bin/uclient-fetch" <<'EOF'
#!/usr/bin/env sh
printf 'Failed to send request: Operation not permitted\n' >&2
exit 4
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
