#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
package_dir="${repo_root}/openwrt/luci-app-localclash"
dist_dir="${repo_root}/dist"
target="${OPENWRT_TARGET:-root@192.168.6.1}"
remote_dir="${OPENWRT_REMOTE_DIR:-/tmp}"
build_image="${OPENWRT_APK_BUILD_IMAGE:-alpine:edge}"
apk_update="${OPENWRT_APK_UPDATE:-0}"

pkg_name="$(awk -F':=' '/^PKG_NAME:=/ { print $2; exit }' "${package_dir}/Makefile")"
pkg_version="$(awk -F':=' '/^PKG_VERSION:=/ { print $2; exit }' "${package_dir}/Makefile")"
pkg_release="$(awk -F':=' '/^PKG_RELEASE:=/ { print $2; exit }' "${package_dir}/Makefile")"
apk_version="${pkg_version}-r${pkg_release}"
apk_name="${pkg_name}-${apk_version}.apk"
apk_path="${APK_PATH:-${dist_dir}/${apk_name}}"
remote_apk="${remote_dir}/${apk_name}"

if [ "${OPENWRT_SKIP_BUILD:-0}" != "1" ]; then
	"${repo_root}/scripts/build-openwrt-apk.sh"
fi

if [ ! -f "${apk_path}" ]; then
	printf 'Missing apk: %s\n' "${apk_path}" >&2
	exit 1
fi

apk_sha="$(shasum -a 256 "${apk_path}" | awk '{ print $1 }')"
apk_rel="${apk_path#${repo_root}/}"

printf 'Verifying local apk: %s\n' "${apk_path}"
docker run --rm \
	-v "${repo_root}:/work" \
	-w /work \
	"${build_image}" \
	sh -lc "
		set -euo pipefail
		apk --allow-untrusted verify '/work/${apk_rel}'
		apk adbdump '/work/${apk_rel}' | grep -q 'name: ${pkg_name}'
		apk adbdump '/work/${apk_rel}' | grep -q 'version: ${apk_version}'
		apk adbdump '/work/${apk_rel}' | grep -q 'arch: noarch'
		apk --cache=no --allow-untrusted manifest '/work/${apk_rel}' | grep -q '  usr/libexec/rpcd/localclash$'
		apk --cache=no --allow-untrusted manifest '/work/${apk_rel}' | grep -q '  usr/share/luci/menu.d/luci-app-localclash.json$'
		apk --cache=no --allow-untrusted manifest '/work/${apk_rel}' | grep -q '  usr/share/rpcd/acl.d/luci-app-localclash.json$'
		apk --cache=no --allow-untrusted manifest '/work/${apk_rel}' | grep -q '  usr/share/localclash/mcp-help.txt$'
		apk --cache=no --allow-untrusted manifest '/work/${apk_rel}' | grep -q '  www/luci-static/resources/view/localclash/index.js$'
		apk --cache=no --allow-untrusted manifest '/work/${apk_rel}' | grep -q '  www/luci-static/resources/view/localclash/overview.js$'
		apk --cache=no --allow-untrusted manifest '/work/${apk_rel}' | grep -q '  www/luci-static/resources/view/localclash/subscription.js$'
	"

printf 'Uploading %s to %s:%s\n' "${apk_name}" "${target}" "${remote_apk}"
ssh "${target}" "mkdir -p '${remote_dir}'"
scp "${apk_path}" "${target}:${remote_apk}"

printf 'Installing and verifying on %s\n' "${target}"
ssh "${target}" \
	"REMOTE_APK='${remote_apk}' EXPECTED_SHA='${apk_sha}' PKG_NAME='${pkg_name}' PKG_VERSION='${apk_version}' APK_UPDATE='${apk_update}' sh -s" <<'REMOTE'
set -eu

remote_sha="$(sha256sum "${REMOTE_APK}" | awk '{ print $1 }')"
if [ "${remote_sha}" != "${EXPECTED_SHA}" ]; then
	echo "Uploaded apk checksum mismatch: ${remote_sha} != ${EXPECTED_SHA}" >&2
	exit 1
fi

if [ "${APK_UPDATE}" = "1" ]; then
	apk update
fi

apk --allow-untrusted --force-overwrite add --upgrade "${REMOTE_APK}"

apk info -e "${PKG_NAME}" >/dev/null
apk list -I "${PKG_NAME}" | grep -q "^${PKG_NAME}-${PKG_VERSION} "

test -x /usr/libexec/rpcd/localclash
test -f /usr/share/luci/menu.d/luci-app-localclash.json
test -f /usr/share/rpcd/acl.d/luci-app-localclash.json
test -f /usr/share/localclash/mcp-help.txt
test -f /www/luci-static/resources/view/localclash/index.js
test -f /www/luci-static/resources/view/localclash/overview.js
test -f /www/luci-static/resources/view/localclash/subscription.js

jsonfilter -i /usr/share/luci/menu.d/luci-app-localclash.json -e '@["admin/services/localclash"].title' >/dev/null
jsonfilter -i /usr/share/luci/menu.d/luci-app-localclash.json -e '@["admin/services/localclash/overview"].title' >/dev/null
jsonfilter -i /usr/share/luci/menu.d/luci-app-localclash.json -e '@["admin/services/localclash/subscription"].title' >/dev/null
jsonfilter -i /usr/share/luci/menu.d/luci-app-localclash.json -e '@["admin/services/localclash/advanced"].title' >/dev/null
jsonfilter -i /usr/share/rpcd/acl.d/luci-app-localclash.json -e '@["luci-app-localclash"].description' >/dev/null

if [ -x /etc/init.d/rpcd ]; then
	/etc/init.d/rpcd restart >/dev/null 2>&1 || true
	sleep 1
fi

if command -v ubus >/dev/null 2>&1; then
	ubus -S list localclash >/dev/null
	ubus -S call localclash status >/tmp/localclash-deploy-status.json
	ubus -S call localclash mcp_help >/tmp/localclash-deploy-mcp-help.json
	grep -q '"ok":true' /tmp/localclash-deploy-status.json
	grep -q '"ok":true' /tmp/localclash-deploy-mcp-help.json
fi

echo "Installed ${PKG_NAME} ${PKG_VERSION}"
echo "Verified files, apk metadata, jsonfilter parsing, and rpcd ubus status"
REMOTE

printf 'Deployment verified: %s on %s\n' "${apk_name}" "${target}"
