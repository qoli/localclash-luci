#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
helper="${repo_root}/openwrt/luci-app-localclash/root/usr/libexec/rpcd/localclash"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

unset LOCALCLASH_GITHUB_RELEASE_MIRRORS
unset LOCALCLASH_GITHUB_RAW_MIRRORS
unset LOCALCLASH_GITHUB_MIRROR

awk '/^method="\$\{1:-\}"/ { exit } { print }' "${helper}" > "${tmp_dir}/functions.sh"
# shellcheck disable=SC1090
. "${tmp_dir}/functions.sh"

fail() {
	printf 'test-rpcd-download-candidates: %s\n' "$*" >&2
	exit 1
}

assert_file_equals() {
	local got expected
	got="$1"
	expected="$2"
	if ! diff -u "${expected}" "${got}"; then
		fail "candidate list mismatch"
	fi
}

assert_no_old_mirrors() {
	local file
	file="$1"
	if grep -Eq 'gh\.llkk\.cc|v1\.ax|ghp\.xptvhelper\.link|ghproxy\.imciel\.com|gitproxy\.mrhjx\.cn|gh\.jasonzeng\.dev|gh\.monlor\.com|gh\.noki\.icu' "${file}"; then
		fail "candidate list contains an old default mirror: ${file}"
	fi
}

mkdir -p "${MIRROR_CACHE_DIR}"
printf '%s\n' 'https://gh-proxy.com/https://github.com' > "${MIRROR_CACHE_DIR}/release"
github_download_candidates 'https://github.com/qoli/localClash/releases/latest/download/localclash-release-manifest.json' > "${tmp_dir}/release.out"
cat > "${tmp_dir}/release.expected" <<'EOF'
https://gh-proxy.com/https://github.com/qoli/localClash/releases/latest/download/localclash-release-manifest.json
https://proxy.vvvv.ee/https://github.com/qoli/localClash/releases/latest/download/localclash-release-manifest.json
https://cors.isteed.cc/https://github.com/qoli/localClash/releases/latest/download/localclash-release-manifest.json
https://gh.ddlc.top/https://github.com/qoli/localClash/releases/latest/download/localclash-release-manifest.json
https://gh.xmly.dev/https://github.com/qoli/localClash/releases/latest/download/localclash-release-manifest.json
https://ghproxy.net/https://github.com/qoli/localClash/releases/latest/download/localclash-release-manifest.json
https://ghfast.top/https://github.com/qoli/localClash/releases/latest/download/localclash-release-manifest.json
https://github.com/qoli/localClash/releases/latest/download/localclash-release-manifest.json
EOF
assert_file_equals "${tmp_dir}/release.out" "${tmp_dir}/release.expected"
assert_no_old_mirrors "${tmp_dir}/release.out"

printf '%s\n' 'https://gh-proxy.com/https://api.github.com' > "${MIRROR_CACHE_DIR}/api"
github_download_candidates 'https://api.github.com/repos/qoli/localclash-luci/releases/latest' > "${tmp_dir}/api.out"
cat > "${tmp_dir}/api.expected" <<'EOF'
https://gh-proxy.com/https://api.github.com/repos/qoli/localclash-luci/releases/latest
https://proxy.vvvv.ee/https://api.github.com/repos/qoli/localclash-luci/releases/latest
https://api.github.com/repos/qoli/localclash-luci/releases/latest
EOF
assert_file_equals "${tmp_dir}/api.expected" "${tmp_dir}/api.out"
assert_no_old_mirrors "${tmp_dir}/api.out"

printf '%s\n' 'https://gh-proxy.com/https://raw.githubusercontent.com' > "${MIRROR_CACHE_DIR}/raw"
github_download_candidates 'https://raw.githubusercontent.com/vernesong/OpenClash/core/master/core_version' > "${tmp_dir}/raw.out"
cat > "${tmp_dir}/raw.expected" <<'EOF'
https://gh-proxy.com/https://raw.githubusercontent.com/vernesong/OpenClash/core/master/core_version
https://proxy.vvvv.ee/https://raw.githubusercontent.com/vernesong/OpenClash/core/master/core_version
https://cors.isteed.cc/https://raw.githubusercontent.com/vernesong/OpenClash/core/master/core_version
https://gh.ddlc.top/https://raw.githubusercontent.com/vernesong/OpenClash/core/master/core_version
https://gh.xmly.dev/https://raw.githubusercontent.com/vernesong/OpenClash/core/master/core_version
https://ghproxy.net/https://raw.githubusercontent.com/vernesong/OpenClash/core/master/core_version
https://ghfast.top/https://raw.githubusercontent.com/vernesong/OpenClash/core/master/core_version
https://fastly.jsdelivr.net/gh/vernesong/OpenClash@core/master/core_version
https://raw.githubusercontent.com/vernesong/OpenClash/core/master/core_version
EOF
assert_file_equals "${tmp_dir}/raw.out" "${tmp_dir}/raw.expected"
assert_no_old_mirrors "${tmp_dir}/raw.out"

GITHUB_MIRROR=direct
github_download_candidates 'https://github.com/qoli/localClash/releases/latest/download/localclash-release-manifest.json' > "${tmp_dir}/direct.out"
cat > "${tmp_dir}/direct.expected" <<'EOF'
https://github.com/qoli/localClash/releases/latest/download/localclash-release-manifest.json
EOF
assert_file_equals "${tmp_dir}/direct.out" "${tmp_dir}/direct.expected"

GITHUB_MIRROR=none
github_download_candidates 'https://raw.githubusercontent.com/vernesong/OpenClash/core/master/core_version' > "${tmp_dir}/none.out"
cat > "${tmp_dir}/none.expected" <<'EOF'
https://raw.githubusercontent.com/vernesong/OpenClash/core/master/core_version
EOF
assert_file_equals "${tmp_dir}/none.out" "${tmp_dir}/none.expected"

printf 'rpcd download candidate tests passed\n'
