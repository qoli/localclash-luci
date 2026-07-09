#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
helper="${repo_root}/openwrt/luci-app-localclash/root/usr/libexec/rpcd/localclash"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

mkdir -p "${tmp_dir}/bin"
PATH="${tmp_dir}/bin:${PATH}"
cat > "${tmp_dir}/bin/jsonfilter" <<'EOF'
#!/bin/sh
expr=""
while [ "$#" -gt 0 ]; do
	case "$1" in
		-e) expr="$2"; shift 2 ;;
		*) shift ;;
	esac
done
case "$expr" in
	*.url) printf 'https://example.invalid/localclash\n' ;;
	*.sha256) printf 'fixture-sha\n' ;;
	@.version) printf 'v-test\n' ;;
	*) exit 1 ;;
esac
EOF
chmod +x "${tmp_dir}/bin/jsonfilter"

awk '/^method="\$\{1:-\}"/ { exit } { print }' "${helper}" > "${tmp_dir}/functions.sh"
# shellcheck disable=SC1090
. "${tmp_dir}/functions.sh"

CORE="${tmp_dir}/localclash"
LOG="${tmp_dir}/helper.log"

fail_test() {
	printf 'test-rpcd-bootstrap-core-service: %s\n' "$*" >&2
	exit 1
}

router_arch() {
	printf 'test-arch\n'
}

fetch_manifest() {
	: > "$2"
}

fetch_url_verified() {
	printf 'new-core\n' > "$2"
}

install_base_assets() {
	printf 'assets\n' >> "${tmp_dir}/order"
	return 0
}

service_start() {
	grep -qx 'new-core' "$CORE" || fail_test "service restart ran before atomic core installation"
	printf 'service\n' >> "${tmp_dir}/order"
	printf '{"ok":false,"code":"service_restart_failed","message":"restart failed","details":{},"next_actions":[]}\n'
	return 1
}

: > "${tmp_dir}/order"
set +e
result="$(bootstrap_core)"
rc=$?
set -e

[ "$rc" -ne 0 ] || fail_test "bootstrap core hid the service restart failure"
printf '%s\n' "$result" | grep -q '"code":"service_restart_failed"' || fail_test "bootstrap core replaced the service failure details: $result"
printf '%s\n' "$result" | grep -q '"code":"service_start_failed"' && fail_test "bootstrap core returned a generic service error"
printf 'service\n' > "${tmp_dir}/expected-order"
diff -u "${tmp_dir}/expected-order" "${tmp_dir}/order" || fail_test "base assets ran after a failed service restart"

service_start() {
	grep -qx 'new-core' "$CORE" || fail_test "service restart ran before atomic core installation"
	printf 'service\n' >> "${tmp_dir}/order"
	printf '{"ok":true,"service":{"running":true},"mcp":{"healthy":true}}\n'
}

: > "${tmp_dir}/order"
result="$(bootstrap_core)"
printf '%s\n' "$result" | grep -q '"ok":true' || fail_test "bootstrap core did not succeed after service restart: $result"
printf 'service\nassets\n' > "${tmp_dir}/expected-order"
diff -u "${tmp_dir}/expected-order" "${tmp_dir}/order" || fail_test "service restart did not immediately follow core installation"

install_base_assets() {
	printf 'assets\n' >> "${tmp_dir}/order"
	printf '{"ok":false,"code":"assets_failed","message":"assets failed","details":{},"next_actions":[]}\n'
	return 1
}

: > "${tmp_dir}/order"
set +e
result="$(bootstrap_core)"
rc=$?
set -e
[ "$rc" -ne 0 ] || fail_test "base asset failure returned success"
printf '%s\n' "$result" | grep -q '"code":"assets_failed"' || fail_test "base asset failure was not preserved: $result"
printf 'service\nassets\n' > "${tmp_dir}/expected-order"
diff -u "${tmp_dir}/expected-order" "${tmp_dir}/order" || fail_test "service was not restarted before a base asset failure"

printf 'rpcd bootstrap core service tests passed\n'
