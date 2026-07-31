# GitHub Release Runbook

This runbook publishes a new `localclash-luci` GitHub Release with both OpenWrt
package formats and the LuCI-owned `dnsqualify` helper:

- OpenWrt 24.10 and older: `.ipk` / `opkg`
- OpenWrt 25.12 and newer: `.apk` / `apk`
- Linux amd64 and arm64: standalone `dnsqualify` binaries selected by LuCI

The LuCI package and the `localClash` Go core are separate release channels. Do
not publish a new LuCI release only because the core has a new version. The LuCI
helper downloads the latest core from the core release manifest at runtime.

## Preconditions

- `main` is the intended release branch.
- The working tree is clean except for the release bump you are about to make.
- `gh auth status` is healthy for `github.com/qoli/localclash-luci`.
- Docker is available for the package build scripts.
- The change being released touches the LuCI UI, rpcd helper, ACL, menu,
  package metadata, package scripts, or docs that should ship with a LuCI
  package release.

```sh
git status --short
git branch --show-current
gh auth status
gh release list --limit 5
```

## 1. Choose the Next Package Release

The release tag follows the OpenWrt package version:

```text
PKG_VERSION:=0.1.0
PKG_RELEASE:=14
tag: v0.1.0-14
ipk: luci-app-localclash_0.1.0-14_all.ipk
apk: luci-app-localclash-0.1.0-r14.apk
```

Check the latest published release and bump `PKG_RELEASE` in
`openwrt/luci-app-localclash/Makefile`.

```sh
gh release list --limit 5
$EDITOR openwrt/luci-app-localclash/Makefile
```

Update README release references when they name the current latest LuCI package.

```sh
$EDITOR README.md
```

Do not reuse an existing tag or overwrite an older public package release. Bump
the package release and publish a new GitHub Release instead.

## 2. Verify Source Before Packaging

Run the lightweight checks before building artifacts:

```sh
for f in openwrt/luci-app-localclash/htdocs/luci-static/resources/view/localclash/*.js; do
  node --check "$f"
done

sh -n openwrt/luci-app-localclash/root/usr/libexec/rpcd/localclash
git diff --check
```

If any check fails, fix it before continuing.

## 3. Build Both Package Formats

Read package metadata from the Makefile and define artifact paths:

```sh
pkg_name="$(awk -F':=' '/^PKG_NAME:=/ { print $2; exit }' openwrt/luci-app-localclash/Makefile)"
pkg_version="$(awk -F':=' '/^PKG_VERSION:=/ { print $2; exit }' openwrt/luci-app-localclash/Makefile)"
pkg_release="$(awk -F':=' '/^PKG_RELEASE:=/ { print $2; exit }' openwrt/luci-app-localclash/Makefile)"
tag="v${pkg_version}-${pkg_release}"
ipk="dist/${pkg_name}_${pkg_version}-${pkg_release}_all.ipk"
apk="dist/${pkg_name}-${pkg_version}-r${pkg_release}.apk"
```

Build the OpenWrt 24 `.ipk`, OpenWrt 25 `.apk`, and both dnsqualify assets:

```sh
./scripts/build-openwrt-ipk.sh
./scripts/build-openwrt-apk.sh
./scripts/build-dnsqualify-assets.sh "$tag"
```

Confirm the expected files exist:

```sh
test -s "$ipk"
test -s "$apk"
test -s dist/dnsqualify-linux-amd64
test -s dist/dnsqualify-linux-arm64
test -s dist/dnsqualify-release-manifest.json
ls -lh "$ipk" "$apk" dist/dnsqualify-linux-* dist/dnsqualify-release-manifest.json
```

## 4. Generate Checksums

Generate checksum sidecar files next to the artifacts:

```sh
shasum -a 256 "$ipk" > "${ipk}.sha256"
shasum -a 256 "$apk" > "${apk}.sha256"
shasum -a 256 -c "${ipk}.sha256"
shasum -a 256 -c "${apk}.sha256"
shasum -a 256 -c dist/dnsqualify-linux-amd64.sha256
shasum -a 256 -c dist/dnsqualify-linux-arm64.sha256
```

`dist/` is ignored by git. The artifacts are uploaded to GitHub Release, not
committed.

## 5. Commit and Push the Release Bump

Commit only the source/docs version bump and any intended release changes:

```sh
git status --short
git add README.md openwrt/luci-app-localclash/Makefile
git commit -m "Bump LuCI package release to ${pkg_version}-${pkg_release}"
git push origin main
commit="$(git rev-parse HEAD)"
```

If the release includes a functional change commit immediately before the bump,
make sure both commits are pushed before creating the release.

## 6. Write Release Notes

Use a notes file instead of passing escaped newlines to `gh release create`.
Escaped `\n` text can end up published literally.

```sh
notes_file="$(mktemp /tmp/localclash-luci-release-notes.XXXXXX.md)"
cat > "$notes_file" <<EOF
LuCI package release ${tag}.

Changes:
- <short user-facing change 1>
- <short user-facing change 2>

Artifacts:
- OpenWrt 24.10 and older: $(basename "$ipk")
- OpenWrt 25.12 and newer: $(basename "$apk")
- LuCI-managed DNS qualification: dnsqualify-linux-amd64 / dnsqualify-linux-arm64
EOF
```

Keep notes focused on LuCI package changes. Do not list core-only changes unless
the LuCI package was changed to support them.

## 7. Create the GitHub Release

Confirm the tag does not already exist:

```sh
if gh release view "$tag" >/dev/null 2>&1; then
  echo "release already exists: $tag" >&2
  exit 1
fi
```

Create the release and upload all four assets:

```sh
gh release create "$tag" \
  "$ipk" \
  "${ipk}.sha256" \
  "$apk" \
  "${apk}.sha256" \
  dist/dnsqualify-linux-amd64 \
  dist/dnsqualify-linux-amd64.sha256 \
  dist/dnsqualify-linux-arm64 \
  dist/dnsqualify-linux-arm64.sha256 \
  dist/dnsqualify-release-manifest.json \
  --title "localclash-luci ${tag}" \
  --notes-file "$notes_file" \
  --target "$commit" \
  --latest
```

## 8. Verify the Published Release

Verify the release is published, latest, has all assets, and the tag points to
the intended commit:

```sh
gh release view "$tag"
gh release list --limit 3
git ls-remote --tags origin "$tag"
git status --short
```

Expected assets:

```text
luci-app-localclash_<version>-<release>_all.ipk
luci-app-localclash_<version>-<release>_all.ipk.sha256
luci-app-localclash-<version>-r<release>.apk
luci-app-localclash-<version>-r<release>.apk.sha256
dnsqualify-linux-amd64
dnsqualify-linux-amd64.sha256
dnsqualify-linux-arm64
dnsqualify-linux-arm64.sha256
dnsqualify-release-manifest.json
```

The release should be:

- `draft: false`
- `prerelease: false`
- marked `Latest` in `gh release list`
- tagged at the pushed release bump commit

## 9. Fixups

If notes formatting is wrong, edit notes in place:

```sh
gh release edit "$tag" --notes-file "$notes_file"
```

If an asset upload was interrupted but the tag and release are correct, upload
the missing asset:

```sh
gh release upload "$tag" "$missing_asset"
```

If an asset is wrong, prefer publishing a new package release. Only use
`--clobber` before anyone could reasonably consume the release:

```sh
gh release upload "$tag" "$fixed_asset" --clobber
```

If the tag points to the wrong commit or the release was created for the wrong
package version, stop and publish a new package release. Do not silently retarget
an already-public release.
