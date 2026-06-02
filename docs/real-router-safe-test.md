# 真机路由器安全测试 Runbook

这份文档用于在真实 OpenWrt 路由器上测试 `luci-app-localclash` 和
`localClash`，同时避免破坏当前家庭网络。它记录的是当前项目开发期的安全
测试约束，不是面向普通用户的安装说明。

## 核心原则

真实路由器不是可破坏环境。只要当前网络仍依赖 OpenClash、PassWall 或其他
透明代理维持正常通信，就不能把 localClash 当成 Docker OpenWrt 一样测试。

默认真机测试只验证这些能力：

- ipk 安装后的 LuCI 页面、rpcd helper 和 ACL 是否存在。
- localClash core 是否能从 GitHub release manifest 下载、校验并安装。
- base assets、Mihomo core、dashboard 是否能被初始化。
- 订阅保存、订阅刷新、配置渲染、MCP 工具读写是否正常。
- 状态页是否 lazy load，操作是否有阶段性日志反馈。
- localClash 生成配置是否避开 OpenClash 正在使用的端口。
- 不启动网络接管的情况下，核心命令的性能和 CPU 行为是否可观察。

默认真机测试不执行这些操作：

- 不执行 `router_takeover_apply`。
- 不点击 LuCI 的“启动并网络接管”。
- 不在没有确认回退方案时执行 runtime start/restart/stop。
- 不修改 OpenClash、PassWall、主路由防火墙或 DNS 规则。
- 不用真机验证会中断全家网络的链路。

需要完整网络接管测试时，先使用 Docker OpenWrt 或 UTM OpenWrt。只有用户明
确确认“当前真机网络可以被 localClash 接管”，并且已经准备好 SSH 回退通道，
才允许在真机执行接管测试。

## 测试前基线

真机测试前应该先把路由器清理到“只剩 ipk 软件包安装”的状态。这个状态代表
LuCI 包还在，但 localClash core、runtime、订阅、MCP service wrapper 和临
时测试文件都不存在。

保留：

- `luci-app-localclash` opkg 包。
- opkg 管理的 LuCI view、menu、rpcd ACL、rpcd helper 和 MCP 帮助文本。

清理：

- `/root/localclash`
- `/root/localclash-runtime.yaml`
- `/usr/local/bin/localclash`
- `/etc/init.d/localclash-mcp`
- `/etc/rc.d/S*localclash-mcp`
- `/etc/rc.d/K*localclash-mcp`
- `/tmp/localclash*`
- `/tmp/lock/procd_localclash-mcp.lock`

不要清理：

- OpenClash 相关进程、配置、iptables/nftables 规则。
- 路由器当前负责联网的 DNS、DHCP、防火墙配置。
- 其他 LuCI 插件的文件。

## 清理命令

以下命令用于恢复测试基线。执行前确认 SSH 连接可用：

```sh
ssh root@192.168.6.1 '
set -eu

echo "== installed package =="
opkg list-installed | grep -i localclash || true

echo "== stop localClash MCP wrapper =="
if [ -x /etc/init.d/localclash-mcp ]; then
  /etc/init.d/localclash-mcp stop || true
  /etc/init.d/localclash-mcp disable || true
fi

echo "== remove non-package runtime files =="
rm -f /etc/init.d/localclash-mcp
rm -f /etc/rc.d/S*localclash-mcp /etc/rc.d/K*localclash-mcp
rm -rf /root/localclash
rm -f /root/localclash-runtime.yaml
rm -f /usr/local/bin/localclash
rm -rf /tmp/localclash*
rm -f /tmp/lock/procd_localclash-mcp.lock

echo "== remaining localClash paths =="
find /root /usr/local /etc /tmp -maxdepth 4 \
  \( -iname "*localclash*" -o -path "/root/localclash*" \) 2>/dev/null | sort

echo "== localClash or Mihomo processes =="
ps w | grep -E "localclash|mihomo" | grep -v grep || true
'
```

清理后必须重新确认 ipk 管理的文件仍然存在：

```sh
ssh root@192.168.6.1 '
opkg files luci-app-localclash
for p in \
  /www/luci-static/resources/view/localclash/overview.js \
  /www/luci-static/resources/view/localclash/subscription.js \
  /www/luci-static/resources/view/localclash/index.js \
  /usr/share/luci/menu.d/luci-app-localclash.json \
  /usr/share/rpcd/acl.d/luci-app-localclash.json \
  /usr/libexec/rpcd/localclash \
  /usr/share/localclash/mcp-help.txt
do
  [ -e "$p" ] && echo "OK $p" || echo "MISSING $p"
done
'
```

如果出现 `MISSING`，重新安装 ipk，不要继续测试。

## 推荐测试顺序

### 1. LuCI 页面打开测试

打开：

```text
http://192.168.6.1/cgi-bin/luci/admin/services/localclash
```

验收点：

- 页面能快速进入，不应该被 status 阻塞十几秒。
- 概览、订阅、进阶 Tab 都可切换。
- LuCI 默认的“保存并应用 / 保存 / 复位”按钮不应该污染 localClash 操作心智。
- 状态区可以后置加载，加载失败时要显示错误而不是卡住页面。

### 2. 初始化测试

在概览页执行“一键初始化”或在进阶页依次执行：

1. 安装 / 更新核心。
2. 确保 MCP 服务。
3. 更新 Mihomo。
4. 更新 Dashboard。
5. 应用默认配置。

验收点：

- 下载 core 必须来自 release manifest，并校验 sha256。
- 中国大陆网络下应优先探测可用 GitHub 镜像或给出可理解的失败日志。
- 操作期间必须有可见的阶段性反馈，不能长时间只显示“执行中”。
- 初始化生成的 localClash 端口必须和正在运行的 OpenClash 端口差异化。
- 成功后 `/usr/local/bin/localclash`、`/root/localclash` 和
  `/etc/init.d/localclash-mcp` 应该存在。
- MCP 服务默认应该启动，避免用户复制 MCP 指令后才发现服务不可用。

### 3. 订阅测试

订阅页只输入测试用订阅 URL。不要把真实订阅 URL 写入文档、commit 或截图。

验收点：

- 空白行会被忽略。
- 保存失败不能清空用户输入。
- 订阅历史必须持久保存，不允许只是临时 textarea。
- 多订阅 source id 由 core 自动生成短 hash，不要求 LuCI 或 MCP 传入 id。
- `subscriptions_refresh` 必须有阶段性日志，能看出 fetch、parse、artifact、
  impact 等阶段耗时。

### 4. 配置渲染测试

在不启动接管的前提下测试：

- 默认 patch set 是否应用。
- `generated/mihomo.yaml` 是否生成。
- localClash 监听端口是否避开 OpenClash 当前端口。
- `routing_explain` 是否能解释默认规则。
- Telegram、Steam、AI、ChatGPT、Bahamut、游戏平台等默认规则是否能被发现。

验收点：

- `localclash-default` 应通过 patch set manifest 生成最终配置。
- `generated/mihomo.yaml` 是唯一必须保留 YAML 的 Mihomo 输出文件。
- localClash 内部运行态应优先使用 JSON/GOB，避免 YAML runtime hot path。
- `mihomo -t` 只应该在 `config_patch_apply` 或 doctor 类诊断中执行，不应由
  `run_runtime` / `restart_runtime` 默认执行。
- 真机当前网络依赖 localClash 透明代理时，`mihomo -t` 不允许直接使用 live
  `.runtime/mihomo`。测试必须先建立临时隔离 workdir，只复制 `Model.bin`、
  geodata/mmdb 和 rule-provider 等验证必需 artifact，并跳过 `cache.db`、
  `mihomo.pid`、日志和 UI 目录。cache 不是配置验证目标，不能让验证进程争用
  live Smart core 正在持有的 DB。

### 4.1 已知 runtime status 观察项

2026-05-27 真机只读观察发现：Smart core 以相对路径启动：

```sh
bin/linux-arm64/mihomo-smart -d .runtime/mihomo -f generated/mihomo.yaml
```

进程 cwd 是 `/root/localclash`，并且仍持有
`/root/localclash/.runtime/mihomo/cache.db`。但 `localclash runtime status
--json` 可能把它报告为 `running:false` / `stale_pid_file:true`，理由是
“not using the configured runtime directory”。这很可能是状态检查用绝对
runtime dir 与进程命令列中的相对 `-d .runtime/mihomo` 做字串比对导致的误
判。

这项先记录为后续 core 修复项。只要当前网络依赖 localClash runtime，不得因
这个 status 误判而执行 runtime start/restart/stop；应使用 `/proc/$pid/cwd`、
`/proc/$pid/cmdline`、`/proc/$pid/fd` 和 `kill -0` 做只读确认。

### 4.2 OpenClash 端口差异化检查

真机测试常见风险不是只有网络接管，端口冲突也会破坏正在工作的 OpenClash。
如果 localClash 生成的 Mihomo 配置复用了 OpenClash 正在监听的端口，runtime
启动可能失败，也可能让用户误以为 localClash 规则或代理不可用。

在真机运行 localClash runtime 前，必须先采集 OpenClash 和系统监听端口：

```sh
ssh root@192.168.6.1 '
echo "== listening ports =="
netstat -lntup 2>/dev/null | grep -E "clash|mihomo|789|909|53|redir|tproxy" || true

echo "== openclash config ports =="
uci show openclash 2>/dev/null | grep -Ei "port|mixed|redir|tproxy|socks|http|controller|dashboard" || true

echo "== openclash processes =="
ps w | grep -Ei "openclash|clash|mihomo" | grep -v grep || true
'
```

然后检查 localClash 生成配置中的端口：

```sh
ssh root@192.168.6.1 '
cfg=/root/localclash/generated/mihomo.yaml
if [ -f "$cfg" ]; then
  grep -nE "^(mixed-port|port|socks-port|redir-port|tproxy-port|external-controller|dns:|  listen:)" "$cfg" || true
else
  echo "missing $cfg"
fi
'
```

验收要求：

- `mixed-port`、`port`、`socks-port` 不得复用 OpenClash 正在监听的代理端口。
- `redir-port`、`tproxy-port` 不得复用 OpenClash 正在监听的透明代理端口。
- `external-controller` 不得复用 OpenClash Dashboard/API 端口。
- DNS listen 端口不得覆盖当前负责联网的 dnsmasq/OpenClash DNS 链路。
- 如果发现冲突，先调整 localClash runtime profile 或生成配置，再启动 runtime。

每次真机测试应填写端口核对表：

| 类型 | OpenClash 当前端口 | localClash 生成端口 | 结果 |
| --- | --- | --- | --- |
| HTTP / mixed proxy |  |  |  |
| SOCKS proxy |  |  |  |
| redir proxy |  |  |  |
| tproxy |  |  |  |
| external controller |  |  |  |
| DNS listen |  |  |  |

如果任意一行结果是“冲突”，停止 runtime 测试。不要通过反复点击启动按钮观察
是否侥幸成功，因为端口冲突会让后续错误和真实规则问题混在一起。

当前网络仍由 OpenClash 管理时，端口差异化是 runtime 测试的前置条件，不是
失败后才排查的事项。

### 5. MCP 连接测试

LuCI 页面给用户复制的 MCP 引导应帮助 Agent 配置 MCP，而不是让 Agent 去本
地源码仓库猜项目结构。

推荐给 Agent 的指令形态：

```text
请把当前 Agent 会话连接到路由器上的 localClash MCP：
http://192.168.6.1:8765/mcp

Claude Code 可以先执行：
claude mcp add --transport http localclash http://192.168.6.1:8765/mcp

OpenCode 可以先执行交互式添加：
opencode mcp add

添加时选择 remote MCP server，名称填写 localclash，URL 填写：
http://192.168.6.1:8765/mcp

也可以手动在 opencode.json 中加入：
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "localclash": {
      "type": "remote",
      "url": "http://192.168.6.1:8765/mcp",
      "enabled": true
    }
  }
}

连接完成并刷新会话后，先调用 localClash tools_list，再调用
environment_inspect。之后根据 safety_level 决定是否只读检查、写配置，或
等待我确认后再执行运行时和网络接管操作。

不要把读取本机 /Volumes/Data/Github/localClash 源码当成连接路由器 MCP 的
替代方案。
```

真机默认只测试这些 MCP 能力：

- `tools_list`
- `environment_inspect`
- `routing_explain`
- `config_render`
- `config_patch_create`
- `config_patch_apply`，仅限不影响网络的 patch。
- `subscriptions_refresh`

需要谨慎或默认跳过：

- `run_runtime`
- `restart_runtime`
- `stop_runtime`
- `router_takeover_apply`
- `router_takeover_stop`

这些工具可能影响正在承载家庭网络的代理链路。只有用户明确授权时才能执行。

## 运行时测试边界

如果必须在真机测试 runtime，先确认：

- 当前网络不是依赖 localClash 维持通信。
- OpenClash 使用的 mixed/http/socks/redir/tproxy/controller/DNS 端口不会和
  localClash 生成配置冲突。
- SSH 通道不会因为 localClash 停止或接管失败而断开。
- 已准备好从 LuCI 或 SSH 恢复 OpenClash 的办法。

runtime 测试必须分段记录耗时：

```text
stop -> start -> status
```

`restart_runtime` 不应该让 Agent 等待一个超过 60s 的黑箱响应。执行类 MCP 工
具应该立即返回可读日志地址，Agent 再通过日志文件观察阶段进度。

需要关注的异常：

- “停止运行时”超过 30s 没有任何新反馈。
- `restart_runtime` 停掉 Mihomo 后没有进入 start。
- Mihomo 断开后只能靠 LuCI 手动启动恢复。
- `mihomo -t` 被重复执行，导致 restart 变慢。

## 网络接管测试边界

真机默认禁止网络接管测试。

如果用户明确授权真机接管测试，必须满足：

- 用户已经确认当前网络可以短暂中断。
- 已经记录当前 OpenClash 状态和恢复路径。
- 先在 Docker/UTM OpenWrt 中验证同一版本可完成接管和停止接管。
- 执行 `router_takeover_apply` 后必须预设超时回滚。
- 接管失败时必须执行停止接管流程，清理可能已经写入的部分规则。

失败处理顺序：

1. 停止 localClash-owned takeover。
2. 停止 localClash runtime。
3. 恢复 OpenClash。
4. 采集日志。
5. 不要重复点击接管按钮。

## 性能和日志采集

真机问题必须用日志和采样回答，不能靠猜测。尤其是 CPU 100% 问题，必须在
问题发生时采样，不能在移除 localClash 后再采样。

常用采集命令：

```sh
ssh root@192.168.6.1 '
echo "== processes =="
ps w | grep -E "localclash|mihomo|dnsmasq|openclash|clash" | grep -v grep || true

echo "== top =="
top -bn1 | head -60

echo "== mcp task logs =="
find /root/localclash/.runtime/mcp-tasks -maxdepth 1 -type f 2>/dev/null | sort | tail -20

echo "== localClash logs =="
find /root/localclash/.runtime/logs -maxdepth 1 -type f 2>/dev/null | sort

echo "== mihomo logs =="
ls -l /root/localclash/.runtime/mihomo/mihomo.log 2>/dev/null || true
tail -120 /root/localclash/.runtime/mihomo/mihomo.log 2>/dev/null || true
'
```

需要重点记录：

- localClash CPU 是否在 runtime 未使用时仍维持高占用。
- Mihomo warning 是否大量刷屏。
- Mihomo CPU 是否长期明显高于 OpenClash 的 Clash 进程。
- LuCI ubus 请求是否卡在 `takeover_status`、`mcp_help` 或其他 status 方法。
- `localconfig.Resolve`、pack index、subscription refresh、routing explain 等
  阶段耗时。

开发期可以开启更详细日志。正式发布默认应降低日志量，避免瘦客户端被日志和
频繁 status 拖慢。

## 失败时的安全回退

如果 LuCI 变慢、SSH 仍可用：

```sh
ssh root@192.168.6.1 '
if [ -x /etc/init.d/localclash-mcp ]; then
  /etc/init.d/localclash-mcp stop || true
fi
pkill -f "/root/localclash" || true
ps w | grep -E "localclash|mihomo" | grep -v grep || true
'
```

如果网络被 localClash 接管并且无法恢复：

1. 优先从 LuCI 恢复 OpenClash。
2. 如果 LuCI 可用，停止 localClash runtime 和 takeover。
3. 如果 LuCI 不可用，使用 SSH 清理 localClash runtime。
4. 如果 SSH 也不可用，使用路由器本地控制台或重启恢复。

回退后不要立即重试同一个操作。先采集日志，再决定是否转到 Docker/UTM
OpenWrt 复现。

## 验收结果记录

每次真机测试至少记录：

- 路由器型号和 OpenWrt 版本。
- 当前网络由谁接管：OpenClash、PassWall、localClash 或无透明代理。
- LuCI 包版本。
- localClash core release 版本。
- 是否从“只剩 ipk”基线开始。
- OpenClash 当前监听端口和 localClash 生成端口是否确认差异化。
- 初始化每一步是否成功。
- 订阅刷新耗时和日志路径。
- 配置渲染耗时和规则数量。
- MCP 工具测试结果。
- 是否执行 runtime 或 takeover。
- CPU 和日志异常。
- 最终网络是否恢复到预期管理方。

真机测试完成后，如果要让用户重新从零验证，重新执行“清理命令”，回到只保留
ipk 的状态。
