#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
package_dir="${repo_root}/openwrt/luci-app-localclash"
build_dir="${repo_root}/.build/apk"
dist_dir="${repo_root}/dist"
image="${OPENWRT_APK_BUILD_IMAGE:-alpine:edge}"

pkg_name="$(awk -F':=' '/^PKG_NAME:=/ { print $2; exit }' "${package_dir}/Makefile")"
pkg_version="$(awk -F':=' '/^PKG_VERSION:=/ { print $2; exit }' "${package_dir}/Makefile")"
pkg_release="$(awk -F':=' '/^PKG_RELEASE:=/ { print $2; exit }' "${package_dir}/Makefile")"
pkg_license="$(awk -F':=' '/^PKG_LICENSE:=/ { print $2; exit }' "${package_dir}/Makefile")"
apk_version="${pkg_version}-r${pkg_release}"
apk_name="${pkg_name}-${apk_version}.apk"

rm -rf "${build_dir}"
mkdir -p "${build_dir}/pkg" "${build_dir}/scripts" "${dist_dir}"

cp -a "${package_dir}/root/." "${build_dir}/pkg/"
mkdir -p "${build_dir}/pkg/www"
cp -a "${package_dir}/htdocs/." "${build_dir}/pkg/www/"
chmod 755 "${build_dir}/pkg/usr/libexec/rpcd/localclash"

cat > "${build_dir}/scripts/post-install" <<'EOF'
#!/bin/sh
rm -f /tmp/luci-indexcache.*.json 2>/dev/null || true
rm -rf /tmp/luci-modulecache /tmp/luci-templatecache 2>/dev/null || true
if [ -x /etc/init.d/rpcd ]; then
	/etc/init.d/rpcd restart >/dev/null 2>&1 || true
fi
if [ -x /usr/local/bin/localclash ] && [ -x /usr/libexec/rpcd/localclash ]; then
	/usr/libexec/rpcd/localclash call service_start >/dev/null 2>&1 || true
fi
exit 0
EOF
chmod 755 "${build_dir}/scripts/post-install"
cp "${build_dir}/scripts/post-install" "${build_dir}/scripts/post-upgrade"

docker run --rm \
	-v "${repo_root}:/work" \
	-w /work \
	"${image}" \
	sh -lc "
		set -euo pipefail
		apk mkpkg \
			--info 'name:${pkg_name}' \
			--info 'version:${apk_version}' \
			--info 'description:LuCI support for localClash.' \
			--info 'arch:noarch' \
			--info 'license:${pkg_license}' \
			--info 'origin:localclash-luci' \
			--info 'url:https://github.com/qoli/localclash-luci' \
			--info 'maintainer:qoli' \
			--info 'depends:luci-base rpcd uclient-fetch ca-bundle jsonfilter' \
			--files '/work/.build/apk/pkg' \
			--script 'post-install:/work/.build/apk/scripts/post-install' \
			--script 'post-upgrade:/work/.build/apk/scripts/post-upgrade' \
			--xattrs=no \
			--output '/work/dist/${apk_name}'
		apk --allow-untrusted verify '/work/dist/${apk_name}'
	"

printf 'Built package: %s\n' "${dist_dir}/${apk_name}"
