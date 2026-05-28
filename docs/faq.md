# 常见问题

## 安装后为什么提示 localClash 核心缺失？

正常。这个安装包只安装 OpenWrt 后台页面。

进入 `服务 -> localClash`，点击 `一键初始化` 后，才会下载真正的 localClash 核心、Mihomo 和 Dashboard。

## `.ipk` 和 `.apk` 要都安装吗？

不要。只安装一个。

大多数 OpenWrt 用户安装 `.ipk`。只有 OpenWrt 25.12 或更新版本才安装 `.apk`。

## 安装后看不到 localClash 菜单怎么办？

按顺序试：

1. 刷新浏览器页面。
2. 退出 OpenWrt 后台，再重新登录。
3. 重启路由器。
4. 再进入 `服务 -> localClash`。

## 一键初始化失败怎么办？

先看任务窗口里的日志。

常见原因：

- 路由器连不上 GitHub。
- 路由器的 DNS 不通。
- 路由器时间不准，HTTPS 校验失败。
- 当前网络需要先通过现有代理才能访问 GitHub。

## 可以让 Agent 直接读本地源码吗？

不要。

如果要让 Agent 管理路由器上的 localClash，请在 LuCI 页面里复制 MCP 连接提示，让 Agent 连接真实路由器 MCP。
