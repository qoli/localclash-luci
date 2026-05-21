# OpenWrt LuCI Support

This document defines the first LuCI product surface for localClash. The goal is
to make the OpenWrt path beginner-friendly without turning LuCI into a second
configuration system.

## Product Boundary

`luci-app-localclash` is a UI-only OpenWrt package. It installs the LuCI-facing
surface and a helper capable of bootstrapping the real runtime pieces. It does
not ship the localClash Go core, Mihomo core, dashboard assets, OpenWrt init
script instance, or advanced routing configuration.

There are four roles in the LuCI architecture:

1. **OpenWrt package install layer**: installs static LuCI package files only.
   It installs the LuCI JavaScript view, menu entry, rpcd ACL, rpcd helper
   executable, optional static help text, and package metadata. It does not
   install `/usr/local/bin/localclash`, `/etc/init.d/localclash-mcp`, Mihomo
   binaries, dashboard assets, subscriptions, generated configs, or runtime
   state.
2. **LuCI frontend layer**: renders the browser UI, collects user intent, calls
   rpcd methods, shows status/errors, and never executes shell commands or edits
   localClash files directly.
3. **LuCI helper function layer**: owns all router-side imperative integration
   that is not the localClash core itself. It downloads and installs
   `/usr/local/bin/localclash`, creates or repairs `/etc/init.d/localclash-mcp`,
   starts/stops/inspects the procd service, bridges LuCI requests to product CLI
   JSON commands, and reports bootstrap/service status.
4. **Downloaded localClash core**: owns product behavior after installation:
   subscriptions, config model, config render, product CLI JSON commands, MCP
   HTTP server, component updates, Mihomo lifecycle, router takeover,
   diagnostics, and reset. It also owns runtime artifacts created by those
   operations, including Mihomo cores, dashboard assets, subscription artifacts,
   generated configs, logs, and runtime state.

The localClash core is installed or updated over the network from a release
source. After the core is installed, product behavior delegates to the existing
localClash runtime, subscription, render, MCP, and router takeover logic.

```text
luci-app-localclash package
-> LuCI UI
-> rpcd ACL and helper
-> static package metadata

LuCI helper function layer
-> bootstrap localClash core
-> create or repair /etc/init.d/localclash-mcp
-> start/stop/status procd service
-> bridge LuCI requests to product CLI JSON

downloaded localClash core
-> subscriptions
-> config model
-> config render
-> MCP HTTP server
-> Mihomo lifecycle
-> router takeover
-> doctor/status
```

LuCI should manage only the beginner closed loop:

1. install or update required components
2. configure subscription sources
3. choose a basic runtime profile
4. start or update the running service
5. enable or disable router takeover
6. show status and MCP connection guidance

Advanced edits remain MCP or SSH work. LuCI must not expose a full editor for
packs, proxy groups, custom rules, external rule providers, runtime profiles, or
generated Mihomo YAML.

## Role Responsibilities

The OpenWrt package install layer should include:

- LuCI JavaScript views.
- menu and ACL declarations.
- a narrow rpcd helper executable used before and after the localClash core
  exists.
- static text for MCP connection guidance.

The OpenWrt package install layer must not include or create:

- `/usr/local/bin/localclash`.
- `/etc/init.d/localclash-mcp`.
- Mihomo binaries.
- downloaded dashboard assets.
- subscription URLs or generated runtime artifacts.
- a parallel localClash configuration schema.

The LuCI helper function layer should provide:

- `bootstrap_core`: download, verify, and install `/usr/local/bin/localclash`.
- `service_ensure`: create or repair `/etc/init.d/localclash-mcp`.
- `service_start`, `service_stop`, and `service_status`.
- JSON request bridging from LuCI/rpcd to localClash product CLI commands.
- bootstrap and service logs with secrets redacted.

The downloaded localClash core should provide:

- subscription source configuration and refresh.
- component status/update for Mihomo cores and dashboard assets.
- config template application, render, and status.
- runtime start, restart, stop, and status.
- router takeover apply, stop, and status.
- product CLI JSON commands and MCP server behavior.
- ownership of generated/runtime artifacts such as `bin/linux-*`,
  `.runtime/mihomo/ui/`, `subscription.yaml`, `.runtime/subscriptions/`,
  `generated/`, and `.runtime/mihomo/`.

Core installation must be an explicit LuCI action, not an automatic `postinst`
network download. Installing the OpenWrt package should be transparent and
should not depend on WAN, DNS, GitHub, or proxy reachability.

## LuCI V1 Page

The first version can be a single page with compact sections.

### 1. Subscription Management

Provide a `Subscription Management` button. Clicking it opens a dialog with a
textarea:

```text
https://example.com/sub-1
https://example.com/sub-2
```

Each non-empty line is one subscription URL. The dialog should provide:

- `Save`: stores subscription sources without refreshing them.
- `Save and Refresh`: stores sources, downloads them, and updates the effective
  `subscription.yaml`.

Subscription URLs are secrets. The status page may show source IDs and refresh
state, but must not render full URLs after save.

### 2. Service Status Report

The top of the page should show observed status before any action controls:

- localClash core: missing, installed, update available, or error.
- Mihomo core: missing, installed, update available, or error.
- dashboard: missing, installed, update available, or error.
- MCP service: stopped, starting, running, or error.
- subscription: missing, configured, refreshed, stale, or error.
- generated config: missing, ready, stale, or error.
- Mihomo runtime: stopped, running, unknown, or error.
- router takeover: inactive, active, partially active, or error.

The report is read-only. It should be safe to refresh frequently.

The MCP service status is part of the LuCI/package layer. It reports whether the
router-hosted MCP service is installed, enabled/running under procd, and
responding on its HTTP health endpoint. It is not a status of individual MCP
tools, and it does not require MCP tool schema changes.

### 3. Required Components

Provide a control group for required component installation and updates:

- `Download or Update localClash`
- `Download or Update Mihomo`
- `Download or Update Dashboard`

These controls are independent rows with their own status and last error. The
localClash row is special: when the core is missing, all localClash-backed
runtime actions must be disabled except core installation and basic log/status
inspection.

Standard component updates have no caller-provided request body. The updater
derives what to install from the trusted release manifest, the observed OpenWrt
architecture, and localClash's current product state:

- `localclash`: install or update the localClash core for this router.
- `mihomo`: install or update the router Mihomo cores required by supported core
  flavors.
- `dashboard`: install or update the configured dashboard asset bundle.

The bootstrap helper may install localClash to:

```text
/usr/local/bin/localclash
```

and expose a wrapper or service path as needed by the OpenWrt package. Downloaded
artifacts must be verified with checksums from a trusted release manifest before
being installed.

### 4. Runtime Configuration

Provide a dropdown for the beginner runtime configuration:

```text
Compact
Default
```

In Chinese UI text this can be:

```text
精簡
預設
```

`Compact` maps to the minimal policy template. `Default` maps to the
ACL4SSR-like localClash default template.

`Modified` is a status, not a template choice. If the active `localclash.yaml`
does not match a known template because MCP or SSH changed it, the UI should show
that state separately:

```text
Current configuration: modified by MCP or SSH
```

If the user chooses `Compact` or `Default` while the current configuration is
modified, LuCI must present an overwrite confirmation before replacing durable
localClash intent.

### 5. Core Flavor

Provide a core flavor selector:

```text
smart
meta
```

This sets the active localClash runtime core flavor. It does not directly start
or restart Mihomo. The selected value is applied when the user clicks the main
apply button.

### 6. Router Takeover

Provide a router takeover checkbox:

```text
[ ] Enable router takeover
```

The checkbox represents desired state only. Toggling it must not immediately
change firewall, DNS, route, or TUN state. The change is applied only through
the main apply button.

When enabled, LuCI should use router profile mode and apply localClash-owned
runtime takeover rules after Mihomo is running. When disabled, LuCI should stop
localClash-owned takeover rules without deleting user-owned OpenWrt firewall
configuration.

Router takeover remains a confirmed operation because it may interrupt network
connectivity.

### 7. Apply and Runtime Controls

The control group should expose one primary action and a small set of runtime
controls:

- `Apply`: save the selected desired state, render config, restart if needed,
  and converge router takeover state.
- `Start`: start Mihomo from the current generated config.
- `Restart`: validate/render config and restart Mihomo.
- `Stop`: stop Mihomo, guarded when router takeover is active.

The main `Apply` action should perform a deterministic sequence:

```text
inspect current status
ensure localClash core is installed
ensure subscription is refreshed
configure runtime profile and core flavor
configure selected policy template when needed
render generated/mihomo.yaml
restart or start Mihomo when requested
apply or stop router takeover to match checkbox state
read back status
```

Any step that can interrupt network access must be explicit in the UI copy.

### 8. Reset

Provide a reset button, but keep destructive scope narrow.

V1 reset should clear localClash configuration and runtime state while keeping
downloaded binaries and dashboard assets:

- subscription source config
- effective subscription artifacts
- `localclash.yaml`
- `localclash-packs.yaml`
- generated config
- runtime state under `.runtime/`

Reset should not remove:

- localClash core binary
- Mihomo core binary
- dashboard assets
- package files installed by the OpenWrt package

V1 reset has a fixed scope and should not accept a caller-provided deletion
scope. This keeps LuCI and CLI behavior predictable.

If a full uninstall flow is added later, it should be separate from reset.

### 9. MCP Connection Guidance

Show one copyable sentence that a user can paste into an Agent conversation.
The sentence should include the router MCP endpoint and the expected first
inspection tools.

Example:

```text
Please connect to localClash MCP at http://192.168.6.1:8765/mcp, first call tools_list and environment_inspect, then use the reported safety_level before making any runtime or router takeover changes.
```

The IP address should be generated from the observed router address or the
configured MCP listen address when available.

## Backend and Product API Shape

Before localClash core is installed, LuCI must rely on the package bootstrap
helper. This helper should stay intentionally small:

```text
core_status
core_download
core_install
service_status
service_start
service_stop
read_basic_logs
```

After localClash core is installed, LuCI should not call a LuCI-only facade with
many UI-shaped flags. LuCI should consume a high-level product API that is also
acceptable as the human CLI surface.

MCP tools are not part of this LuCI support change. Existing MCP tools may keep
their current names, schemas, and safety levels. They should not be renamed or
restructured just because the LuCI-facing CLI is rebuilt.

This product is not released yet, so the existing CLI names and hierarchy may be
broken and rebuilt around product operations. Backward compatibility for the
current command names is not a goal. Capability parity is a hard requirement:
the rewrite must not remove the underlying abilities that the current CLI has.

The preferred command tree is product-oriented but still covers the original
operation surface:

```text
localclash status --json

localclash subscription status --json
localclash subscription set --input subscriptions.json --json
localclash subscription refresh --json

localclash component status --json
localclash component update localclash --json
localclash component update mihomo --json
localclash component update dashboard --json

localclash config status --json
localclash config apply-template --input config-request.json --json
localclash config render --json

localclash runtime status --json
localclash runtime start --json
localclash runtime restart --json
localclash runtime stop --json

localclash takeover status --json
localclash takeover apply --json
localclash takeover stop --json

localclash apply --input desired-state.json --json
localclash reset --json
localclash mcp serve
```

The important boundary is that the LuCI/human command surface is product-level,
versioned, and JSON-based. LuCI should submit desired state, not individual
implementation details, for the main apply flow. It may still call focused
product commands for independent controls such as component updates or status
refreshes.

## Input JSON Contracts

Commands that accept `--input` must validate strict JSON. Unknown fields are an
error. Every input object must include `version: 1`.

These contracts are adapters over current code, not invented parallel models.
Current implementation anchors:

- subscriptions: `internal/subscriptions.Configure` and `Refresh`.
- templates: `internal/policytemplate.Build`.
- runtime profile/core: `internal/runtimeprofile.Configure`.
- config render: `internal/configrender.Render`.
- core download: `internal/coredownload.Download`.
- dashboard download: `internal/dashboard.Download`.
- runtime control: `internal/corerun.Start`, `Restart`, `Stop`, and `Status`.
- router takeover: `internal/routertakeover.Status`, `Apply`, and `Stop`.
- reset: `internal/reset.Run`.

### `subscription set --input subscriptions.json`

This command stores subscription sources. It does not refresh them.

The current internal subscription model uses `subscriptions.Source{ID, URL}` and
requires an `id` for artifact paths and source-aware node resolution. LuCI should
not expose that internal id. The product CLI must accept URL-only input, then
derive internal source ids before calling the existing subscription service.

Schema:

```json
{
  "version": 1,
  "urls": [
    "https://example.com/sub"
  ]
}
```

Fields:

- `version`: required integer, must be `1`.
- `urls`: required array, at least one item. Each item must be an absolute
  `http` or `https` URL. Empty strings are invalid after trimming.

Behavior:

- The command replaces the complete subscription source list. This matches the
  LuCI textarea model.
- The product CLI maps URLs to internal source ids before calling the existing
  subscription configure code. IDs are implementation details.
- ID generation must be deterministic for a given ordered URL list. A simple V1
  rule is `sub-1`, `sub-2`, ... by trimmed line order.
- The generated ids must obey the current internal validation rule: only letters,
  digits, underscore, and hyphen.
- The command must reject duplicate URLs after trimming.

The command must not echo full subscription URLs in normal JSON output. Return
generated source ids and redacted URL summaries only.

### `config apply-template --input config-request.json`

This command writes product configuration intent for the basic LuCI templates.
It does not refresh subscriptions, render config, start Mihomo, or apply router
takeover.

Implementation maps to current code by calling `policytemplate.Build` for the
template, writing the returned `localconfig.Config` to `localclash.yaml`, and
calling `runtimeprofile.Configure` for runtime profile and core.

Schema:

```json
{
  "version": 1,
  "template": "localclash-default",
  "runtime_profile": "router",
  "core": "smart",
  "allow_overwrite_modified": false
}
```

Fields:

- `version`: required integer, must be `1`.
- `template`: required string enum: `minimal`, `localclash-default`.
- `runtime_profile`: required string enum: `normal`, `router`.
- `core`: required string enum: `meta`, `smart`.
- `allow_overwrite_modified`: required boolean. If `false`, the command must
  fail when current durable config is modified outside a known template.

Code-grounded notes:

- `template` values come from current files under `policy-templates/` and the
  constants in `internal/policytemplate`.
- `runtime_profile` values come from `runtimeprofile.ModeNormal` and
  `runtimeprofile.ModeRouter`.
- `core` values come from `runtimeprofile.CoreMeta` and
  `runtimeprofile.CoreSmart`.
- The implementation must not invent a new policy schema. Template application
  writes the existing `localconfig.Config` model.

### `apply --input desired-state.json`

This command is the main LuCI convergence operation. It accepts desired state,
previews or executes the change, and reads back status. It may perform multiple
product operations in sequence.

Schema:

```json
{
  "version": 1,
  "mode": "preview",
  "subscriptions": {
    "urls": [
      "https://example.com/sub"
    ],
    "refresh": true
  },
  "components": {
    "localclash": "installed_or_latest",
    "mihomo": "installed_or_latest",
    "dashboard": "installed_or_latest"
  },
  "config": {
    "template": "localclash-default",
    "runtime_profile": "router",
    "core": "smart",
    "allow_overwrite_modified": false
  },
  "runtime": {
    "service": "restart_if_needed",
    "router_takeover": "enabled"
  }
}
```

Fields:

- `version`: required integer, must be `1`.
- `mode`: required string enum: `preview`, `execute`. `preview` reports changes
  without mutating runtime state. `execute` applies the confirmed desired state.
- `subscriptions`: optional object. If omitted, leave subscription config and
  artifacts unchanged.
- `subscriptions.urls`: optional array with the same item schema as
  `subscription set`. If present, URLs replace the complete stored source list
  before refresh.
- `subscriptions.refresh`: optional boolean, default `false`. If `true`, refresh
  stored sources after any source update.
- `components`: optional object. Missing fields default to `leave`.
- `components.localclash`: string enum: `leave`, `installed_or_latest`.
- `components.mihomo`: string enum: `leave`, `installed_or_latest`.
- `components.dashboard`: string enum: `leave`, `installed_or_latest`.
- `config`: optional object. Missing fields default to `leave` except
  `allow_overwrite_modified`, which defaults to `false`.
- `config.template`: string enum: `leave`, `minimal`, `localclash-default`.
- `config.runtime_profile`: string enum: `leave`, `normal`, `router`.
- `config.core`: string enum: `leave`, `meta`, `smart`.
- `config.allow_overwrite_modified`: optional boolean, default `false`.
- `runtime`: optional object. Missing fields default to `leave`.
- `runtime.service`: string enum: `leave`, `start`, `restart`,
  `restart_if_needed`, `stop`.
- `runtime.router_takeover`: string enum: `leave`, `enabled`, `disabled`.

This preview is LuCI's apply preview, not an Agent or MCP plan.

Component behavior must follow current component code:

- `components.mihomo = installed_or_latest` maps to current router core download
  defaults: `coredownload.Download` with target `router`, OS `linux`, flavor
  `all`, and force replace semantics for update.
- `components.dashboard = installed_or_latest` maps to `dashboard.Download` with
  the existing default repo, asset, and output directory.
- `components.localclash = installed_or_latest` is handled by the package
  bootstrap helper when the localClash binary is missing. The Go core cannot
  update itself before it exists; if self-update is implemented after
  installation, it must use the same release-manifest rule as the bootstrap
  helper.

Runtime behavior must follow current runtime code:

- `runtime.service = start` maps to `corerun.Start`.
- `runtime.service = restart` maps to `corerun.Restart`.
- `runtime.service = restart_if_needed` starts when stopped and restarts when
  already running.
- `runtime.service = stop` maps to `corerun.Stop`, with existing router takeover
  guards preserved by product-level orchestration.
- Runtime commands use the active runtime profile core path and the default
  generated config/runtime paths unless future code explicitly adds separate
  product requirements.

Router takeover behavior must follow current router takeover code:

- `runtime.router_takeover = enabled` maps to `routertakeover.Apply` after the
  runtime is running and profile mode is `router`.
- `runtime.router_takeover = disabled` maps to `routertakeover.Stop`.
- No persistent OpenWrt firewall configuration is written.

## No-Input Command Contracts

No-input product commands still have fixed behavior. They must use the same
default paths as the current code unless this document explicitly says
otherwise.

- `status --json`: aggregate safe read-only localClash product status from
  subscription status, component status, config status, runtime profile status,
  runtime status, and takeover status. It must redact secrets. It does not own
  procd service inspection; LuCI combines it with rpcd `service_status` for the
  complete page report.
- `subscription status --json`: maps to `subscriptions.Status` with defaults
  `localclash-subscriptions.yaml`, `subscription.yaml`, and
  `.runtime/subscriptions`.
- `subscription refresh --json`: maps to `subscriptions.Refresh` with the same
  defaults and no source ID filter. It refreshes all configured sources.
- `component status --json`: reports local presence and versions when available
  for localClash, Mihomo cores, and dashboard assets. This may require new
  read-only glue code, but it must not invent component configuration state.
- `component update mihomo --json`: maps to `coredownload.Download` with router
  defaults: target `router`, OS `linux`, flavor `all`, output dir `bin`, and
  force replace semantics for update.
- `component update dashboard --json`: maps to `dashboard.Download` with current
  defaults: repo `Zephyruso/zashboard`, asset `dist.zip`, output
  `.runtime/mihomo/ui/zashboard`, and force replace semantics for update.
- `component update localclash --json`: handled by the package bootstrap helper
  when the Go core is missing. If implemented inside the Go core later, it must
  use a trusted localClash release manifest and atomic replace semantics.
- `config status --json`: maps to the existing config status behavior in MCP and
  local config inspection. It reads `localclash.yaml`, `localclash-packs.yaml`,
  `generated/mihomo.yaml`, subscription state, and runtime profile state.
- `config render --json`: maps to `configrender.Render` using current defaults:
  source `subscription.yaml`, policy `policies/loyalsoldier.yaml`, selection
  `localclash-packs.yaml`, runtime profile `localclash-runtime.yaml`, output
  `generated/mihomo.yaml`, and force overwrite because generated config is a
  build artifact.
- `runtime status --json`: maps to `corerun.Status` with generated config and
  `.runtime/mihomo` defaults.
- `runtime start --json`: maps to `corerun.Start` after ensuring/rendering config
  when the effective subscription exists and generated config is missing.
- `runtime restart --json`: maps to `corerun.Restart` and validates config before
  replacing the running process.
- `runtime stop --json`: maps to `corerun.Stop`, with product-level guard that
  refuses to stop while router takeover is effective unless takeover is stopped
  first.
- `takeover status --json`: maps to `routertakeover.Status`.
- `takeover apply --json`: maps to `routertakeover.Apply`; it requires router
  profile mode and running Mihomo.
- `takeover stop --json`: maps to `routertakeover.Stop`.
- `reset --json`: maps to `reset.Run` with the fixed V1 reset scope described
  above. It must refuse while Mihomo is running, matching current reset behavior.
- `mcp serve`: starts the existing MCP server. Existing MCP tool names and
  schemas are outside this CLI restructuring.

## JSON Response Contract

All product CLI commands should return one JSON object and no extra stdout text.

Success envelope:

```json
{
  "ok": true,
  "changed": false,
  "summary": "No changes required.",
  "status": {},
  "changes": [],
  "warnings": [],
  "next_actions": []
}
```

Error envelope:

```json
{
  "ok": false,
  "code": "modified_config_requires_confirmation",
  "message": "Current localclash.yaml is modified; refusing to overwrite without allow_overwrite_modified.",
  "details": {},
  "next_actions": []
}
```

Errors should use stable `code` strings so LuCI can render specific messages.
Human-readable logs may go to stderr, but stdout must remain valid JSON.

MCP can reuse internal services where convenient, but MCP behavior is not a
target of this restructuring.

The old command names may be removed only after their abilities are represented
in the new product command tree:

```text
core download              -> component update mihomo
dashboard download         -> component update dashboard
config render              -> config render
rules adapt / rules render -> config render or internal rules service
run                         -> runtime start
restart                     -> runtime restart
stop                        -> runtime stop
router takeover apply      -> takeover apply
router takeover stop       -> takeover stop
```

README and router deployment documentation should move to the new product API
once it exists.

## LuCI Command Mapping

The LuCI page is supported by the product command tree as follows:

- Subscription dialog: `subscription set` and `subscription refresh`.
- Service status report: `status`, plus focused `component status`,
  `runtime status`, and `takeover status` when a section needs live refresh.
- Required components: `component update localclash`, `component update mihomo`,
  and `component update dashboard`. When the localClash core is missing, the
  package bootstrap helper handles `localclash` installation because the binary
  cannot call itself yet.
- Runtime configuration dropdown: `apply` with desired state, or
  `config apply-template` for a focused template change.
- Core flavor selector: `apply` or `config apply-template` with the selected
  core flavor.
- Router takeover checkbox: `apply` for converging desired state, or
  `takeover apply` / `takeover stop` for explicit runtime controls.
- Runtime buttons: `runtime start`, `runtime restart`, and `runtime stop`.
- Reset: `reset`.
- MCP guidance: `mcp serve` remains the service entrypoint; existing MCP tools
  are not renamed by this work.

## OpenWrt Package Implementation

The LuCI package should live in a dedicated OpenWrt package directory. The
repository may keep it under `openwrt/luci-app-localclash/` until a separate
feed repository is created.

Required package layout:

```text
openwrt/luci-app-localclash/
  Makefile
  htdocs/luci-static/resources/view/localclash/index.js
  root/usr/share/luci/menu.d/luci-app-localclash.json
  root/usr/share/rpcd/acl.d/luci-app-localclash.json
  root/usr/libexec/rpcd/localclash
```

Optional files:

```text
openwrt/luci-app-localclash/
  root/etc/config/localclash
  root/usr/share/localclash/bootstrap.json
  root/usr/share/localclash/mcp-help.txt
```

Package rules:

- The package is architecture-independent because it contains UI, scripts, ACLs,
  helper code, and static help/config files only. Use `PKGARCH:=all`.
- The package must not install `/usr/local/bin/localclash`.
- The package install step should not directly install
  `/etc/init.d/localclash-mcp`; that service file is managed by helper function
  calls.
- The package must not install Mihomo cores or dashboard assets.
- The package should install a bootstrap helper capable of downloading
  localClash core after explicit user action and generating/repairing the MCP
  service wrapper from helper-owned logic.
- The package should not run network downloads from `postinst`.
- The package should depend only on the LuCI/rpcd/runtime tools needed by the UI
  and helper.

Suggested OpenWrt package metadata:

```make
PKG_NAME:=luci-app-localclash
PKG_VERSION:=0.1.0
PKG_RELEASE:=1
PKGARCH:=all

LUCI_TITLE:=LuCI support for localClash
LUCI_DEPENDS:=+luci-base +rpcd +uclient-fetch +ca-bundle
```

The exact dependency list should be verified against the helper implementation.
If the helper uses shell JSON parsing through `jshn.sh`, include the package that
provides it for the target OpenWrt branch.

## rpcd Helper Contract

The LuCI JavaScript view must call rpcd, not execute shell commands directly.
The rpcd helper is responsible for converting UI calls into product CLI JSON
commands and returning the JSON response unchanged when possible.

Recommended rpcd object:

```text
localclash
```

Methods:

```text
status
subscription_set
subscription_refresh
component_update
apply
runtime_start
runtime_restart
runtime_stop
takeover_status
takeover_apply
takeover_stop
reset
service_start
service_stop
service_status
service_ensure
bootstrap_core
bootstrap_logs
```

Method contracts:

- `status`: no input. Calls `localclash status --json` when the core exists,
  calls `service_status`, and returns a combined LuCI page status. When the core
  is missing, returns bootstrap-only status with `core.installed=false` plus MCP
  service status or service repair guidance from the helper layer.
- `subscription_set`: input `{ "urls": ["https://..."] }`. Writes a temporary
  JSON input file with `{ "version": 1, "urls": [...] }`, calls
  `localclash subscription set --input <file> --json`, then removes the temp
  file.
- `subscription_refresh`: no input. Calls
  `localclash subscription refresh --json`.
- `component_update`: input `{ "component": "localclash|mihomo|dashboard" }`.
  `localclash` uses bootstrap install when the core is missing; other values call
  `localclash component update <component> --json`.
- `apply`: input is the LuCI desired state without `version`. The helper adds
  `version: 1`, writes a temporary JSON file, calls
  `localclash apply --input <file> --json`, then removes the temp file.
- `runtime_start`: no input. Calls `localclash runtime start --json`.
- `runtime_restart`: no input. Calls `localclash runtime restart --json`.
- `runtime_stop`: no input. Calls `localclash runtime stop --json`.
- `takeover_status`: no input. Calls `localclash takeover status --json`.
- `takeover_apply`: no input. Calls `localclash takeover apply --json`.
- `takeover_stop`: no input. Calls `localclash takeover stop --json`.
- `reset`: no input. Calls `localclash reset --json`.
- `service_start`: no input. Ensures the procd service wrapper exists, then
  starts the procd service for MCP.
- `service_stop`: no input. Stops the procd service for MCP.
- `service_status`: no input. Reports procd service status and MCP HTTP health
  when reachable. This is the source of truth for the LuCI MCP service status
  row.
- `service_ensure`: no input. Installs or repairs `/etc/init.d/localclash-mcp`
  from helper-owned service-generation logic. It does not start the service.
- `bootstrap_core`: no input. Downloads, verifies, and installs localClash core.
- `bootstrap_logs`: no input. Returns recent bootstrap/helper logs with secrets
  redacted.

The helper must return the product CLI JSON envelope as-is on stdout for command
calls. If the helper itself fails before invoking localClash, it must return the
same error envelope shape:

```json
{
  "ok": false,
  "code": "bootstrap_core_missing",
  "message": "localClash core is not installed.",
  "details": {},
  "next_actions": ["Install localClash core from the Required Components section."]
}
```

rpcd ACL must expose only the `localclash` methods needed by the LuCI page. It
must not grant broad filesystem or command execution access.

`service_status` response shape:

```json
{
  "ok": true,
  "service": {
    "name": "localclash-mcp",
    "installed": true,
    "enabled": false,
    "running": true,
    "pid": 1234
  },
  "mcp": {
    "endpoint": "http://192.168.6.1:8765/mcp",
    "health_endpoint": "http://192.168.6.1:8765/health",
    "healthy": true,
    "last_error": ""
  }
}
```

`status` should include the same shape under `mcp_service` when returning the
combined LuCI page report.

## Bootstrap Core Contract

The bootstrap helper exists because the localClash Go core may not be installed
yet. Its scope must stay narrow.

Bootstrap status fields:

```json
{
  "ok": true,
  "core": {
    "installed": false,
    "path": "/usr/local/bin/localclash",
    "version": "",
    "update_available": false
  },
  "network": {
    "reachable": true,
    "last_error": ""
  }
}
```

Bootstrap install sequence:

```text
detect OpenWrt architecture
fetch trusted localClash release manifest
select matching linux binary
download to temporary path
verify sha256 from manifest
chmod executable
atomically install to /usr/local/bin/localclash
install or repair /etc/init.d/localclash-mcp through service_ensure
read back localclash version/status
```

The bootstrap helper installs the core binary and then calls the helper's
service-management function to install or repair the procd service wrapper. This
keeps service-file generation in the LuCI helper function layer instead of the
package install layer. A missing core binary is a normal first-run state. A
missing service file is repairable by `service_ensure`.

Architecture mapping must be explicit. For V1, support at least:

```text
aarch64 / arm64 -> linux-arm64
x86_64          -> linux-amd64
```

If the helper sees an unsupported architecture, it must fail with stable error
code `unsupported_architecture` and include the detected architecture in
`details`.

Bootstrap security requirements:

- Downloads must use HTTPS.
- The installed binary must match a sha256 entry in the trusted manifest.
- Installation must use an atomic rename from a temp file in the same filesystem.
- The helper must not execute a downloaded file before checksum verification.
- The helper must not log full subscription URLs or other secrets.

## procd Service Contract

The LuCI helper function layer owns the procd service wrapper for the MCP server:

```text
/etc/init.d/localclash-mcp
```

The OpenWrt package install layer must not ship or place a service template as a
package-owned artifact. Service generation is helper function behavior. The
helper creates or repairs the actual init script when `service_ensure`,
`bootstrap_core`, or `service_start` runs.

Service behavior:

- command: `/usr/local/bin/localclash mcp serve`
- working directory: the localClash state directory used on router deployments
- default state: installed but not necessarily enabled until the user starts it
  from LuCI or package policy explicitly decides otherwise
- stdout/stderr: append to a localClash log file under the state directory
- restart policy: use procd respawn with conservative limits

The service wrapper may exist while `/usr/local/bin/localclash` is still missing.
That is not a failure. The init script must check for the binary before starting
and fail with a clear localClash-core-missing message instead of letting procd
enter a crash loop.

LuCI should show both service state and MCP HTTP health. Service running alone
does not prove MCP is responding.

MCP service status checks:

- procd service file exists or can be repaired by `service_ensure`:
  `/etc/init.d/localclash-mcp`
- localClash core binary exists: `/usr/local/bin/localclash`
- procd service enabled/running state
- HTTP health endpoint returns success
- configured endpoint to copy into Agent instructions

Failure cases should distinguish `service_missing`, `service_repair_failed`,
`service_stopped`, and `mcp_health_failed` so LuCI can show the right next
action. It should also distinguish `core_missing` from service errors:
`core_missing` means the first-run bootstrap action is needed, while
`service_repair_failed` means the helper could not create or repair the service
wrapper.

## Frontend State Model

The LuCI page should be driven by `status` plus action responses. Do not infer
success from button clicks.

Required UI states:

- `core_missing`: localClash core is absent. Enable only `Download or Update
  localClash`, service log/status, and static MCP help. Disable subscription,
  config, runtime, takeover, and reset actions that require the core.
- `mcp_service_unhealthy`: procd service is stopped or MCP health fails. Keep
  local runtime controls available, but show MCP connection guidance as not ready
  and offer service start/restart.
- `core_installed_unconfigured`: core exists, subscription is missing. Enable
  subscription dialog and component updates. Runtime controls remain disabled.
- `subscription_configured_not_refreshed`: enable `Save and Refresh`; show that
  runtime cannot start until refresh succeeds.
- `config_ready_runtime_stopped`: enable start/restart/apply. Router takeover
  apply remains disabled until runtime is running.
- `runtime_running_takeover_inactive`: enable takeover apply when router takeover
  checkbox is selected.
- `takeover_active`: show warning on stop/reset/runtime stop paths. Prefer
  stopping takeover before stopping Mihomo.
- `modified_config`: show modified status. Applying `Compact` or `Default`
  requires overwrite confirmation that sets `allow_overwrite_modified=true`.
- `action_running`: disable conflicting buttons and show progress until rpcd
  returns.
- `action_failed`: show `message`, `code`, and `next_actions` from the JSON
  envelope.

Long-running operations can be synchronous in V1, but the UI must show a busy
state and avoid duplicate submissions. If later operations exceed normal rpcd
timeouts, introduce a job model instead of extending command schemas ad hoc.

## Build and Release Workflow

Initial release can ship as a standalone package artifact before upstreaming.

Development build flow:

```text
copy or symlink openwrt/luci-app-localclash into an OpenWrt buildroot/package feed
./scripts/feeds update -a
./scripts/feeds install luci-app-localclash
make package/feeds/<feed>/luci-app-localclash/compile V=s
```

Publication stages:

1. GitHub Release artifact: publish the built LuCI package and install
   instructions.
2. Project package feed: publish an OpenWrt feed repository so users can add
   `src-git localclash ...` to feeds config.
3. Upstream submission: consider OpenWrt/LuCI upstream only after the package
   and core release manifest are stable.

Package manager compatibility:

- OpenWrt 24.10 and older use opkg packages.
- OpenWrt 25.12 and newer use apk packages.

The package layout should stay source-compatible with OpenWrt buildroot. The
actual artifact format is produced by the target OpenWrt branch.

Core binary release workflow:

```text
build localclash linux-arm64
build localclash linux-amd64
publish binaries in GitHub Release
publish release manifest with sha256 for each binary
LuCI bootstrap helper consumes the manifest
```

The LuCI package and the localClash core release are separate channels. Updating
the UI package should not require rebuilding router-specific Go binaries.

## Development Checklist

The first implementation is complete only when all of these are true:

- Product CLI command tree exists and passes unit tests.
- Product CLI stdout is valid JSON for both success and errors.
- `subscription set` accepts URL-only input and maps to internal source IDs.
- Component update commands work with current code defaults.
- `config apply-template` writes existing `localconfig.Config` and runtime
  profile state.
- Runtime and takeover commands preserve current safety guards.
- Reset scope matches this document.
- rpcd helper has method-level tests or shell tests for JSON pass-through and
  bootstrap errors.
- LuCI page renders all required states from the status envelope.
- LuCI package builds in an OpenWrt SDK/buildroot.
- Router smoke test covers missing core, core install, subscription refresh,
  config apply, runtime start, takeover apply/stop, runtime stop, and reset.

## Safety Rules

- LuCI must not write `generated/mihomo.yaml` directly.
- LuCI must not edit active OpenWrt firewall configuration persistently for
  router takeover.
- LuCI must not reveal subscription URLs after save.
- LuCI must not silently replace a modified `localclash.yaml`.
- LuCI must not automatically download core binaries during OpenWrt package
  installation.
- LuCI must read back status after every apply/start/stop/update action.
- LuCI must keep advanced configuration in MCP or SSH workflows.

## Suggested Implementation Order

1. Add the LuCI design contract and keep it docs-only.
2. Rebuild the localClash CLI into the product command tree while preserving
   capability parity with the current CLI.
3. Move existing internals behind the new product service layer, then remove old
   command names only after the replacement command exists and is tested.
4. Add unit tests for status, subscriptions, component updates, config render,
   runtime controls, takeover controls, apply preview/execution, reset scope,
   and modified config detection.
5. Add the OpenWrt package skeleton with rpcd ACL and bootstrap/service helper
   functions.
6. Add the LuCI single-page UI using the frontend state model.
7. Add build/release scripts or docs for standalone artifacts and feed use.
8. Test on router with missing core, fresh install, configured install, modified
   config, active runtime, and active takeover states.
