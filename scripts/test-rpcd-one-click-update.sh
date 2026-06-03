#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
helper="${repo_root}/openwrt/luci-app-localclash/root/usr/libexec/rpcd/localclash"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

mkdir -p "${tmp_dir}/bin"
PATH="${tmp_dir}/bin:${PATH}"

cat > "${tmp_dir}/bin/jsonfilter" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
input=""
expr=""
mode=""
while [ "$#" -gt 0 ]; do
	case "$1" in
		-i) input="$2"; mode="file"; shift 2 ;;
		-s) input="$2"; mode="string"; shift 2 ;;
		-e) expr="$2"; shift 2 ;;
		*) shift ;;
	esac
done
if [ "$mode" = "string" ]; then
	content="$input"
else
	content="$(cat "$input")"
fi
json_bool() {
	field="$1"
	if printf '%s\n' "$content" | grep -q "\"$field\"[[:space:]]*:[[:space:]]*true"; then
		printf 'true\n'
		return 0
	fi
	if printf '%s\n' "$content" | grep -q "\"$field\"[[:space:]]*:[[:space:]]*false"; then
		printf 'false\n'
		return 0
	fi
	return 1
}
case "$expr" in
	@.changed)
		json_bool changed
		;;
	@.luci.changed)
		printf '%s\n' "$content" | grep -q '"luci"[[:space:]]*:[[:space:]]*{[^}]*"changed"[[:space:]]*:[[:space:]]*true' && printf 'true\n' || printf 'false\n'
		;;
	@.status.running)
		json_bool running
		;;
	@.status.effective)
		json_bool effective
		;;
	@.status.configured)
		json_bool configured
		;;
	@.mcp.healthy)
		json_bool healthy
		;;
	@.status.profile_mode)
		printf '%s\n' "$content" | sed -n 's/.*"profile_mode"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p'
		;;
	*) exit 1 ;;
esac
EOF
chmod +x "${tmp_dir}/bin/jsonfilter"

awk '/^method="\$\{1:-\}"/ { exit } { print }' "${helper}" > "${tmp_dir}/functions.sh"
# shellcheck disable=SC1090
. "${tmp_dir}/functions.sh"

LOG="${tmp_dir}/helper.log"
STATE_DIR="${tmp_dir}/state"
mkdir -p "$STATE_DIR"

trace() {
	printf '%s\n' "$1" >> "${tmp_dir}/trace"
}

fail_test() {
	printf 'test-rpcd-one-click-update: %s\n' "$*" >&2
	exit 1
}

core_installed() {
	return 0
}

sleep() {
	:
}

luci_update() {
	trace "luci_update"
	printf '{"ok":true,"changed":true,"summary":"LuCI updated"}\n'
}

bootstrap_core() {
	trace "bootstrap_core"
	printf '{"ok":true,"changed":true,"summary":"core updated"}\n'
}

service_status() {
	trace "service_status"
	printf '{"ok":true,"mcp":{"healthy":true},"summary":"service running"}\n'
}

takeover_apply() {
	trace "takeover_apply"
	printf '{"ok":true,"changed":true,"summary":"takeover applied"}\n'
}

call_core() {
	trace "call_core $*"
	case "$*" in
		"runtime status --json")
			printf '{"status":{"running":true}}\n'
			;;
		"takeover status --json")
			printf '{"status":{"effective":true,"runtime_running":true,"profile_mode":"router"}}\n'
			;;
		"component update mihomo --json")
			if [ "${MOCK_MIHOMO_CHANGED_MISSING:-0}" = "1" ]; then
				printf '{"ok":true,"summary":"mihomo updated"}\n'
			else
				printf '{"ok":true,"changed":true,"summary":"mihomo updated"}\n'
			fi
			;;
		"component update dashboard --json")
			printf '{"ok":true,"changed":true,"summary":"dashboard updated"}\n'
			;;
		"subscription status --json")
			printf '{"status":{"configured":true}}\n'
			;;
		"subscription refresh --json")
			printf '{"ok":true,"changed":true,"summary":"subscription refreshed"}\n'
			;;
		"config render --json")
			printf '{"ok":true,"changed":true,"summary":"config rendered"}\n'
			;;
		"mihomo config-test --json")
			printf '{"ok":true,"changed":false,"summary":"config valid"}\n'
			;;
		"runtime restart --strategy process_restart --json")
			printf '{"ok":true,"changed":true,"summary":"runtime restarted"}\n'
			;;
		*)
			printf '{"ok":false,"code":"unexpected_call","message":"%s"}\n' "$*"
			return 1
			;;
	esac
}

: > "${tmp_dir}/trace"
result="$(one_click_update_run)"
printf '%s\n' "$result" | grep -q '"ok":true' || fail_test "one_click_update_run failed: ${result}"
printf '%s\n' "$result" | grep -q '"restart_strategy":"process_restart"' || fail_test "restart strategy mismatch: ${result}"
printf '%s\n' "$result" | grep -q '"takeover_recovered":true' || fail_test "takeover was not recovered: ${result}"
one_click_update_luci_changed "$result" || fail_test "LuCI changed marker was not detected for service reload"

expected="${tmp_dir}/expected-trace"
cat > "$expected" <<EOF
call_core runtime status --json
call_core takeover status --json
luci_update
bootstrap_core
service_status
call_core component update mihomo --json
call_core component update dashboard --json
call_core subscription status --json
call_core subscription refresh --json
call_core config render --json
call_core mihomo config-test --json
call_core runtime restart --strategy process_restart --json
takeover_apply
call_core takeover status --json
service_status
EOF

if ! diff -u "$expected" "${tmp_dir}/trace"; then
	fail_test "one-click update order mismatch"
fi

: > "${tmp_dir}/trace"
MOCK_MIHOMO_CHANGED_MISSING=1
result="$(one_click_update_run || true)"
unset MOCK_MIHOMO_CHANGED_MISSING
printf '%s\n' "$result" | grep -q '"ok":false' || fail_test "missing changed did not fail: ${result}"
printf '%s\n' "$result" | grep -q '"code":"component_update_result_invalid"' || fail_test "missing changed code mismatch: ${result}"

printf 'rpcd one-click update tests passed\n'
