# localclash-luci

[![Release](https://img.shields.io/github/v/release/qoli/localclash-luci?style=flat-square&label=release)](https://github.com/qoli/localclash-luci/releases/latest)
[![License](https://img.shields.io/github/license/qoli/localclash-luci?style=flat-square)](LICENSE)
[![OpenWrt](https://img.shields.io/badge/OpenWrt-LuCI-00B5E2?style=flat-square)](https://openwrt.org/)
[![Core](https://img.shields.io/badge/core-localClash-2563eb?style=flat-square)](https://github.com/qoli/localClash)

`localclash-luci` 是 localClash 的 OpenWrt 后台页面。你不用写命令，也不用手动配置 Mihomo，只要在 OpenWrt 后台上传安装包、填入订阅地址，然后等待初始化完成。

![localClash LuCI 欢迎页面](docs/assets/readme-welcome.png)

> [!TIP]
> ☕ localClash 是独立维护的开源项目。如果它帮你省了配置 Mihomo 和接管路由器网络的时间，欢迎支持项目继续维护。

责任划分：localClash Core 只负责 Mihomo 配置、验证、程序生命周期与
`runtime facts`；本项目的 OpenWrt manager 独立拥有 fw4/nft、policy routing、
DNS hijack、接管状态、boot/hotplug 恢复，以及 runtime/takeover transaction。
>
> [![支持 localClash](https://img.shields.io/badge/支持-localClash-f97316?style=for-the-badge)](https://github.com/qoli/localClash/blob/main/SUPPORT.md)
>
> [支持 localClash](https://github.com/qoli/localClash/blob/main/SUPPORT.md)

最简单的流程是：

```text
下载 LuCI 安装包 -> 上传到 OpenWrt -> 进入 服务 -> localClash
-> 填写订阅地址 -> 开始初始化 -> 看到“运行中”
```

## 适合谁

- 你有一台已经刷好 OpenWrt 的路由器。
- 你能打开 OpenWrt 后台，例如 `http://192.168.6.1` 或你自己的路由器地址。
- 你手上有一个订阅地址，或者有单独的节点 URI。
- 你想让 localClash 帮你管理 Mihomo、订阅、Dashboard 和路由器网络接管。

如果你还不知道“订阅地址”是什么，先向你的服务提供方确认。localClash 不提供订阅，也不提供节点。

## 第 1 步：下载安装包

打开最新发布页：

[https://github.com/qoli/localclash-luci/releases/latest](https://github.com/qoli/localclash-luci/releases/latest)

在页面下方找到 `Assets`，这里会列出可以下载的文件。

![在 GitHub Release 里选择安装包](docs/assets/readme-step-1-download.png)

图里的红色 `1` 标出来的是下载区域。你只需要在这里选一个适合自己路由器的安装包。

只需要下载一个安装包：

| 你的路由器系统 | 下载哪个文件 |
| --- | --- |
| OpenWrt 24.10 或更旧，后台软件包页面使用 `opkg` | 下载文件名以 `_all.ipk` 结尾的文件 |
| OpenWrt 25.12 或更新，后台软件包页面使用 `apk` | 下载文件名以 `.apk` 结尾的文件 |

大多数用户应该下载 `.ipk`。如果你不确定，就先看 OpenWrt 后台的软件包页面：页面上写着 `opkg` 就选 `.ipk`，写着 `apk` 就选 `.apk`。

不要下载这些文件：

- `.sha256`：这是校验文件，不是安装包。
- `Source code (zip)` / `Source code (tar.gz)`：这是源码，不是给路由器后台上传的安装包。

## 第 2 步：上传到 OpenWrt

打开 OpenWrt 后台，进入：

```text
系统 -> 软件包
```

![进入 OpenWrt 软件包页面](docs/assets/readme-step-2-install.png)

图里的红色 `1` 是左侧的 `软件包` 菜单。红色 `2` 附近是操作按钮区域，普通安装本地包时，点击旁边的 `上传软件包...` 即可，不需要修改 OPKG 配置。

按顺序操作：

1. 左侧菜单点 `系统`。
2. 点 `软件包`。
3. 点页面里的 `上传软件包...`。
4. 选择刚才下载的 `.ipk` 或 `.apk` 文件。
5. 上传后确认安装。
6. 安装完成后，刷新浏览器页面。

如果左侧菜单没有出现 `localClash`，先退出 OpenWrt 后台再重新登录。还是没有的话，重启一次路由器。

## 第 3 步：进入 localClash

安装完成后，在左侧菜单进入：

```text
服务 -> localClash
```

第一次进入时，通常会看到 Mihomo 核心缺失、订阅缺失、网络接管未生效。这是正常的，因为你还没有初始化。

## 第 4 步：填写订阅并初始化

在 `服务 -> localClash` 页面中，找到订阅输入框。

![填写订阅地址并开始初始化](docs/assets/readme-step-3-subscribe.png)

图里的红色 `1` 是订阅输入框。红色 `2` 是初始化按钮所在的位置。

按顺序操作：

1. 把你的订阅地址粘贴进去。
2. 如果有多个订阅或节点，每行放一个地址。
3. 一般用户可以先不勾选 `使用 Smart 核心` 和 `使用 minimal 配置`。
4. 点击 `开始初始化`。
5. 等待任务完成，不要中途刷新页面或断电。

初始化会自动做这些事：

- 下载或更新 localClash 核心。
- 下载 Mihomo 核心和 Dashboard。
- 保存并刷新订阅。
- 生成 Mihomo 配置。
- 启动运行时。
- 接管路由器网络。

这一步会影响整台路由器的上网。如果这台路由器正在依赖 OpenClash、PassWall 或其他插件维持网络，先确认你知道怎么切回原来的插件，再点 `开始初始化`。

## 第 5 步：确认已经成功

初始化完成后，回到 `概览` 页。看到下面这些状态，说明已经跑起来了：

- `Mihomo 核心` 显示 `运行中`。
- `网络接管` 显示 `已生效`。
- `订阅` 显示 `已配置`。
- 页面上有 `打开 Dashboard` 按钮。

![localClash 运行成功后的概览页](docs/assets/readme-welcome.png)

点击 `打开 Dashboard` 可以进入 Mihomo Dashboard，查看节点、连接和规则命中情况。

## 让 Agent 管理 localClash

概览页底部提供 `Agent Skill 与 MCP 接入`。点击 `复制 Skill + MCP 指令`，把完整内容发送给 Codex、Claude Code 或 OpenCode。

如果使用 Codex，建议同时安装 localClash 官方配套的 `localclash-mcp-route-operator` Skill。Skill 会引导 Agent：

- 先从配置意图、Mihomo 已加载状态、当前连接和限定时间日志收集证据。
- 为单一服务、应用或游戏建立专用策略出口，不随意覆盖“自动选择”等共享或默认策略组。
- Draft 一旦触及 shared/default group 就停止套用；只有你明确确认具体共享变更后，才允许继续。
- 把配置写入、运行时加载、服务重启和路由器网络接管视为不同授权。

Skill 与 MCP 缺一不可：Skill 约束 Agent 如何规划和操作，MCP 才是连接真实路由器、读取状态与执行已授权变更的通道。LuCI 提供的复制文本会同时引导这两步，并自动带入当前路由器的 MCP 地址。

## 以后怎么更新

localClash 现在提供 `一键更新`：更新 LuCI 界面、localClash 核心、Mihomo 核心和 Dashboard，并自动刷新已保存订阅、重建配置，最后恢复运行时和网络接管。

日常更新时，先进入：

```text
服务 -> localClash
```

在 `概览` 页点击 `一键更新`。更新准备阶段会尽量保持当前运行时继续工作；只有最后切换 Mihomo 运行时并恢复接管时，可能会短暂断网。

一键更新采用两阶段交接：LuCI 安装包发生更新时，旧 helper 会先保存任务快照，再以同一个任务 PID 重新执行磁盘上的新版 helper；新版 helper 校验任务锁、状态版本和执行阶段后，才继续更新 localClash 核心。LuCI Release 信息、checksum 和安装包下载／校验遇到临时失败时，每个阶段最多尝试 3 次（首次尝试加 2 次自动重试）；下载器只有在退出码为 0、输出文件存在且非空、临时文件原子提交成功时才算完成，watchdog 主动终止的下载会明确记录为超时并进入既有重试／镜像候选流程。checksum 文件还必须包含完整的 64 位十六进制 sha256。套件安装和服务操作失败仍会明确停止，不会盲目重跑。localClash 核心完成原子替换后，流程立即执行 `/etc/init.d/localclash-mcp restart`，再更新基础资源，并在限定次数内同时确认 procd 的 `mcp` instance 正在运行和 MCP 健康检查通过。这里不会用 PID、进程名称或运行中二进制的 sha256 来猜测是否需要重启；服务脚本写入、重启或 readiness 检查失败时，任务都会明确失败并停止后续步骤。

独立执行 LuCI 更新时，package `postinst` 不负责 localClash 进程生命周期；更新任务会主动调用磁盘上的新版 helper 重启 `localclash-mcp`。一键更新则由交接后的新版 helper 在核心替换后执行唯一一次权威重启，避免 package 安装阶段先重启旧核心。

如果当前 LuCI 版本还不包含上述 helper 交接机制，第一次升级请先在 `高级组件维护` 中执行 `检查 LuCI 更新`，等待后台任务完成并刷新页面，然后再执行 `一键更新`。从新版开始，后续一键更新会自动完成交接。

`同步最新默认策略（推荐）` 默认勾选，会以最新 localClash 内置默认策略完全覆盖本地策略补丁，包括用户自定义策略；这是一次明确的策略重置，不会因同名规则冲突而中断。取消勾选后，LuCI 会保留当前本地策略，并把选择保存到路由器的 localClash 工作目录，下次打开页面和执行一键更新时会沿用上次选择。

如果订阅源临时不可用，`一键更新` 会使用已保存的订阅缓存继续完成配置生成和验证；缓存不可用或配置验证失败时仍会停止，不会继续切换运行时。

如果要单独维护某个组件，可以使用 `高级组件维护`：

- 点 `安装 / 更新核心`：安装或刷新 localClash 核心和基础文件。
- 点 `更新 localClash`：更新 localClash 运行时程序。
- 点 `更新 Mihomo`：更新 Mihomo 核心。
- 点 `更新 Dashboard`：更新 Dashboard 面板文件。

如果只是更新这些组件，通常不需要重新下载 `.ipk` 或 `.apk`。只有页面里的 `检查更新` 不可用，或者你需要手动安装指定版本时，才回到 GitHub Release 重新下载 LuCI 安装包。

重新初始化主要用于重新应用默认配置、刷新订阅并重新启动运行时。只是普通更新时，不需要反复点击 `开始初始化`。

## DNS 默认选择与最佳化

进阶页会显示当前有效 DNS 来源，并提供独立的最佳化流程：

- Core 默认不采用 WAN 下发的 DNS，也不会把多组 resolver 注入
  `nameserver-policy`。普通解析使用 AliDNS DoH；主查询失败、没有 IP，或结果
  命中明确的 bogon/reserved CIDR 时，才按 lazy fallback 使用经代理的
  Google DoH。
- `dnsqualify` 是由 LuCI Release 提供和校验安装的独立二进制，不属于
  localClash Core，也不会定时或自动运行。
- LuCI CI 只从 `release/dnsqualify-source.json` 固定的
  [`qoli/dnsqualify`](https://github.com/qoli/dnsqualify) commit 构建该二进制，
  不使用浮动分支或仓库内嵌源码。
- 只有用户按下 `运行 dnsqualify` 时，LuCI 才会取得 WAN L3 device 并启动测试。
  独立程序按固定顺序尝试绑定该 device 的中国大陆 Bilibili STUN、
  `api.ipapi.is` HTTPS JSON；任一成功即停止，JSON
  路径严格要求 `country code == CN`。需要 Token 或文字解析的端点不纳入。
  `network.interface.wan` 的接口地址与海外 STUN 不作为公网身份。程序再测试
  Google DoH + WAN ECS 的 DNS 答案、网站连通性和知名服务 CDN 速度，输出
  v2 `dnsqualify.json` nameserver-policy overlay，并另存完整测试与选择报告。
- Core 不理解测试报告、候选评分、STUN、HTTP provider、WAN 或 country code；
  它只检查 overlay 版本与过期时间、拒绝覆盖既有 policy，并把完整生成结果交给
  `mihomo -t`。LuCI 只从独立报告显示候选和公网观测 provenance。
- 证据正常到期时，LuCI 会明确显示最佳化已停用，Core 继续生成加密 DNS 基线；
  overlay 格式损坏或 policy 冲突仍然阻塞渲染；report 缺失只影响 LuCI 的诊断
  详情，不会让 LuCI 代替 dnsqualify 重新判断 qualification。
- dnsqualify 会在测量前后重复同一个已选公网观测方法；地址或 endpoint IP
  变化会拒绝输出。LuCI 也会再次确认 WAN device；变化时恢复旧配置。证据 30
  分钟后过期。
- 当前 LuCI 流程明确要求 WAN IPv4，并生成 `/24` ECS；没有 IPv4 时直接失败，
  不会静默改用 IPv6。dnsqualify CLI 已能验证 IPv6 并生成 `/56`，但 LuCI 的
  IPv6 来源选择仍需独立设计和测试。
- `删除 dnsqualify 配置` 会回到 Core 加密 DNS 基线。
- 节点域名解析不会被这项最佳化修改；生效前仍需由用户明确重启 Mihomo。
- LuCI 一键更新会按路由器架构更新 `dnsqualify`；如果程序尚未安装，首次按下
  `运行 dnsqualify` 也会从同一 LuCI Release 安装并验证 SHA-256。

## 常见问题

### 安装后看不到菜单

先刷新浏览器页面。如果还看不到，退出 OpenWrt 后台并重新登录。仍然没有的话，重启路由器。

### 点初始化前要不要先关掉 OpenClash 或 PassWall

建议先关闭 OpenClash、PassWall 或其他会接管路由器网络的代理插件，再开始 localClash 初始化。这样可以避免多个插件同时修改防火墙、DNS 或透明代理规则，确保 localClash 能正常接管网络。

### 订阅地址填在哪里

填在 `服务 -> localClash` 页面里的大输入框中。每行一个订阅 URI 或节点 URI。

### `.sha256` 要不要下载

不要。普通用户只需要下载 `.ipk` 或 `.apk` 安装包。

更多问题见 [常见问题](docs/faq.md)。

## 支持 localClash

如果 localClash 帮你省了配置 Mihomo 和接管路由器网络的时间，可以请作者喝杯咖啡，支持项目继续维护：

[![支持 localClash](https://img.shields.io/badge/支持-localClash-f97316?style=for-the-badge)](https://github.com/qoli/localClash/blob/main/SUPPORT.md)

[支持 localClash](https://github.com/qoli/localClash/blob/main/SUPPORT.md)

## 更多文档

- 产品边界：[docs/openwrt-luci.md](docs/openwrt-luci.md)
- ucode 改写提案：[docs/ucode-rewrite-adaptation.md](docs/ucode-rewrite-adaptation.md)
- 真机测试：[docs/real-router-safe-test.md](docs/real-router-safe-test.md)
- 发布流程：[docs/github-release-runbook.md](docs/github-release-runbook.md)

## 许可证

MIT License。见 [LICENSE](LICENSE)。
