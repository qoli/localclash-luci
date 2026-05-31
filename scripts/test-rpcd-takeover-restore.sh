#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
helper="${repo_root}/openwrt/luci-app-localclash/root/usr/libexec/rpcd/localclash"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

awk '/^method="\$\{1:-\}"/ { exit } { print }' "${helper}" > "${tmp_dir}/functions.sh"
# shellcheck disable=SC1090
. "${tmp_dir}/functions.sh"

PATH="${tmp_dir}/bin:${PATH}"
mkdir -p "${tmp_dir}/bin"
cat > "${tmp_dir}/bin/jsonfilter" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
file=""
expr=""
while [ "$#" -gt 0 ]; do
	case "$1" in
		-i) file="$2"; shift 2 ;;
		-e) expr="$2"; shift 2 ;;
		*) shift ;;
	esac
done
case "$expr" in
	@.status.effective)
		grep -q '"effective"[[:space:]]*:[[:space:]]*true' "$file" && printf 'true\n' || printf 'false\n'
		;;
	@.status.runtime_running)
		grep -q '"runtime_running"[[:space:]]*:[[:space:]]*true' "$file" && printf 'true\n' || printf 'false\n'
		;;
	@.status.running)
		grep -q '"running"[[:space:]]*:[[:space:]]*true' "$file" && printf 'true\n' || printf 'false\n'
		;;
	@.status.profile_mode)
		sed -n 's/.*"profile_mode"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$file"
		;;
	*) exit 1 ;;
esac
EOF
chmod +x "${tmp_dir}/bin/jsonfilter"

STATE_DIR="${tmp_dir}/state"
LOG="${tmp_dir}/helper.log"
TAKEOVER_REPAIR_TICKET="${tmp_dir}/repair-ticket"
TAKEOVER_STATE_STATUS="${tmp_dir}/runtime-status"
BOOT_AUTO_RESTORE_FILE="${STATE_DIR}/boot-auto-restore-enabled"
LEGACY_TAKEOVER_INTENT_FILE="${STATE_DIR}/takeover-enabled"
mkdir -p "$STATE_DIR"

trace() {
	printf '%s\n' "$1" >> "${tmp_dir}/trace"
}

fail_test() {
	printf 'test-rpcd-takeover-restore: %s\n' "$*" >&2
	exit 1
}

core_installed() {
	return 0
}

sleep() {
	:
}

call_core() {
	trace "call_core $*"
	case "$*" in
		"runtime start --json")
			printf '{"ok":true,"changed":true,"summary":"runtime started"}\n'
			;;
		"runtime status --json")
			printf '{"status":{"running":true}}\n'
			;;
		"takeover status --json")
			printf '%s\n' "${MOCK_TAKEOVER_STATUS}"
			;;
		"takeover apply --json")
			printf '{"ok":true,"changed":true,"summary":"applied"}\n'
			;;
		"takeover stop --json")
			printf '{"ok":true,"changed":true,"summary":"stopped"}\n'
			;;
		*)
			printf '{"ok":false,"code":"unexpected_call","message":"%s"}\n' "$*"
			return 1
			;;
	esac
}

: > "${tmp_dir}/trace"
rm -f "$TAKEOVER_REPAIR_TICKET" "$TAKEOVER_STATE_STATUS" "$BOOT_AUTO_RESTORE_FILE" "$LEGACY_TAKEOVER_INTENT_FILE"
MOCK_TAKEOVER_STATUS='{"status":{"effective":false,"runtime_running":true,"profile_mode":"router"}}'
result="$(takeover_restore_run)"
printf '%s\n' "$result" | grep -q '"skipped":true' || fail_test "restore without intent should skip: ${result}"
if grep -q 'call_core' "${tmp_dir}/trace"; then
	fail_test "restore without intent should not call core"
fi

: > "${tmp_dir}/trace"
printf 'applied\n' > "$TAKEOVER_STATE_STATUS"
result="$(takeover_restore_run)"
printf '%s\n' "$result" | grep -q '"changed":true' || fail_test "restore should reapply takeover: ${result}"
grep -q '^call_core takeover status --json$' "${tmp_dir}/trace" || fail_test "restore did not inspect status"
grep -q '^call_core takeover apply --json$' "${tmp_dir}/trace" || fail_test "restore did not apply takeover"
[ -f "$TAKEOVER_REPAIR_TICKET" ] || fail_test "restore should keep same-boot repair ticket after reapply"
[ ! -f "$LEGACY_TAKEOVER_INTENT_FILE" ] || fail_test "restore should not create legacy persistent takeover intent"

: > "${tmp_dir}/trace"
MOCK_TAKEOVER_STATUS='{"status":{"effective":true,"runtime_running":true,"profile_mode":"router"}}'
rm -f "$TAKEOVER_REPAIR_TICKET" "$LEGACY_TAKEOVER_INTENT_FILE"
printf 'applied\n' > "$TAKEOVER_STATE_STATUS"
result="$(takeover_restore_run)"
printf '%s\n' "$result" | grep -q '"changed":false' || fail_test "effective takeover should be unchanged: ${result}"
if grep -q '^call_core takeover apply --json$' "${tmp_dir}/trace"; then
	fail_test "effective takeover should not be applied again"
fi
[ -f "$TAKEOVER_REPAIR_TICKET" ] || fail_test "effective restore should keep same-boot repair ticket"
[ ! -f "$LEGACY_TAKEOVER_INTENT_FILE" ] || fail_test "effective restore should not create legacy persistent takeover intent"

result="$(takeover_stop)"
printf '%s\n' "$result" | grep -q '"ok":true' || fail_test "takeover_stop failed: ${result}"
[ ! -f "$TAKEOVER_REPAIR_TICKET" ] || fail_test "takeover_stop should clear same-boot repair ticket"
[ ! -f "$TAKEOVER_STATE_STATUS" ] || fail_test "takeover_stop should clear runtime takeover status"

result="$(boot_restore_enable)"
printf '%s\n' "$result" | grep -q '"enabled":true' || fail_test "boot restore enable failed: ${result}"
[ -f "$BOOT_AUTO_RESTORE_FILE" ] || fail_test "boot restore enable should persist boot policy"

: > "${tmp_dir}/trace"
rm -f "$TAKEOVER_REPAIR_TICKET"
MOCK_TAKEOVER_STATUS='{"status":{"effective":false,"runtime_running":true,"profile_mode":"router"}}'
result="$(boot_restore_run)"
printf '%s\n' "$result" | grep -q '"changed":true' || fail_test "boot restore run should start runtime and apply takeover: ${result}"
grep -q '^call_core runtime start --json$' "${tmp_dir}/trace" || fail_test "boot restore did not start runtime"
grep -q '^call_core runtime status --json$' "${tmp_dir}/trace" || fail_test "boot restore did not verify runtime"
grep -q '^call_core takeover apply --json$' "${tmp_dir}/trace" || fail_test "boot restore did not apply takeover"
[ -f "$TAKEOVER_REPAIR_TICKET" ] || fail_test "boot restore should create same-boot repair ticket after applying takeover"

result="$(boot_restore_disable)"
printf '%s\n' "$result" | grep -q '"enabled":false' || fail_test "boot restore disable failed: ${result}"
[ ! -f "$BOOT_AUTO_RESTORE_FILE" ] || fail_test "boot restore disable should clear boot policy"

printf 'rpcd takeover restore tests passed\n'
