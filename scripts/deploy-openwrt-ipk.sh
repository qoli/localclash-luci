#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
package_dir="${repo_root}/openwrt/luci-app-localclash"
dist_dir="${repo_root}/dist"
target="${OPENWRT_TARGET:-root@192.168.6.1}"
remote_dir="${OPENWRT_REMOTE_DIR:-/tmp}"
build_image="${OPENWRT_IPK_BUILD_IMAGE:-ubuntu:24.04}"
opkg_update="${OPENWRT_OPKG_UPDATE:-0}"

pkg_name="$(awk -F':=' '/^PKG_NAME:=/ { print $2; exit }' "${package_dir}/Makefile")"
pkg_version="$(awk -F':=' '/^PKG_VERSION:=/ { print $2; exit }' "${package_dir}/Makefile")"
pkg_release="$(awk -F':=' '/^PKG_RELEASE:=/ { print $2; exit }' "${package_dir}/Makefile")"
ipk_name="${pkg_name}_${pkg_version}-${pkg_release}_all.ipk"
ipk_path="${IPK_PATH:-${dist_dir}/${ipk_name}}"
remote_ipk="${remote_dir}/${ipk_name}"

if [ "${OPENWRT_SKIP_BUILD:-0}" != "1" ]; then
	"${repo_root}/scripts/build-openwrt-ipk.sh"
fi

if [ ! -f "${ipk_path}" ]; then
	printf 'Missing ipk: %s\n' "${ipk_path}" >&2
	exit 1
fi

ipk_sha="$(shasum -a 256 "${ipk_path}" | awk '{ print $1 }')"
ipk_rel="${ipk_path#${repo_root}/}"

printf 'Verifying local ipk: %s\n' "${ipk_path}"
docker run --rm \
	--platform linux/amd64 \
	-v "${repo_root}:/work" \
	-w /tmp \
	"${build_image}" \
	bash -lc "
		set -euo pipefail
		export DEBIAN_FRONTEND=noninteractive
		apt-get update >/dev/null
		apt-get install -y --no-install-recommends gzip tar grep >/dev/null
		mkdir inspect
		cd inspect
		tar -xzf '/work/${ipk_rel}'
		test \"\$(cat debian-binary)\" = '2.0'
		tar -xzf control.tar.gz
		grep -qx 'Package: ${pkg_name}' control
		grep -qx 'Version: ${pkg_version}-${pkg_release}' control
		grep -qx 'Architecture: all' control
		tar -tzf data.tar.gz | grep -qx './usr/libexec/rpcd/localclash'
		tar -tzf data.tar.gz | grep -qx './usr/share/luci/menu.d/luci-app-localclash.json'
		tar -tzf data.tar.gz | grep -qx './usr/share/rpcd/acl.d/luci-app-localclash.json'
		tar -tzf data.tar.gz | grep -qx './usr/share/localclash/mcp-help.txt'
		tar -tzf data.tar.gz | grep -qx './www/luci-static/resources/view/localclash/index.js'
		tar -tzf data.tar.gz | grep -qx './www/luci-static/resources/view/localclash/overview.js'
		tar -tzf data.tar.gz | grep -qx './www/luci-static/resources/view/localclash/subscription.js'
	"

printf 'Uploading %s to %s:%s\n' "${ipk_name}" "${target}" "${remote_ipk}"
ssh "${target}" "mkdir -p '${remote_dir}'"
scp "${ipk_path}" "${target}:${remote_ipk}"

printf 'Installing and verifying on %s\n' "${target}"
ssh "${target}" \
	"REMOTE_IPK='${remote_ipk}' EXPECTED_SHA='${ipk_sha}' PKG_NAME='${pkg_name}' PKG_VERSION='${pkg_version}-${pkg_release}' OPKG_UPDATE='${opkg_update}' sh -s" <<'REMOTE'
set -eu

remote_sha="$(sha256sum "${REMOTE_IPK}" | awk '{ print $1 }')"
if [ "${remote_sha}" != "${EXPECTED_SHA}" ]; then
	echo "Uploaded ipk checksum mismatch: ${remote_sha} != ${EXPECTED_SHA}" >&2
	exit 1
fi

if [ "${OPKG_UPDATE}" = "1" ]; then
	opkg update
fi

opkg install --force-reinstall "${REMOTE_IPK}"

opkg status "${PKG_NAME}" | grep -q "^Package: ${PKG_NAME}$"
opkg status "${PKG_NAME}" | grep -q "^Version: ${PKG_VERSION}$"
opkg status "${PKG_NAME}" | grep -q "^Architecture: all$"

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
echo "Verified files, opkg metadata, jsonfilter parsing, and rpcd ubus status"
REMOTE

printf 'Deployment verified: %s on %s\n' "${ipk_name}" "${target}"
