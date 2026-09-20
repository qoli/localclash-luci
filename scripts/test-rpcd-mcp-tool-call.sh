#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
helper="${repo_root}/openwrt/luci-app-localclash/root/usr/libexec/rpcd/localclash"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

mkdir -p "${tmp_dir}/bin"
PATH="${tmp_dir}/bin:${PATH}"

cat > "${tmp_dir}/bin/jsonfilter" <<'EOF'
#!/usr/bin/env python3
import json, sys
args = sys.argv[1:]
path = expression = None
while args:
    option = args.pop(0)
    if option == '-i': path = args.pop(0)
    elif option == '-e': expression = args.pop(0)
value = json.load(open(path, encoding='utf-8'))
for key in expression[2:].split('.'):
    if not isinstance(value, dict) or key not in value:
        raise SystemExit(1)
    value = value[key]
if isinstance(value, bool): print('true' if value else 'false')
elif value is not None: print(value)
EOF

cat > "${tmp_dir}/bin/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
output=""
post_file=""
printf '%s\n' "$*" > "${MOCK_MCP_TRACE}/arguments"
while [ "$#" -gt 0 ]; do
	case "$1" in
		--output) output="$2"; shift 2 ;;
		--data-binary) post_file="${2#@}"; shift 2 ;;
		*) shift ;;
	esac
done
cp "$post_file" "${MOCK_MCP_TRACE}/request.json"
if [ "${MOCK_MCP_FAIL:-0}" = 1 ]; then
	exit 1
fi
printf '{"jsonrpc":"2.0","id":1,"result":{"content":[],"structuredContent":{"ok":true}}}\n' > "$output"
EOF
chmod +x "${tmp_dir}/bin/jsonfilter" "${tmp_dir}/bin/curl"

awk '/^method="\$\{1:-\}"/ { exit } { print }' "$helper" > "${tmp_dir}/functions.sh"
# shellcheck disable=SC1090
. "${tmp_dir}/functions.sh"

MOCK_MCP_TRACE="$tmp_dir"
export MOCK_MCP_TRACE
MCP_ADDR="0.0.0.0:8765"
output="${tmp_dir}/response.json"
mcp_tool_call subscriptions_refresh '{"force":true,"wait":true}' "$output"
python3 - "${tmp_dir}/request.json" <<'PY'
import json, sys
value = json.load(open(sys.argv[1], encoding='utf-8'))
assert value == {
    'jsonrpc': '2.0',
    'id': 1,
    'method': 'tools/call',
    'params': {'name': 'subscriptions_refresh', 'arguments': {'force': True, 'wait': True}},
}
PY
grep -q -- "--header Content-Type: application/json" "${tmp_dir}/arguments" || {
	printf 'MCP request omitted JSON content type\n' >&2
	exit 1
}
grep -q -- "--noproxy \*" "${tmp_dir}/arguments" || {
	printf 'MCP request did not disable proxy environment handling\n' >&2
	exit 1
}
grep -q 'http://127.0.0.1:8765/mcp' "${tmp_dir}/arguments" || {
	printf 'MCP request did not use loopback endpoint\n' >&2
	exit 1
}

MOCK_MCP_FAIL=1
export MOCK_MCP_FAIL
set +e
mcp_tool_call runtime_status '{}' "$output"
rc=$?
set -e
[ "$rc" -ne 0 ] || { printf 'MCP transport failure returned success\n' >&2; exit 1; }
grep -q 'local MCP HTTP request failed' "$output" || { printf 'MCP transport failure was not explicit\n' >&2; exit 1; }

printf 'rpcd MCP tool call tests passed\n'
