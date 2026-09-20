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
chmod 755 "${build_dir}/pkg/usr/libexec/localclash/takeover" "${build_dir}/pkg/usr/libexec/localclash/takeover-apply" "${build_dir}/pkg/usr/libexec/localclash/takeover-stop" "${build_dir}/pkg/usr/libexec/localclash/dns-guard" "${build_dir}/pkg/usr/libexec/localclash/dns-probe" "${build_dir}/pkg/usr/libexec/localclash/subscription-scheduler" "${build_dir}/pkg/etc/init.d/localclash-subscription-scheduler"

cat > "${build_dir}/scripts/post-install" <<'EOF'
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
		--info 'depends:luci-base luci-lib-nixio rpcd uclient-fetch curl ca-bundle jsonfilter firewall4 nftables ip-full kmod-tun kmod-nft-tproxy' \
			--files '/work/.build/apk/pkg' \
			--script 'post-install:/work/.build/apk/scripts/post-install' \
			--script 'post-upgrade:/work/.build/apk/scripts/post-upgrade' \
			--xattrs=no \
			--output '/work/dist/${apk_name}'
		apk --allow-untrusted verify '/work/dist/${apk_name}'
	"

printf 'Built package: %s\n' "${dist_dir}/${apk_name}"
