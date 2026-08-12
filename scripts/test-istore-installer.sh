#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
	printf 'usage: scripts/test-istore-installer.sh <release-tag>\n' >&2
	exit 2
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
release_tag="$1"
test_root="${repo_root}/.build/istore-installer-test"
x86_run="${repo_root}/dist/localclash-istore-${release_tag}-x86_64.run"
arm_run="${repo_root}/dist/localclash-istore-${release_tag}-aarch64.run"
package_makefile="${repo_root}/openwrt/luci-app-localclash/Makefile"
pkg_name="$(awk -F':=' '/^PKG_NAME:=/ { print $2; exit }' "$package_makefile")"
pkg_version="$(awk -F':=' '/^PKG_VERSION:=/ { print $2; exit }' "$package_makefile")"
pkg_release="$(awk -F':=' '/^PKG_RELEASE:=/ { print $2; exit }' "$package_makefile")"
expected_opkg_args="install packages/${pkg_name}_${pkg_version}-${pkg_release}_all.ipk"

for run_file in "$x86_run" "$arm_run"; do
	[ -s "$run_file" ] || {
		printf 'missing iStore test bundle: %s\n' "$run_file" >&2
		exit 1
	}
done

rm -rf "$test_root"
mkdir -p "$test_root/x86_64" "$test_root/aarch64"
sh "$x86_run" --target "$test_root/x86_64" --noexec --noprogress >/dev/null
sh "$arm_run" --target "$test_root/aarch64" --noexec --noprogress >/dev/null

docker run --rm --network none \
	--platform linux/amd64 \
	-e EXPECTED_OPKG_ARGS="$expected_opkg_args" \
	-v "$test_root/x86_64:/bundle:ro" \
	-v "${repo_root}/packaging/istore/test:/test-bin:ro" \
	ubuntu:24.04 \
	sh -eu -c '
		mkdir -p /root/localclash/policy-templates
		printf "user-owned\n" > /root/localclash/policy-templates/custom.json
		PATH=/test-bin:$PATH sh /bundle/install.sh
		test -x /usr/local/bin/localclash
		test -x /usr/local/bin/dnsqualify
		test -f /root/localclash/policy-templates/localclash-default.json
		test "$(cat /root/localclash/policy-templates/custom.json)" = "user-owned"
		test -f /root/localclash/.runtime/mihomo/geosite.dat
		test "$(cat /tmp/mock-opkg.args)" = "$EXPECTED_OPKG_ARGS"
	'

if docker run --rm --network none \
	--platform linux/amd64 \
	-v "$test_root/aarch64:/bundle:ro" \
	-v "${repo_root}/packaging/istore/test:/test-bin:ro" \
	ubuntu:24.04 \
	sh -eu -c 'PATH=/test-bin:$PATH sh /bundle/install.sh' \
	>"$test_root/arch-mismatch.stdout" 2>"$test_root/arch-mismatch.stderr"; then
	printf 'aarch64 bundle unexpectedly installed on x86_64\n' >&2
	exit 1
fi
grep -F '架构不匹配' "$test_root/arch-mismatch.stderr" >/dev/null || {
	printf 'architecture mismatch did not report the expected explicit error\n' >&2
	exit 1
}

cp -R "$test_root/x86_64" "$test_root/tampered"
sed -i.bak 's/^CORE_VERSION=.*/CORE_VERSION=v0.0.0-tampered/' "$test_root/tampered/bundle.env"
if docker run --rm --network none \
	--platform linux/amd64 \
	-v "$test_root/tampered:/bundle:ro" \
	-v "${repo_root}/packaging/istore/test:/test-bin:ro" \
	ubuntu:24.04 \
	sh -eu -c 'PATH=/test-bin:$PATH sh /bundle/install.sh' \
	>"$test_root/tampered.stdout" 2>"$test_root/tampered.stderr"; then
	printf 'tampered bundle unexpectedly installed\n' >&2
	exit 1
fi
grep -F 'bundle SHA-256 校验失败' "$test_root/tampered.stderr" >/dev/null || {
	printf 'tampered bundle did not report the expected checksum error\n' >&2
	exit 1
}

printf 'Verified offline x86_64 install and fail-closed architecture/checksum errors\n'
