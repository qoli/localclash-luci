# dnsqualify

`dnsqualify` is the on-demand DNS measurement and selection tool owned and
released by `localclash-luci`. It remains a standalone process, is not part of
localClash Core, and never runs unless invoked by a user or another explicit
operator surface.

Its only integration artifact is a strict `dnsqualify.json` config:

```bash
dnsqualify \
  --output /root/localclash/dnsqualify.json \
  --resolv-path /tmp/resolv.conf.d/resolv.conf.auto \
  --json
```

The program compares WAN and known public resolvers, tests fixed-IP
connectivity and known-service CDN delivery, ranks eligible candidates, and
atomically replaces the output only after the full run succeeds. Failed or
incomplete measurements preserve the previous config.

localClash Core does not import this module or understand its measurement
report. It only validates and consumes the resulting config when present.

Release builds are produced by
`../../scripts/build-dnsqualify-assets.sh <localclash-luci-tag>`. The LuCI
helper selects the matching Linux architecture, verifies the release checksum,
and atomically installs the binary before an explicit qualification run.

See [Design](docs/design.md) for measurement contracts and service coverage.
