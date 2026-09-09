#!/bin/sh
set -eu

repo_root="$(CDPATH= cd "$(dirname "$0")/.." && pwd)"
test_root="$(mktemp -d)"
cleanup() {
	rm -rf "$test_root"
}
trap cleanup EXIT HUP INT TERM

payload="$test_root/payload"
mock_bin="$test_root/mock-bin"
mkdir -p "$payload/packages" "$mock_bin" "$test_root/control" "$test_root/ipk"
cp "$repo_root/packaging/istore/install.sh" "$payload/install.sh"

cat > "$test_root/control/control" <<'EOF'
Package: luci-app-localclash
Version: 0.1.0-test
Architecture: arm64
Description: deliberately incompatible regression fixture
EOF
tar -czf "$test_root/ipk/control.tar.gz" -C "$test_root/control" ./control
printf '2.0\n' > "$test_root/ipk/debian-binary"
tar -czf "$test_root/ipk/data.tar.gz" --files-from /dev/null
tar -czf "$payload/packages/luci-app-localclash_test_arm64.ipk" -C "$test_root/ipk" ./debian-binary ./data.tar.gz ./control.tar.gz

cat > "$payload/bundle.env" <<'EOF'
BUNDLE_SCHEMA_VERSION=1
BUNDLE_ARCH=aarch64
LUCI_IPK=luci-app-localclash_test_arm64.ipk
LUCI_VERSION=test
CORE_VERSION=test
EOF
(
	cd "$payload"
	sha256sum bundle.env packages/luci-app-localclash_test_arm64.ipk > checksums.sha256
)

cat > "$mock_bin/id" <<'EOF'
#!/bin/sh
[ "${1:-}" = -u ] && { printf '0\n'; exit 0; }
exit 1
EOF
cat > "$mock_bin/uname" <<'EOF'
#!/bin/sh
printf 'aarch64\n'
EOF
cat > "$mock_bin/opkg" <<EOF
#!/bin/sh
printf 'called\n' > '$test_root/opkg-called'
exit 0
EOF
chmod 755 "$mock_bin/id" "$mock_bin/uname" "$mock_bin/opkg"

if output="$(PATH="$mock_bin:$PATH" sh "$payload/install.sh" 2>&1)"; then
	printf 'FAIL incompatible IPK unexpectedly passed preflight\n' >&2
	exit 1
fi
printf '%s\n' "$output" | grep -q 'LuCI IPK 架构不兼容：仅接受 Architecture: all；已在调用 opkg 前拒绝。' || {
	printf 'FAIL incompatible IPK error was not explicit:\n%s\n' "$output" >&2
	exit 1
}
[ ! -e "$test_root/opkg-called" ] || {
	printf 'FAIL opkg was called for an incompatible IPK\n' >&2
	exit 1
}

printf 'iStore LuCI IPK preflight regression test passed\n'
