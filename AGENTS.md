# Repository Guidelines

## 项目关系

本仓库负责 localClash 的 OpenWrt LuCI 包装层：LuCI 视图、rpcd ACL、
OpenWrt 包元数据、helper 脚本、init 集成，以及面向路由器用户的 UI 行为。

`/Volumes/Data/Github/localClash` 是相邻的核心仓库。runtime 逻辑、产品级
CLI/MCP API、生成的运行时资产、Mihomo 生命周期和配置渲染都应保留在核心仓库。
LuCI 应调用这些产品接口，不要复制 runtime 逻辑。

## 表达语言

LuCI 面向用户的表达语言维持为简体中文。

以下内容使用简体中文：

- LuCI UI 标签、描述、按钮文本、状态文本和弹窗摘要。
- rpcd helper 消息和用户可见的 JSON summary。
- 新增到本 LuCI 仓库的文档。

除非用户明确要求繁体中文版本，不要在 LuCI 面向用户的文本中引入繁体中文。

## 开发注意事项

优先沿用当前应用已经使用的直接 rpcd action 模式。这个 LuCI surface 不是传统
表单加应用的工作流；runtime、接管、恢复和维护控制都是直接操作按钮。

交付前，对改动过的 surface 运行聚焦的语法和打包检查，例如：

- `sh -n openwrt/luci-app-localclash/root/usr/libexec/rpcd/localclash`
- `bash -n scripts/test-rpcd-takeover-restore.sh`
- `scripts/test-rpcd-takeover-restore.sh`
- `scripts/build-openwrt-ipk.sh`
- `scripts/build-openwrt-apk.sh`

## 功能测试与发布选测

从相邻 Core 仓库的 `docs/istoreos-test-features.md` 和
[测试 Skill](https://github.com/qoli/localClash/blob/main/.codex/skills/localclash-istoreos-test/SKILL.md) 开始：维护每个功能最后实际测试版本、结果和证据，
按变更影响选择回归，核对后沿用未受影响功能的历史结果。发布不自动触发全表重测。

## 集成约束

先在 Core 核对版本化 runtime facts 契约及发布兼容性，再修改 LuCI。fw4/nft、
策略路由、DNS hijack、desired state、ownership marker、boot/hotplug 及跨模块事务归 LuCI；
不得把这些执行器移进 Core，或用未协调的 `effective=false` 轮询覆盖用户明确停止。
同 boot 修复只依本次启动的拥有证据；跨 reboot 自动恢复是单独、明确的持久设置。
手动停止应清除本次启动的修复意图，不得偷偷启用或改写开机恢复策略。

普通 IPK/APK 只安装静态包文件；postinst 不下载 Core、不创建运行时资产、不管理 MCP
生命周期。下载、service ensure/restart 与任务交接由显式 helper 操作负责。
UI 通过窄 rpcd action 调用正式产品接口，不执行任意 shell、不编辑生成 YAML，
不扩成第二套配置模型或完整规则／群组编辑器。网站分流是受限例外。
保存后不回显订阅秘密；各变更入口读回实际状态，不以 task 完成代替网络结果。

DNS ingress 租约、loopback 本地回查 bypass 与 dnsmasq 上游保持各自职责：
LAN 查询不能仅因目标是路由器地址就绕过接管；不得删除 Mihomo 回查 dnsmasq 的
loopback bypass。避免持久覆盖用户 fw4 配置，清理仅处理本模块拥有的规则和 marker。

发布操作按 Core 的
[发布 Skill](https://github.com/qoli/localClash/blob/main/.codex/skills/localclash-release-broadcast/SKILL.md)
执行；源码、schema 和 workflow 保持实现事实，README 维护用户入口。
