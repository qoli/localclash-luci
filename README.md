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
