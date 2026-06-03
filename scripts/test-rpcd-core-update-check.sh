#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
helper="${repo_root}/openwrt/luci-app-localclash/root/usr/libexec/rpcd/localclash"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

mkdir -p "${tmp_dir}/bin"
PATH="${tmp_dir}/bin:${PATH}"

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
	'@.version')
		sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$input" | head -n 1
		;;
	'@.assets[@.arch="amd64"].url'|'@.assets[@.arch="arm64"].url')
		sed -n 's/.*"url"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$input" | head -n 1
		;;
	'@.assets[@.arch="amd64"].sha256'|'@.assets[@.arch="arm64"].sha256')
		sed -n 's/.*"sha256"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$input" | head -n 1
		;;
	*) exit 1 ;;
esac
EOF
chmod +x "${tmp_dir}/bin/jsonfilter"

awk '/^method="\$\{1:-\}"/ { exit } { print }' "${helper}" > "${tmp_dir}/functions.sh"
# shellcheck disable=SC1090
. "${tmp_dir}/functions.sh"

LOG="${tmp_dir}/helper.log"
CORE="${tmp_dir}/localclash"
printf 'installed-core\n' > "$CORE"
chmod +x "$CORE"
installed_sha="$(sha256sum "$CORE" | awk '{print $1; exit}')"

fail_test() {
	printf 'test-rpcd-core-update-check: %s\n' "$*" >&2
	exit 1
}

write_manifest() {
	sha="$1"
	output="$2"
	cat > "$output" <<EOF
{
  "schema_version": 1,
  "name": "localclash",
  "version": "v0.1.30",
  "assets": [
    { "os": "linux", "arch": "amd64", "url": "https://github.com/qoli/localClash/releases/download/v0.1.30/localclash-linux-amd64", "sha256": "$sha" },
    { "os": "linux", "arch": "arm64", "url": "https://github.com/qoli/localClash/releases/download/v0.1.30/localclash-linux-arm64", "sha256": "$sha" }
  ]
}
EOF
}

fetch_manifest() {
	output="$2"
	write_manifest "${LOCALCLASH_TEST_ASSET_SHA}" "$output"
}

LOCALCLASH_TEST_ASSET_SHA="0000000000000000000000000000000000000000000000000000000000000000"
result="$(core_update_check)"
printf '%s\n' "$result" | grep -q '"ok":true' || fail_test "check did not succeed: ${result}"
printf '%s\n' "$result" | grep -q '"latest_version":"v0.1.30"' || fail_test "latest version missing: ${result}"
printf '%s\n' "$result" | grep -q '"relation":"asset_mismatch"' || fail_test "relation mismatch: ${result}"
printf '%s\n' "$result" | grep -q '"update_available":true' || fail_test "update_available not true: ${result}"

LOCALCLASH_TEST_ASSET_SHA="$installed_sha"
result="$(core_update_check)"
printf '%s\n' "$result" | grep -q '"ok":true' || fail_test "equal check did not succeed: ${result}"
printf '%s\n' "$result" | grep -q '"relation":"equal"' || fail_test "equal relation mismatch: ${result}"
printf '%s\n' "$result" | grep -q '"update_available":false' || fail_test "update_available not false: ${result}"

rm -f "$CORE"
result="$(core_update_check || true)"
printf '%s\n' "$result" | grep -q '"ok":false' || fail_test "missing core did not fail: ${result}"
printf '%s\n' "$result" | grep -q '"code":"bootstrap_core_missing"' || fail_test "missing core code mismatch: ${result}"

printf 'rpcd core update check tests passed\n'
