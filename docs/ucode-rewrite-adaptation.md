# LuCI ucode Rewrite Proposal

Current status: optional proposal. This is not the next planned LuCI workstream,
and no ucode implementation has landed.

This note records what a future ucode adaptation would involve if the rpcd
adapter layer becomes a maintenance problem or upstream OpenWrt alignment
becomes a stronger goal. It should not be read as a recommendation to prioritize
ucode over current product, helper, and router-test work.

## Scope of the proposal

The current backend surface is a single shell executable at:

```text
openwrt/luci-app-localclash/root/usr/libexec/rpcd/localclash
```

It has accumulated three different responsibilities:

- rpcd method registration and argument shimming.
- helper-owned bootstrap and procd service management before the Go core exists.
- pass-through orchestration to `/usr/local/bin/localclash ... --json` after the
  Go core exists.

ucode could improve the first responsibility and parts of the third because rpcd
can load ucode scripts directly and register ubus objects from the script's
returned method signature. The expected product impact is narrow: ucode would
mainly clean up adapter-layer code. It would not, by itself, make bootstrap,
downloads, service management, runtime start, router takeover, or cancellation
materially safer.

Near-term work should continue to focus on:

- keeping the Go product CLI contract stable
- slimming the shell helper where it owns first-run bootstrap and worker tasks
- clarifying long-running job state and cancellation
- strengthening router smoke tests around missing core, initialization, takeover,
  cancellation, and reset

## OpenWrt rpcd ucode facts

The relevant OpenWrt mechanism is `rpcd-mod-ucode`. The module loads ucode
scripts from:

```text
/usr/share/rpcd/ucode
```

Each script returns an object signature. Top-level keys are ubus object names,
nested keys are methods, and each method provides a `call` function and optional
`args` type hints. rpcd validates declared arguments before invoking the method.

Practical consequences for this project:

- The ubus object can stay `localclash`.
- The LuCI JavaScript `rpc.declare({ object: 'localclash', method: ... })`
  calls can remain stable if method names and result envelopes are preserved.
- Methods that receive LuCI session fields must explicitly tolerate
  `ubus_rpc_session`; the current shell helper strips it with `sed`.
- Long nested ubus calls should use the rpcd ucode async/defer pattern. External
  command execution and downloads still need a non-blocking strategy so rpcd is
  not tied up by multi-minute work.

References:

- `rpcd-mod-ucode`: https://openwrt.org/packages/pkgdata/rpcd-mod-ucode
- rpcd ucode example: https://lxr.openwrt.org/source/rpcd/examples/ucode/example-plugin.uc
- rpcd ucode loader source: https://lxr.openwrt.org/source/rpcd/ucode.c

## Compatibility surface

If this proposal is ever implemented, it should preserve these public surfaces
first:

- `root/usr/share/luci/menu.d/luci-app-localclash.json`
- `root/usr/share/rpcd/acl.d/luci-app-localclash.json`
- `htdocs/luci-static/resources/view/localclash/*.js`
- ubus object `localclash`
- existing method names:
  `status`, `subscription_get`, `subscription_setup_async`,
  `component_update_async`, `bootstrap_default`, `task_status`,
  `task_cancel`, `runtime_start_takeover`, `service_start`, `service_stop`,
  `mcp_help`, and the rest of the current ACL list
- JSON envelope shapes: `{"ok":true,...}` and
  `{"ok":false,"code":...,"message":...,"details":...,"next_actions":[...]}`

A ucode pass should not require frontend rewrites.

## Packaging impact if pursued

Source layout would change from executable rpcd helper to rpcd ucode script:

```text
root/usr/libexec/rpcd/localclash                 # current shell plugin
root/usr/share/rpcd/ucode/localclash.uc          # proposed ucode plugin
```

During a migration, ship both files and let the ucode plugin delegate to the
legacy executable until parity is proven. Remove the shell plugin only after the
router smoke tests pass against the ucode path.

Package metadata would need a dependency review:

- add `rpcd-mod-ucode`
- keep `rpcd`, `luci-base`, `uclient-fetch`, and `ca-bundle`
- keep `jsonfilter` only while the shell helper or external shell workers still
  depend on it
- verify exact `ucode-mod-*` dependencies in the target OpenWrt SDK once the
  script imports are known

The standalone artifact scripts would also need updates:

- `scripts/build-openwrt-ipk.sh`
  - install `root/usr/share/rpcd/ucode/localclash.uc`
  - stop chmodding `usr/libexec/rpcd/localclash` once the shell file is gone
  - change `Depends:` to include `rpcd-mod-ucode`
  - change `postinst` service-start fallback from direct helper execution to an
    ubus call, or skip it and let the UI start the service explicitly
- `scripts/build-openwrt-apk.sh`
  - mirror the same dependency and post-install changes
- `scripts/deploy-openwrt-ipk.sh` and `scripts/deploy-openwrt-apk.sh`
  - verify the ucode script path
  - verify `ubus -S list localclash` and at least `ubus -S call localclash status '{}'`

## Adapter migration map

Adapter logic that would be reasonable ucode candidates:

- method registration and input schema declarations
- `mcp_help`
- `service_status` response assembly
- `status` envelope assembly when it mostly combines product CLI JSON
- `subscription_set` and `apply` input-file wrapping
- JSON parsing currently handled by `jsonfilter` for request payloads
- `bootstrap_logs` and `task_status` file reads

Keep or isolate as worker-backed until proven safe:

- mirror probing and download retries
- checksum verification and atomic core install
- procd service script generation
- background task lifecycle and cancellation
- process-tree termination
- runtime start plus router takeover rollback orchestration

The heavy path can still be ucode-owned at the ubus boundary while delegating the
actual work to either:

1. the existing shell helper during the transition, or
2. a smaller worker executable/script with a private interface, or
3. future product CLI commands moved into the Go core.

The third option is not enough for first-run core bootstrap because the Go core
does not exist yet.

## Possible migration phases if revisited

### Phase 1: ucode facade, shell worker preserved

Add `root/usr/share/rpcd/ucode/localclash.uc` that registers the same
`localclash` object and delegates every method to the current shell helper.

Goal:

- validate OpenWrt package dependencies
- validate rpcd loads the ucode object
- keep LuCI UI and ACL unchanged
- avoid changing bootstrap behavior

Exit criteria:

- package installs on the current OpenWrt targets
- `ubus -S list localclash` exposes the same methods
- existing LuCI pages load and actions still work
- real-router safe test passes with the ucode object active

### Phase 2: move pure adapter logic into ucode

Move low-risk code from shell into ucode:

- method argument normalization
- `ubus_rpc_session` stripping/ignoring
- versioned payload generation for `--input` commands
- static MCP help response
- status composition and simple file-backed task/log reads

Keep all download, service mutation, process cancellation, and network takeover
operations delegated.

Exit criteria:

- frontend behavior remains unchanged
- malformed input returns stable JSON errors
- subscription URLs are not logged or echoed after save

### Phase 3: split long-running jobs from rpcd request handling

Replace shell background task bookkeeping with a single explicit job model:

- `task_start` creates a job file and spawns worker process
- `task_status` reads structured job state
- `task_cancel` terminates only the tracked worker process tree
- logs remain redacted and bounded

This can be implemented in ucode only if external process management is clean
and testable on target OpenWrt. Otherwise keep a tiny worker script and let ucode
own the public ubus API.

Exit criteria:

- no multi-minute operation blocks the rpcd main loop
- cancellation works for fetch, core install, component update, and takeover
- interrupted jobs reconcile to a stable terminal state

### Phase 4: remove legacy shell plugin

Delete `/usr/libexec/rpcd/localclash` only after the ucode path owns the public
object and all helper behavior has parity.

Exit criteria:

- package artifact contains no obsolete rpcd executable
- build, deploy, and real-router smoke scripts verify the ucode script path
- ACL and LuCI views still require no method rename

## Main risks

- rpcd responsiveness: moving long synchronous operations directly into ucode can
  block rpcd. Treat long work as jobs, not normal request handlers.
- LuCI session argument handling: ucode `args` validation rejects undeclared
  fields. Account for `ubus_rpc_session` explicitly.
- First-run bootstrap: the Go core cannot help before it is installed. A pure
  Go-owned solution cannot cover the earliest bootstrap state.
- Package dependency drift: `rpcd-mod-ucode` is required, and any imported ucode
  modules must be verified against OpenWrt 24.10 and 25.12 SDKs.
- Security regression: the rewrite must preserve checksum verification, atomic
  install, absolute workspace validation, protected-path refusal, and URL
  redaction.

## Testing checklist

Local/static:

- parse or compile the ucode script with the target OpenWrt `ucode` tool when
  available
- keep shell tests while the shell worker exists
- add fixture tests for ucode request normalization and response envelopes if a
  local ucode runtime is available

Package:

- build `.ipk` and `.apk`
- inspect package contents for `/usr/share/rpcd/ucode/localclash.uc`
- verify dependency metadata includes `rpcd-mod-ucode`

Router:

- restart rpcd after install
- `ubus -S list localclash`
- `ubus -S call localclash status '{}'`
- missing-core first-run page load
- core bootstrap
- subscription save/refresh
- default initialization
- runtime start plus takeover apply
- takeover stop
- runtime stop
- config reset and full reset guards

## Recommendation

Do not treat ucode as the next LuCI implementation step. The improvement is
mostly code-organization value in the rpcd adapter layer, while the highest-risk
localClash LuCI behavior remains in bootstrap, downloads, service management,
runtime control, router takeover, and real-router validation.

Keep this as a future proposal. Revisit it only if the shell rpcd adapter becomes
a clear maintenance blocker, an upstream OpenWrt packaging goal makes ucode
alignment important, or the long-running job model has already been simplified
enough that a small ucode facade would be low-risk. If revisited, start with a
facade that preserves the current shell worker and move only adapter logic in
small slices.
