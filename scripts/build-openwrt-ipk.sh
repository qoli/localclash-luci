#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
package_dir="${repo_root}/openwrt/luci-app-localclash"
build_dir="${repo_root}/.build/ipk"
dist_dir="${repo_root}/dist"
image="${OPENWRT_IPK_BUILD_IMAGE:-ubuntu:24.04}"
source_date_epoch="${SOURCE_DATE_EPOCH:-0}"

pkg_name="$(awk -F':=' '/^PKG_NAME:=/ { print $2; exit }' "${package_dir}/Makefile")"
pkg_version="$(awk -F':=' '/^PKG_VERSION:=/ { print $2; exit }' "${package_dir}/Makefile")"
pkg_release="$(awk -F':=' '/^PKG_RELEASE:=/ { print $2; exit }' "${package_dir}/Makefile")"
pkg_license="$(awk -F':=' '/^PKG_LICENSE:=/ { print $2; exit }' "${package_dir}/Makefile")"
ipk_name="${pkg_name}_${pkg_version}-${pkg_release}_all.ipk"

rm -rf "${build_dir}"
mkdir -p "${build_dir}/pkg/CONTROL" "${dist_dir}"

cp -a "${package_dir}/root/." "${build_dir}/pkg/"
mkdir -p "${build_dir}/pkg/www"
cp -a "${package_dir}/htdocs/." "${build_dir}/pkg/www/"
chmod 755 "${build_dir}/pkg/usr/libexec/rpcd/localclash"
chmod 755 "${build_dir}/pkg/usr/libexec/localclash/takeover" "${build_dir}/pkg/usr/libexec/localclash/takeover-apply" "${build_dir}/pkg/usr/libexec/localclash/takeover-stop" "${build_dir}/pkg/usr/libexec/localclash/dns-guard" "${build_dir}/pkg/usr/libexec/localclash/dns-probe" "${build_dir}/pkg/usr/libexec/localclash/subscription-scheduler" "${build_dir}/pkg/etc/init.d/localclash-subscription-scheduler"

cat > "${build_dir}/pkg/CONTROL/control" <<EOF
Package: ${pkg_name}
Version: ${pkg_version}-${pkg_release}
Depends: luci-base, luci-lib-nixio, rpcd, uclient-fetch, curl, ca-bundle, jsonfilter, firewall4, nftables, ip-full, kmod-tun, kmod-nft-tproxy
Architecture: all
Maintainer: qoli
Section: luci
Priority: optional
License: ${pkg_license}
Description: LuCI support for localClash.
EOF

printf '/etc/config/localclash\n' > "${build_dir}/pkg/CONTROL/conffiles"

cat > "${build_dir}/pkg/CONTROL/postinst" <<'EOF'
#!/bin/sh
[ -z "${IPKG_INSTROOT:-}" ] || exit 0
rm -f /tmp/luci-indexcache.*.json 2>/dev/null || true
rm -rf /tmp/luci-modulecache /tmp/luci-templatecache 2>/dev/null || true
reload_state_dir=/tmp/localclash-update
reload_required="$reload_state_dir/rpcd-reload-required"
scheduler_restart_required="$reload_state_dir/subscription-scheduler-restart-required"
task_status=/tmp/localclash-task-status.json
task_running=false
if [ -f "$task_status" ]; then
	command -v jsonfilter >/dev/null 2>&1 || exit 1
	task_running="$(jsonfilter -i "$task_status" -e '@.running' 2>/dev/null)" || exit 1
	case "$task_running" in
		true|false) ;;
		*) exit 1 ;;
	esac
fi
if [ "$task_running" = true ]; then
	if [ -L "$reload_state_dir" ] || { [ -e "$reload_state_dir" ] && [ ! -d "$reload_state_dir" ]; }; then
		exit 1
	fi
	mkdir -p "$reload_state_dir" || exit 1
	chmod 700 "$reload_state_dir" || exit 1
	[ ! -L "$reload_required" ] || exit 1
	[ ! -L "$scheduler_restart_required" ] || exit 1
	printf 'required\n' > "$reload_required" || exit 1
	printf 'required\n' > "$scheduler_restart_required" || exit 1
else
	[ -x /etc/init.d/rpcd ] || exit 1
	/etc/init.d/rpcd reload >/dev/null 2>&1 || exit 1
	[ -x /etc/init.d/localclash-subscription-scheduler ] || exit 1
	command -v uci >/dev/null 2>&1 || exit 1
	scheduler_enabled="$(uci -q get localclash.subscription_schedule.enabled 2>/dev/null)" || exit 1
	case "$scheduler_enabled" in
		1)
			/etc/init.d/localclash-subscription-scheduler enable >/dev/null 2>&1 || exit 1
			/etc/init.d/localclash-subscription-scheduler restart >/dev/null 2>&1 || exit 1
			;;
		0)
			/etc/init.d/localclash-subscription-scheduler stop >/dev/null 2>&1 || exit 1
			/etc/init.d/localclash-subscription-scheduler disable >/dev/null 2>&1 || exit 1
			;;
		*) exit 1 ;;
	esac
	rm -f "$reload_required" "$scheduler_restart_required" || exit 1
fi
exit 0
EOF
chmod 755 "${build_dir}/pkg/CONTROL/postinst"

docker run --rm \
	--platform linux/amd64 \
	-v "${repo_root}:/work" \
	-w /work \
	"${image}" \
	bash -lc "
		set -euo pipefail
		export DEBIAN_FRONTEND=noninteractive
		if ! command -v gzip >/dev/null 2>&1 || ! command -v tar >/dev/null 2>&1; then
			apt-get update >/dev/null
			apt-get install -y --no-install-recommends gzip tar >/dev/null
		fi
		tmp_dir=/tmp/localclash-ipk
		rm -rf \"\$tmp_dir\"
		mkdir -p \"\$tmp_dir\"
		printf 'CONTROL\n./CONTROL\n' > \"\$tmp_dir/tar-excludes\"
		tar -X \"\$tmp_dir/tar-excludes\" --format=gnu --numeric-owner --owner=0 --group=0 --sort=name --mtime='@${source_date_epoch}' -cpf - -C /work/.build/ipk/pkg . | gzip -n > \"\$tmp_dir/data.tar.gz\"
		installed_size=\"\$(gzip -dc \"\$tmp_dir/data.tar.gz\" | wc -c)\"
		printf 'Installed-Size: %s\n' \"\$installed_size\" >> /work/.build/ipk/pkg/CONTROL/control
		tar --format=gnu --numeric-owner --owner=0 --group=0 --sort=name --mtime='@${source_date_epoch}' -cpf - -C /work/.build/ipk/pkg/CONTROL . | gzip -n > \"\$tmp_dir/control.tar.gz\"
		printf '2.0\n' > \"\$tmp_dir/debian-binary\"
		rm -f '/work/dist/${ipk_name}'
		tar --format=gnu --numeric-owner --owner=0 --group=0 --sort=name --mtime='@${source_date_epoch}' -cpf - -C \"\$tmp_dir\" ./debian-binary ./data.tar.gz ./control.tar.gz | gzip -n > '/work/dist/${ipk_name}'
	"

printf 'Built package: %s\n' "${dist_dir}/${ipk_name}"
