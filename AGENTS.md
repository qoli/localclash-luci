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

- `rtk sh -n openwrt/luci-app-localclash/root/usr/libexec/rpcd/localclash`
- `rtk bash -n scripts/test-rpcd-takeover-restore.sh`
- `rtk scripts/test-rpcd-takeover-restore.sh`
- `rtk scripts/build-openwrt-ipk.sh`
- `rtk scripts/build-openwrt-apk.sh`
