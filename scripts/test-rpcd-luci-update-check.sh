#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
helper="${repo_root}/openwrt/luci-app-localclash/root/usr/libexec/rpcd/localclash"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

mkdir -p "${tmp_dir}/bin"
PATH="${tmp_dir}/bin:${PATH}"

cat > "${tmp_dir}/bin/opkg" <<'EOF'
#!/usr/bin/env sh
case "$1" in
	status)
		if [ "${LOCALCLASH_TEST_NO_VERSION:-0}" = "1" ]; then
			exit 0
		fi
		printf 'Package: luci-app-localclash\nVersion: 0.1.0-19\n'
		;;
	compare-versions)
		current="$2"
		operator="$3"
		target="$4"
		case "$operator" in
			=) [ "$current" = "$target" ] ;;
			'>') [ "$current" = "0.1.0-20" ] && [ "$target" = "0.1.0-19" ] ;;
			'<') [ "$current" = "0.1.0-19" ] && [ "$target" = "0.1.0-20" ] ;;
			*) exit 1 ;;
		esac
		;;
	*) exit 1 ;;
esac
EOF
chmod +x "${tmp_dir}/bin/opkg"

cat > "${tmp_dir}/bin/jsonfilter" <<'EOF'
#!/usr/bin/env sh
input=""
expr=""
while [ "$#" -gt 0 ]; do
	case "$1" in
		-i)
			input="$2"
			shift 2
			;;
		-e)
			expr="$2"
			shift 2
			;;
		*)
			shift
			;;
	esac
done
case "$expr" in
	'@.tag_name')
		sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$input"
		;;
	'@.assets[*].browser_download_url')
		sed -n 's/.*"browser_download_url"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$input"
		;;
	*) exit 1 ;;
esac
EOF
chmod +x "${tmp_dir}/bin/jsonfilter"

awk '/^method="\$\{1:-\}"/ { exit } { print }' "${helper}" > "${tmp_dir}/functions.sh"
# shellcheck disable=SC1090
. "${tmp_dir}/functions.sh"

LOG="${tmp_dir}/helper.log"

fail_test() {
	printf 'test-rpcd-luci-update-check: %s\n' "$*" >&2
	exit 1
}

fetch_url() {
	output="$2"
	cat > "$output" <<'EOF'
{
  "tag_name": "v0.1.0-20",
  "assets": [
    { "browser_download_url": "https://github.com/qoli/localclash-luci/releases/download/v0.1.0-20/luci-app-localclash_0.1.0-20_all.ipk" },
    { "browser_download_url": "https://github.com/qoli/localclash-luci/releases/download/v0.1.0-20/luci-app-localclash_0.1.0-20_all.ipk.sha256" }
  ]
}
EOF
}

result="$(luci_update_check)"
printf '%s\n' "$result" | grep -q '"ok":true' || fail_test "check did not succeed: ${result}"
printf '%s\n' "$result" | grep -q '"current_version":"0.1.0-19"' || fail_test "current version missing: ${result}"
printf '%s\n' "$result" | grep -q '"latest_version":"0.1.0-20"' || fail_test "latest version missing: ${result}"
printf '%s\n' "$result" | grep -q '"relation":"target_newer"' || fail_test "relation mismatch: ${result}"
printf '%s\n' "$result" | grep -q '"update_available":true' || fail_test "update_available not true: ${result}"

export LOCALCLASH_TEST_NO_VERSION=1
result="$(luci_update_check || true)"
unset LOCALCLASH_TEST_NO_VERSION
printf '%s\n' "$result" | grep -q '"ok":false' || fail_test "missing version did not fail: ${result}"
printf '%s\n' "$result" | grep -q '"code":"luci_package_version_missing"' || fail_test "missing version code mismatch: ${result}"

printf 'rpcd luci update check tests passed\n'
