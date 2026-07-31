# dnsqualify Design

Status: LuCI-owned on-demand qualification tool, report version 3.

`dnsqualify` is an independent, on-demand measurement program. It compares WAN
and public DNS candidates and records:

1. DNS exchange and answer-set evidence;
2. fixed-IP connectivity for every returned known-service address;
3. service-specific CDN throughput observations.

It does not control whether WAN DNS may be used by default. Its selection
stage consumes the fresh in-memory report, requires usable DNS and
required-service connectivity, ranks eligible WAN and public resolvers with
speed as an optimization signal, and writes an independent optimization config.

## WAN Baseline, Explicit Fallback, And Optimization

For `geosite:cn`, the builtin router renderer follows this precedence:

1. a valid enabled optimization config;
2. confirmed WAN-interface DNS that completes a basic DNS exchange;
3. AliDNS DoH only when WAN DNS cannot be confirmed or none responds.

The AliDNS transition is explicit in render/status output as
`alidns_fallback`, including its cause. WAN speed, CDN quality, and qualification
thresholds do not veto the default WAN path.

`proxy-server-nameserver` remains a separate role and is not modified by DNS
optimization.

LuCI runs measurement, selection, state write, render, and Mihomo config test as
one explicit optimization task. The report must be no more than 30 minutes old
and include connectivity and speed observations. A candidate needs successful
DNS exchanges and required-service connectivity; measured speed ranks
candidates but is not a pass/fail gate. A selected WAN candidate must still
match the same live IP/interface provenance. The resulting policy remains
bounded:

```yaml
dns:
  nameserver-policy:
    geosite:cn:
      - <selected WAN IP or public DNS endpoint>
```

The operation renders and runs `mihomo -t`. A failed render or config test
restores the previous optimization state. Reset deletes only the independent
optimization config and returns to WAN DNS with the explicit AliDNS fallback.
Restart remains a separate explicit action. Missing or stale reports, changed
WAN provenance, malformed optimization state, custom runtime profiles, and
incomplete candidate evidence fail explicitly instead of being ignored.

## Command

Run it on OpenWrt so WAN and public resolvers are observed from the actual
access network:

```bash
dnsqualify --output /root/localclash/dnsqualify.json \
  --samples 3 \
  --timeout 3s \
  --service-samples 2 \
  --service-bytes 8388608 \
  --json
```

`--service-bytes` is the maximum byte budget for each object probe/IP sample.
Each catalog probe declares its own `measurement_bytes`; the smaller explicit
value is used. Set the flag to `0` only when DNS transport and answer-set
evidence is wanted without service qualification. The report then marks both
service gates as `not_requested`; it does not emit a valid-looking delivery
result.

Use `--service-catalog /absolute/catalog.json` for a reviewed external catalog.
When omitted, the CLI explicitly loads the builtin catalog. A specified file
that is missing, malformed, expired, or semantically incomplete fails the
command; it never falls back to the builtin catalog.

## DNS Candidate Lanes

UDP candidates are compared with other UDP candidates:

- resolvers associated with WAN interfaces in
  `/tmp/resolv.conf.d/resolv.conf.auto`;
- AliDNS `223.5.5.5`;
- DNSPod Public DNS `119.29.29.29`;
- 114DNS `114.114.114.114`.

DoH candidates are a separate transport lane:

- `https://dns.alidns.com/dns-query`, connected to the provider-documented
  `223.5.5.5`;
- `https://doh.pub/dns-query`, whose current production IPv4 endpoints are
  resolved through the first WAN IPv4 resolver and expanded into separate
  candidates;
- optional `https://cloudflare-dns.com/dns-query`, connected to
  provider-documented `1.1.1.1`, enabled by `--global-control`.

Every DoH candidate records `dial_ip_source`. UDP and DoH latency are not
collapsed into one ranking.

The WAN resolver file proves interface association. It does not by itself prove
whether an address was learned from PPPoE/DHCP or configured statically.

## Probe Kinds

The catalog supports exactly three kinds:

- `canonical_object`: a stable, public object whose exact service surface is
  named in `coverage`;
- `session_object`: a short-lived URL captured from a real service session and
  guarded by a mandatory future `expires_at`;
- `connectivity_only`: a bounded HTTP response contract that never emits or
  contributes a throughput result.

An unknown kind fails validation. A connectivity-only probe cannot declare
speed fields, and an object probe cannot omit its measurement byte budget,
minimum response byte contract, or speed thresholds.

## Layer 1: Connectivity Gate

The service catalog contributes A and AAAA test cases for every distinct
hostname. For every successful DNS answer, `dnsqualify`:

- retains resolver-to-IP provenance;
- deduplicates the network request while preserving every candidate ID;
- connects directly to that exact IP;
- keeps the original hostname for HTTP Host and TLS SNI;
- applies the probe's explicit redirect policy: `reject`, or at most three
  HTTPS redirects that preserve hostname and port under `same_origin`;
- validates the declared HTTP status and content type;
- records IPv4 and IPv6 independently.

The connectivity gate passes only when the response contract reaches
`minimum_response_bytes`, the measured reachability rate meets the probe
contract, and every `required_families` entry produced a tested address. An
object can therefore pass Layer 1 while timing out or falling below threshold
in Layer 2.
An absent or unreachable IPv6 answer is not replaced with IPv4, and an absent
IPv4 answer is not replaced with IPv6. The builtin probes require IPv4 while
still measuring IPv6 whenever the resolver returns it; an IPv6-mandatory
session catalog must declare `["ipv6"]` or `["ipv4", "ipv6"]`.

## Layer 2: Service Speed Gate

After an object response contract succeeds, the runner downloads the smaller
of the command byte cap and the probe's declared byte budget across its object
list. It records:

- TCP connect, TLS, TTFB, total time, and body time;
- bytes and total/body Mbps;
- address family and bounded edge metadata;
- per-IP, per-round success;
- per-resolver p10, p50, and p90 body throughput;
- reachability and throughput pass rates.

Layer 2 passes only when Layer 1 passed, the throughput pass rate meets the
catalog contract, and p10 body throughput meets `minimum_body_mbps`. A fast IP
cannot hide another returned IP that is unreachable or persistently slow.

Connectivity-only probes stop after their declared minimum response bytes and
record Layer 2 as not applicable. They do not emit zero-Mbps results that could
be mistaken for failed speed measurements.

## Service Group Qualification

Each probe belongs to a named group. A group declares:

- whether it is required;
- `minimum_connectivity_passed`;
- `minimum_speed_passed`.

Candidate qualification evaluates required groups. A communications group may
require connectivity while requesting no speed gate; a delivery group can
require both. Optional control groups remain visible but cannot veto a mainland
resolver. Impossible group thresholds fail catalog validation before any DNS or
HTTP request begins.

## Builtin Service Catalog

The builtin `mainland-known-services-v2` catalog contains five groups:

- `system-delivery`, required: `apple-developer-hls`, an 8 MiB,
  40 Mbps canonical object probe. It is not Apple TV production coverage.
- `communications`, required: `wechat-public-web`, a connectivity-only probe
  for the WeChat public website edge. It is not messaging, image, video, or
  Mini Program CDN coverage.
- `media`, required: `bilibili-public-web`, a connectivity-only probe for the
  Bilibili public website edge. It is not playback CDN coverage.
- `software-delivery`, required: `steam-client-installer`, a 2 MiB, 10 Mbps
  probe using the installer linked by Steam's official About page. It is not
  game depot coverage.
- `global-control`, optional: `cloudflare-download-control`, an 8 MiB, 10 Mbps
  synthetic path control. It is not a proposed mainland default.

The Apple probe is grounded in
[Apple's public HLS examples](https://developer.apple.com/streaming/examples/).
The Steam object is the installer linked by
[Steam's official About page](https://store.steampowered.com/about/).
The catalog records a deterministic content hash in every report.

Apple software update, Apple TV production, WeChat messaging/media, Bilibili
playback, Steam game depots, Microsoft Update, and other session-driven
services still require actual runtime discovery. The report must name the exact
covered surface instead of generalizing one hostname to every product.

## External And Session Catalogs

An external catalog is strict JSON:

```json
{
  "version": 2,
  "id": "private-session-services",
  "groups": [
    {
      "id": "media-session",
      "name": "Current media session",
      "required": true,
      "minimum_connectivity_passed": 1,
      "minimum_speed_passed": 1
    }
  ],
  "probes": [
    {
      "id": "apple-tv-current-session",
      "group_id": "media-session",
      "kind": "session_object",
      "service": "Apple TV",
      "coverage": "user-supplied current Apple TV media session",
      "source_url": "https://support.apple.com/",
      "urls": [
        "https://example.invalid/current-media-segment"
      ],
      "expected_status_codes": [200, 206],
      "expected_content_types": ["video/mp4"],
      "required_families": ["ipv6"],
      "redirect_policy": "reject",
      "measurement_bytes": 8388608,
      "minimum_response_bytes": 1024,
      "minimum_body_mbps": 40,
      "minimum_reachability_rate": 1,
      "minimum_throughput_pass_rate": 0.8,
      "expires_at": "2026-07-30T23:59:59+08:00"
    }
  ]
}
```

All URLs in one probe must be HTTPS and use one hostname and port.
`session_object` probes require a future RFC3339 `expires_at`; expired sessions
fail validation. Unknown JSON fields, missing provenance, unknown groups,
impossible quorums, missing thresholds, mixed hostnames, redirects, and
response-contract mismatches fail explicitly.

Do not persist signed URLs, cookies, authorization headers, account media, or
playback tokens in the repository. A private session catalog should be created
outside the checkout, excluded from logs, and deleted after the measurement.

## Community Corpus Boundary

The optional pinned
[`felixonmars/dnsmasq-china-list`](https://github.com/felixonmars/dnsmasq-china-list)
`cdn-testlist.txt` remains a DNS discovery universe. It can identify names whose
answer sets differ across resolvers, but it is not a service-speed corpus:
entries do not carry stable URLs, expected statuses, content types, or download
budgets.

Community domain lists must not be probed wholesale as if an arbitrary HTTP
response proved application success.

## Attribution And Decision Boundary

If resolvers return different IPs and fixed-IP delivery measurements remain
different across rounds, the result is DNS-selection evidence.

If every resolver returns the same IP set, delivery measurements describe path
and time conditions, not a resolver-selected CDN difference.

The report never updates Mihomo automatically. LuCI can submit a fresh passing
report to the separate optimizer after an explicit user action; the optimizer
is limited to `geosite:cn`. Proxy-node bootstrap DNS, mainland direct-service
DNS, and global policy DNS remain separate roles.

The current catalog is intentionally small. Nationwide acceptance still needs
multi-vantage measurements across China Telecom, China Unicom, and China
Mobile, longer time-of-day sampling, and additional service probes with stable
public contracts.
