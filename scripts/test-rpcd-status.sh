#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
helper="${repo_root}/openwrt/luci-app-localclash/root/usr/libexec/rpcd/localclash"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

awk '/^method="\$\{1:-\}"/ { exit } { print }' "${helper}" > "${tmp_dir}/functions.sh"
# shellcheck disable=SC1090
. "${tmp_dir}/functions.sh"

CORE="${tmp_dir}/localclash"
STATE_DIR="${tmp_dir}/state"
LOG="${tmp_dir}/helper.log"
MOCK_CORE_INSTALLED=true
MOCK_CORE_MODE=success
mkdir -p "${STATE_DIR}"
: > "${CORE}"
chmod 755 "${CORE}"

fail_test() {
	printf 'test-rpcd-status: %s\n' "$*" >&2
	exit 1
}

jsonfilter() {
	printf '%s\n' call >> "${tmp_dir}/status-jsonfilter-calls"
	python3 - "$@" <<'PY'
import json
import shlex
import sys

args = iter(sys.argv[1:])
document, expressions = None, []
for arg in args:
    if arg == "-i":
        with open(next(args), encoding="utf-8") as source:
            document = json.load(source)
    elif arg == "-s":
        document = json.loads(next(args))
    elif arg == "-e":
        expressions.append(next(args))

def matches(expression):
    value = document
    for field in expression.removeprefix("@.").split("."):
        wildcard = field.endswith("[*]")
        field = field[:-3] if wildcard else field
        if not isinstance(value, dict) or field not in value:
            return []
        value = value[field]
        if wildcard:
            return value if isinstance(value, list) else []
    return [] if value is None else [value]

rc = 0
for expression in expressions:
    name, sep, selector = expression.partition("=")
    values = matches(selector if sep else name)
    if not values:
        rc = 1
    elif sep:
        serialized = r"\ ".join(shlex.quote(str(int(v) if isinstance(v, bool) else v)) for v in values)
        print(f"export {name}={serialized}; ", end="")
    else:
        for value in values:
            print(json.dumps(value) if isinstance(value, bool) else value)
sys.exit(rc)
PY
}

core_installed() {
	[ "$MOCK_CORE_INSTALLED" = true ]
}

call_core_product_status() {
	printf '%s\n' call >> "${tmp_dir}/core-status-calls"
	case "$MOCK_CORE_MODE" in
		success|numeric_boolean)
			local running=true
			if [ "$MOCK_CORE_MODE" = numeric_boolean ]; then running=1; fi
			cat <<JSON
{"ok":true,"status":{"components":{"base_assets":{"installed":true,"path":"${STATE_DIR}","missing":["cache","provider with spaces"],"default_template":"${STATE_DIR}/policy-templates/localclash-default.json","rule_source_dir":"${STATE_DIR}/owner's rules","default_patch_count":12,"default_patches_installed":true},"mihomo":{"installed":true},"dashboard":{"installed":true}},"config":{"runtime_profile":{"path":"${STATE_DIR}/localclash-runtime.json","exists":true,"mode":"router","core":"smart","core_path":"bin/linux-arm64/lc-mihomo-smart","runtime_source":"file","user_profile_path":"${STATE_DIR}/localclash-user.json","user_profile_exists":false}},"subscription":{"configured":true,"merged":{"exists":true}},"runtime":{"running":$running}}}
JSON
			;;
		crash)
			printf 'unexpected fault address 0x50ee68\nfatal error: fault\n[signal SIGSEGV: segmentation violation]\n' >&2
			return 2
			;;
		invalid)
			printf '{"ok":true,"status":{}}\n'
			;;
		typed_failure)
			printf '{"ok":false,"code":"workspace_invalid","message":"workspace cannot be read"}\n'
			return 1
			;;
	esac
}

service_body() {
	printf '%s' '"service":{"installed":true,"enabled":true,"running":true},"mcp":{"healthy":true}'
}

boot_restore_json() {
	printf '%s' '"boot_auto_restore":{"enabled":true}'
}

luci_package_json() {
	printf '%s' '"luci_package":{"installed":true,"version":"test"}'
}

runtime_profile_body() {
	printf '%s' '"runtime_profile":{"path":"","exists":false,"mode":"","core":"","core_path":"","runtime_source":"","user_profile_path":"","user_profile_exists":false}'
}

base_assets_body() {
	printf '%s' '"base_assets":{"installed":false,"path":"","source":"localclash-core","missing":"","policy":"","default_template":"","rule_source_dir":"","default_patch_count":0,"default_patches_installed":false}'
}

: > "${tmp_dir}/core-status-calls"
: > "${tmp_dir}/status-jsonfilter-calls"
result="$(status)" || fail_test "valid Core status returned failure: ${result}"
python3 -c 'import json,sys
value=json.loads(sys.stdin.read())
assert value["ok"] is True
assert value["core"]["installed"] is True
assert value["base_assets"]["installed"] is True
assert value["base_assets"]["default_patch_count"] == 12
assert value["base_assets"]["default_patches_installed"] is True
assert value["base_assets"]["missing"] == "cache provider with spaces"
assert value["base_assets"]["rule_source_dir"].endswith("/owner" + chr(39) + "s rules")
assert value["core"]["version"] == ""
assert value["runtime_profile"]["core"] == "smart"
assert value["status"]["components"]["mihomo"]["installed"] is True
assert value["status"]["subscription"]["configured"] is True
assert value["status"]["runtime"]["running"] is True' <<<"${result}" || fail_test "valid Core status was mapped incorrectly: ${result}"
[ "$(wc -l < "${tmp_dir}/core-status-calls")" -eq 1 ] || fail_test "status must call the Core exactly once"
[ "$(wc -l < "${tmp_dir}/status-jsonfilter-calls")" -eq 2 ] || fail_test "status must extract Core flags and optional fields in two passes"

MOCK_CORE_MODE=crash
if result="$(status)"; then
	fail_test "crashed Core returned a successful status"
fi
python3 -c 'import json,sys
value=json.loads(sys.stdin.read())
assert value["ok"] is False
assert value["code"] == "core_status_unavailable"
assert value["details"]["core"]["installed"] is True
assert value["details"]["core"]["state"] == "unavailable"
assert value["details"]["core"]["exit_code"] == 2
assert "SIGSEGV" in value["details"]["core"]["error_excerpt"]
assert "工作区未被判定为已重置" in value["message"]
assert "status" not in value
assert "base_assets" not in value' <<<"${result}" || fail_test "crashed Core was exposed as missing state: ${result}"

for MOCK_CORE_MODE in invalid numeric_boolean; do
	if result="$(status)"; then
		fail_test "$MOCK_CORE_MODE Core status returned success"
	fi
	python3 -c 'import json,sys
value=json.loads(sys.stdin.read())
assert value["ok"] is False
assert value["code"] == "core_status_invalid"
assert "状态均未知" in value["message"]
assert "status" not in value' <<<"${result}" || fail_test "$MOCK_CORE_MODE Core status was not rejected explicitly: ${result}"
done

MOCK_CORE_MODE=typed_failure
if result="$(status)"; then
	fail_test "typed Core failure returned success"
fi
python3 -c 'import json,sys
value=json.loads(sys.stdin.read())
assert value == {"ok":False,"code":"workspace_invalid","message":"workspace cannot be read"}' <<<"${result}" || fail_test "typed Core failure cause was not preserved: ${result}"

MOCK_CORE_INSTALLED=false
if result="$(status)"; then :; else fail_test "missing Core status returned failure: ${result}"; fi
python3 -c 'import json,sys
value=json.loads(sys.stdin.read())
assert value["ok"] is True
assert value["core"]["installed"] is False
assert value["status"]["components"]["mihomo"]["installed"] is False' <<<"${result}" || fail_test "genuinely missing Core was not represented as missing: ${result}"

printf 'rpcd status failure reporting tests passed\n'
