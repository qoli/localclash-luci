# LuCI network status layout reference

Captured from `http://192.168.6.1/cgi-bin/luci/admin/status/overview` on 2026-05-31 via Arc CDP.

This is a visual and structural reference for improving the localClash LuCI status surface. It focuses on the stock LuCI/OpenWrt `网络` section because it already solves three useful UI problems:

- It groups related live status into compact cards.
- It keeps long network values readable without turning the whole section into a dense table.
- It combines card summaries with a lower metric row using the native LuCI table/progressbar style.

Do not copy sampled runtime values into product UI. Use only the structure and style patterns below.

## Source structure

The sampled section is:

```html
<div class="cbi-section fade-in">
  <h3>网络</h3>
  <div>
    <div class="network-status-table">
      <div class="ifacebox">
        <div class="ifacebox-head center active">
          <strong>IPv4 上游</strong>
        </div>
        <div class="ifacebox-body left">
          <span>
            <span class="nowrap"><strong>协议: </strong>PPPoE</span><br>
            <span class="nowrap"><strong>地址: </strong>...</span><br>
            <span class="nowrap"><strong>网关: </strong>...</span><br>
            <span class="nowrap"><strong>DNS: </strong>...</span><br>
            <span class="nowrap"><strong>已连接: </strong>...</span>
          </span>
          <div>
            <span class="ifacebadge">
              <img src="/luci-static/resources/icons/tunnel.png">
              <span>
                <span class="nowrap"><strong>设备: </strong>隧道接口: "pppoe-wan"</span><br>
              </span>
            </span>
          </div>
        </div>
      </div>

      <div class="ifacebox">...</div>
    </div>

    <table class="table">
      <tr class="tr">
        <td class="td left" width="33%">活动连接</td>
        <td class="td left">
          <div class="cbi-progressbar" title="3129 / 65536 (4%)">
            <div style="width:4.00%"></div>
          </div>
        </td>
      </tr>
    </table>
  </div>
</div>
```

## Layout anatomy

### Outer section

Use LuCI's native section shell:

- `cbi-section fade-in`
- White card background.
- Rounded section radius around `0.375rem`.
- Subtle large shadow: visually separates the module from the LuCI page without creating a new design language.
- Heading is inside the card as the first child, not outside it.

Sampled desktop metrics:

- Section rect: about `1622 x 428`.
- Section margin: `1.5rem 0`.
- Section padding: `0`.
- Heading padding: `1rem`.
- Heading font: `18px`, weight `700`.

Implication for localClash:

Use this as the container for an entire localClash status block, not for every small metric. The card should hold a complete conceptual group such as "Runtime", "Router takeover", or "Subscriptions".

### Card row

The important layout primitive is:

```css
.network-status-table {
  display: flex;
  flex-wrap: wrap;
}

.network-status-table .ifacebox {
  flex-grow: 1;
  margin: 0.5em;
  border-radius: 0.375rem;
}
```

Why it works:

- Cards fill the row naturally on wide screens.
- Cards wrap without a separate breakpoint.
- Different content lengths can still coexist.
- The row visually reads as "two peer upstreams", not as arbitrary fields.

Sampled desktop card metrics:

- IPv4 card: about `727 x 292`.
- IPv6 card: about `863 x 292`.
- Card margin: `0.5em`.
- Cards share a row and grow to consume available width.

Implication for localClash:

Prefer a flex-wrapping card row for peer entities:

- Core runtime vs dashboard.
- Proxy mode vs router takeover.
- Config source vs rendered config.
- Subscription health cards.

Do not use this pattern for a long one-dimensional log or a settings form.

### Card header

Header structure:

```html
<div class="ifacebox-head center active">
  <strong>IPv4 上游</strong>
</div>
```

Relevant style:

```css
.ifacebox-head {
  padding: 0.25em;
  background: #eee;
  border-radius: 5px 5px 0 0;
}

.ifacebox-head.active {
  background: var(--primary);
  border-radius: 0.375rem 0.375rem 0 0;
}

.ifacebox-head.active * {
  color: var(--white);
}
```

Sampled active header:

- Height: about `27px`.
- Background: `var(--primary)`, sampled as `rgb(94, 114, 228)`.
- Text is white through `.ifacebox-head.active *`.
- Header is intentionally thin; it labels the card without becoming a banner.

Implication for localClash:

Use the active header color only for "healthy / active / enabled" cards. For warning, stopped, or degraded states, introduce explicit state classes rather than overloading `active`.

Suggested localClash state mapping:

```html
<div class="ifacebox-head center localclash-state-running">运行中</div>
<div class="ifacebox-head center localclash-state-warning">需要处理</div>
<div class="ifacebox-head center localclash-state-stopped">未运行</div>
```

Keep the same shape and density even when colors change.

### Card body

The body uses two vertical zones:

```html
<div class="ifacebox-body left">
  <span>primary key/value lines...</span>
  <div>badges...</div>
</div>
```

Relevant style:

```css
.network-status-table .ifacebox-body {
  display: flex;
  flex-direction: column;
  height: 100%;
  border-radius: 0 0 0.375rem 0.375rem;
}

.network-status-table .ifacebox-body > span {
  flex: 10 10 auto;
  height: 100%;
}

.network-status-table .ifacebox-body > div {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  height: 100%;
}
```

Sampled body metrics:

- Padding: `0.5em 0.87rem`.
- Line height: `1.6em`.
- Font size: about `15.6px`.
- Body uses `display:flex` with column direction.

Why it works:

- Primary facts stay as a readable vertical list.
- Secondary facts become badges at the bottom.
- The card stays stable when one card has more lines than another.

Implication for localClash:

Use body lines for facts that answer "what is true now?"

Examples:

- `核心: mihomo v...`
- `配置: generated/mihomo.yaml`
- `控制端口: 127.0.0.1:9090`
- `接管模式: router`
- `上次渲染: ...`

Use badges for attached entities or affordances:

- `MCP 已注册`
- `Dashboard 可访问`
- `TUN 已启用`
- `fwmark 路由存在`

### Key/value line style

The stock module uses repeated `span.nowrap` lines:

```html
<span class="nowrap"><strong>协议: </strong>PPPoE</span><br>
```

Relevant style:

```css
.nowrap:not(.td) {
  white-space: nowrap;
}
```

This is good for short labels and medium values. It is risky for long paths, URLs, IPv6 addresses, and error messages.

Implication for localClash:

Use `nowrap` selectively:

- Good: status labels, mode names, versions, short ports.
- Avoid: subscription URLs, long filesystem paths, rendered error messages, rule-provider names with long values.

For long values, prefer a local class with wrapping:

```css
.localclash-kv-value {
  overflow-wrap: anywhere;
  word-break: break-word;
}
```

### Badge row

Badge structure:

```html
<span class="ifacebadge">
  <img src="/luci-static/resources/icons/tunnel.png">
  <span>
    <span class="nowrap"><strong>设备: </strong>隧道接口: "pppoe-wan"</span><br>
  </span>
</span>
```

Relevant style:

```css
.ifacebadge {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  padding: 0.25rem 0.8rem;
  background: #eee;
  border-radius: 0.375rem;
}

.network-status-table .ifacebox-body .ifacebadge {
  align-items: center;
  flex: 1 1 auto;
  min-width: 220px;
  margin: 0.5em 0 0;
  padding: 0.5em;
  background-color: rgb(242, 244, 255);
}

.network-status-table .ifacebox-body .ifacebadge > span {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

Why it works:

- Badge background is lower contrast than the header.
- Badges are still prominent enough to separate "attached device/entity" from primary card facts.
- `min-width: 220px` prevents unreadably narrow badges.

Implication for localClash:

Badge-like elements are a good fit for things that are subordinate but operationally useful:

- Active interface.
- Generated config path.
- Running process PID.
- Last successful check.
- Current provider/source.

Avoid using badges as buttons unless they are styled and announced as buttons. The stock `ifacebadge` reads as passive status.

### Lower metric table

The module keeps a table row below the card row:

```html
<table class="table">
  <tr class="tr">
    <td class="td left" width="33%">活动连接</td>
    <td class="td left">
      <div class="cbi-progressbar" title="3129 / 65536 (4%)">
        <div style="width:4.00%"></div>
      </div>
    </td>
  </tr>
</table>
```

Relevant style:

```css
table,
.table {
  background-color: #fff;
  border-radius: 0.375rem;
  overflow-y: hidden;
  width: 100%;
  border-collapse: collapse;
}

.cbi-progressbar {
  position: relative;
  min-width: 190px;
  height: 22px;
  margin: 6px 0;
  background: #eee;
  border-radius: 12px;
  overflow: hidden;
}

.cbi-progressbar > div {
  height: 100%;
  transition: width 0.25s ease-in;
  background: var(--primary);
}

.cbi-progressbar::after {
  font-family: system-ui;
  font-size: 14px;
  position: absolute;
  inset: 3.55px 0 2px;
  content: attr(title);
  text-align: center;
  white-space: pre;
  text-overflow: ellipsis;
}
```

Why it works:

- Cards explain entities.
- Table rows explain scalar metrics.
- The progress bar gives an immediate visual cue while preserving exact text in `title`.

Implication for localClash:

Use this lower-row pattern for bounded scalar metrics:

- Memory or connection usage.
- Rule-provider update progress.
- Subscription freshness percentage only if the denominator is meaningful.
- Health-check success ratio.

Do not force unbounded state into progress bars. For example, "runtime running" should be a state label, not a 100% bar.

## Visual rhythm to preserve

Use this rhythm when adapting the pattern:

- Section title: 18px, bold, padded `1rem`.
- Card row: flex wrap, no internal grid required.
- Card margin: `0.5em`.
- Card header: compact, about one line high.
- Card body: `0.5em 0.87rem`, line-height `1.6em`.
- Primary facts: vertical key/value lines.
- Secondary facts: badge row at the bottom.
- Scalar metrics: native `.table` row plus `.cbi-progressbar`.

## Recommended localClash adaptation

For a future localClash overview/status module, start with this shape:

```html
<div class="cbi-section fade-in localclash-status">
  <h3>localClash</h3>
  <div>
    <div class="network-status-table localclash-status-cards">
      <div class="ifacebox">
        <div class="ifacebox-head center active">
          <strong>运行时</strong>
        </div>
        <div class="ifacebox-body left">
          <span>
            <span class="nowrap"><strong>状态: </strong>运行中</span><br>
            <span class="nowrap"><strong>核心: </strong>mihomo ...</span><br>
            <span class="nowrap"><strong>控制: </strong>127.0.0.1:9090</span><br>
          </span>
          <div>
            <span class="ifacebadge">
              <span><span class="nowrap"><strong>Dashboard: </strong>可访问</span></span>
            </span>
          </div>
        </div>
      </div>

      <div class="ifacebox">
        <div class="ifacebox-head center active">
          <strong>路由接管</strong>
        </div>
        <div class="ifacebox-body left">
          <span>
            <span class="nowrap"><strong>模式: </strong>router</span><br>
            <span class="nowrap"><strong>TUN: </strong>已启用</span><br>
            <span class="nowrap"><strong>策略路由: </strong>有效</span><br>
          </span>
          <div>
            <span class="ifacebadge">
              <span><span class="nowrap"><strong>fwmark: </strong>存在</span></span>
            </span>
          </div>
        </div>
      </div>
    </div>

    <table class="table">
      <tr class="tr">
        <td class="td left" width="33%">健康检查</td>
        <td class="td left">
          <div class="cbi-progressbar" title="3 / 4 checks passing">
            <div style="width:75%"></div>
          </div>
        </td>
      </tr>
    </table>
  </div>
</div>
```

## Implementation cautions

- Keep this as LuCI UI code in `localclash-luci`; do not move runtime logic or generated artifacts into the LuCI package.
- Preserve native LuCI classes where possible: `cbi-section`, `table`, `tr`, `td`, `cbi-progressbar`, `ifacebox`, `ifacebadge`.
- Add local classes only to scope localClash-specific state colors and wrapping rules.
- Avoid embedding secret-bearing values such as subscription URLs, raw tokens, or local intent JSON into visible status cards.
- Prefer explicit status states over hidden fallback behavior. If a value is unavailable, show `未知` or `未检测`, not a misleading default.

## Sampling artifacts

The live sample also produced temporary local artifacts outside source control:

- `/tmp/luci-network-module-sample.json`
- `/tmp/luci-overview-snapshot.txt`
- `/tmp/luci-network-overview-reference.png`

These are not part of the repo and should be regenerated when checking a different theme, viewport, language, or OpenWrt build.
