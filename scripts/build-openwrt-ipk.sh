#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
package_dir="${repo_root}/openwrt/luci-app-localclash"
build_dir="${repo_root}/.build/ipk"
dist_dir="${repo_root}/dist"
image="${OPENWRT_IPK_BUILD_IMAGE:-ubuntu:24.04}"

pkg_name="$(awk -F':=' '/^PKG_NAME:=/ { print $2; exit }' "${package_dir}/Makefile")"
pkg_version="$(awk -F':=' '/^PKG_VERSION:=/ { print $2; exit }' "${package_dir}/Makefile")"
pkg_release="$(awk -F':=' '/^PKG_RELEASE:=/ { print $2; exit }' "${package_dir}/Makefile")"
ipk_name="${pkg_name}_${pkg_version}-${pkg_release}_all.ipk"

rm -rf "${build_dir}"
mkdir -p "${build_dir}/control" "${build_dir}/data" "${dist_dir}"

cp -a "${package_dir}/root/." "${build_dir}/data/"
mkdir -p "${build_dir}/data/www"
cp -a "${package_dir}/htdocs/." "${build_dir}/data/www/"
chmod 755 "${build_dir}/data/usr/libexec/rpcd/localclash"

cat > "${build_dir}/control/control" <<EOF
Package: ${pkg_name}
Version: ${pkg_version}-${pkg_release}
Depends: luci-base, rpcd, uclient-fetch, ca-bundle, jsonfilter
Architecture: all
Maintainer: qoli
Section: luci
Priority: optional
Description: LuCI support for localClash.
EOF

docker run --rm \
	--platform linux/amd64 \
	-v "${repo_root}:/work" \
	-w /work/.build/ipk \
	"${image}" \
	bash -lc "
		set -euo pipefail
		export DEBIAN_FRONTEND=noninteractive
		apt-get update >/dev/null
		apt-get install -y --no-install-recommends binutils gzip tar >/dev/null
		printf '2.0\n' > debian-binary
		tar --sort=name --numeric-owner --owner=0 --group=0 -czf control.tar.gz -C control .
		tar --sort=name --numeric-owner --owner=0 --group=0 -czf data.tar.gz -C data .
		ar rcs '/work/dist/${ipk_name}' debian-binary control.tar.gz data.tar.gz
	"

printf 'Built package: %s\n' "${dist_dir}/${ipk_name}"
