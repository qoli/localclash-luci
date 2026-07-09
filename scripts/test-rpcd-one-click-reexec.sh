#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
helper="${repo_root}/openwrt/luci-app-localclash/root/usr/libexec/rpcd/localclash"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

awk '/^method="\$\{1:-\}"/ { exit } { print }' "${helper}" > "${tmp_dir}/functions.sh"
# shellcheck disable=SC1090
. "${tmp_dir}/functions.sh"

fail_test() {
	printf 'test-rpcd-one-click-reexec: %s\n' "$*" >&2
	exit 1
}

capture_reexec_failure() {
	set +e
	result="$(one_click_update_reexec)"
	result_rc=$?
	set -e
}

cat > "${tmp_dir}/new-helper" <<'EOF'
#!/bin/sh
printf '%s\n' "$$" > "$REEXEC_AFTER_PID"
printf '%s %s\n' "$1" "$2" > "$REEXEC_ARGS"
EOF
chmod +x "${tmp_dir}/new-helper"

export REEXEC_AFTER_PID="${tmp_dir}/after-pid"
export REEXEC_ARGS="${tmp_dir}/args"
export REEXEC_BEFORE_PID="${tmp_dir}/before-pid"
export REEXEC_RETURNED="${tmp_dir}/returned"
export REEXEC_TARGET="${tmp_dir}/new-helper"
export REEXEC_FUNCTIONS="${tmp_dir}/functions.sh"
cat > "${tmp_dir}/old-helper" <<'EOF'
#!/bin/sh
. "$REEXEC_FUNCTIONS"
printf '%s\n' "$$" > "$REEXEC_BEFORE_PID"
HELPER_SELF="$REEXEC_TARGET"
one_click_update_reexec
: > "$REEXEC_RETURNED"
EOF
chmod +x "${tmp_dir}/old-helper"
"${tmp_dir}/old-helper"

cmp -s "${tmp_dir}/before-pid" "${tmp_dir}/after-pid" || fail_test "re-exec did not preserve the worker PID"
grep -qx 'call one_click_update_resume' "${tmp_dir}/args" || fail_test "re-exec did not enter the resume method"
[ ! -e "${tmp_dir}/returned" ] || fail_test "old helper continued after re-exec"

HELPER_SELF="${tmp_dir}/missing-helper"
capture_reexec_failure
[ "$result_rc" -ne 0 ] || fail_test "missing new helper returned success"
printf '%s\n' "$result" | grep -q '"code":"one_click_update_helper_unavailable"' || fail_test "missing new helper was not an explicit failure: $result"

cat > "${tmp_dir}/invalid-helper" <<'EOF'
#!/bin/sh
if
EOF
chmod +x "${tmp_dir}/invalid-helper"
HELPER_SELF="${tmp_dir}/invalid-helper"
capture_reexec_failure
[ "$result_rc" -ne 0 ] || fail_test "invalid new helper returned success"
printf '%s\n' "$result" | grep -q '"code":"one_click_update_helper_invalid"' || fail_test "invalid new helper was not an explicit failure: $result"

printf 'rpcd one-click re-exec tests passed\n'
