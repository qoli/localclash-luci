# localclash-luci

OpenWrt LuCI package for localClash.

This repository owns the OpenWrt integration layer:

- LuCI frontend views.
- rpcd ACL and helper methods.
- OpenWrt package/feed metadata.
- Router-side bootstrap and service integration needed before and after the
  localClash core is installed.

It does not ship the localClash Go core, Mihomo core, dashboard assets,
subscriptions, generated configuration, or runtime state. Those are installed
or managed through explicit user actions and the localClash core release
manifest.

See [docs/openwrt-luci.md](docs/openwrt-luci.md) for the product and
implementation contract.

## Package artifacts

OpenWrt currently needs two package formats:

- OpenWrt 24.10 and older: build `dist/luci-app-localclash_<version>-<release>_all.ipk`
  with `./scripts/build-openwrt-ipk.sh`, then install with `opkg`.
- OpenWrt 25.12 and newer: build `dist/luci-app-localclash-<version>-r<release>.apk`
  with `./scripts/build-openwrt-apk.sh`, then install with `apk`.

Both artifacts contain the same UI-only files: LuCI views, menu metadata, rpcd
ACL, rpcd helper, and static help text. Neither artifact bundles the localClash
Go core, Mihomo cores, dashboard assets, subscriptions, generated configuration,
or runtime state.

Router deployment helpers are split by package manager:

```sh
./scripts/deploy-openwrt-ipk.sh  # OpenWrt 24.10 and older, opkg
./scripts/deploy-openwrt-apk.sh  # OpenWrt 25.12 and newer, apk
```

Public releases should upload both package artifacts and label them by OpenWrt
version/package manager so users do not install the wrong format.

## Current skeleton

The OpenWrt package work starts under:

```text
openwrt/luci-app-localclash/
```

It currently contains the package metadata, LuCI view entrypoint, rpcd ACL, and
a narrow rpcd helper. The helper can report bootstrap/service status, download
the localClash core from the release manifest, verify sha256, install it to
`/usr/local/bin/localclash`, and bridge installed-core calls to the product JSON
CLI.

By default `bootstrap_core` reads:

```text
https://github.com/qoli/localClash/releases/latest/download/localclash-release-manifest.json
```

Override it with `LOCALCLASH_RELEASE_MANIFEST` for testing or alternate release
channels.
