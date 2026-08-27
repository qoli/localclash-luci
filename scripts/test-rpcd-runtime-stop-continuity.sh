#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
helper="${repo_root}/openwrt/luci-app-localclash/root/usr/libexec/rpcd/localclash"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT
awk '/^method="\$\{1:-\}"/ { exit } { print }' "$helper" > "${tmp_dir}/functions.sh"
# shellcheck disable=SC1090
. "${tmp_dir}/functions.sh"

fail_test() {
	printf 'test-rpcd-runtime-stop-continuity: %s\n' "$*" >&2
	exit 1
}

trace() {
	printf '%s\n' "$1" >> "${tmp_dir}/trace"
}

call_takeover() {
	trace "takeover $*"
	if [ "${MOCK_TAKEOVER_STOP_RC:-0}" -ne 0 ]; then
		printf '{"ok":false,"code":"mock_takeover_stop_failed"}\n'
		return "$MOCK_TAKEOVER_STOP_RC"
	fi
	printf '{"ok":true,"changed":true,"status":{"effective":false}}\n'
}

call_core() {
	trace "core $*"
	printf '{"ok":true,"changed":true,"status":{"stopped":true}}\n'
}

: > "${tmp_dir}/trace"
MOCK_TAKEOVER_STOP_RC=17
if result="$(runtime_stop)"; then
	fail_test "runtime stop continued after takeover stop failure: ${result}"
fi
grep -q '^takeover stop --json$' "${tmp_dir}/trace" || fail_test "takeover stop was not attempted"
if grep -q '^core runtime stop --json$' "${tmp_dir}/trace"; then
	fail_test "Core runtime stopped after takeover stop failure"
fi

: > "${tmp_dir}/trace"
MOCK_TAKEOVER_STOP_RC=0
result="$(runtime_stop)" || fail_test "runtime stop failed after takeover stop success: ${result}"
cat > "${tmp_dir}/expected" <<'EOF'
takeover stop --json
core runtime stop --json
EOF
diff -u "${tmp_dir}/expected" "${tmp_dir}/trace" || fail_test "runtime stop transaction order mismatch"

runtime_running() {
	return 1
}

: > "${tmp_dir}/trace"
MOCK_TAKEOVER_STOP_RC=19
if result="$(reset)"; then
	fail_test "reset continued after takeover stop failure: ${result}"
fi
if grep -q '^core reset --full --json$' "${tmp_dir}/trace"; then
	fail_test "Core reset ran after takeover stop failure"
fi

: > "${tmp_dir}/trace"
MOCK_TAKEOVER_STOP_RC=0
result="$(reset)" || fail_test "reset failed after takeover stop success: ${result}"
cat > "${tmp_dir}/expected" <<'EOF'
takeover stop --json
core reset --full --json
EOF
diff -u "${tmp_dir}/expected" "${tmp_dir}/trace" || fail_test "reset transaction order mismatch"

printf 'rpcd runtime stop continuity tests passed\n'
