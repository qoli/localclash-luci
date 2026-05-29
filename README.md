# localclash-luci

`localclash-luci` 是 localClash 的 OpenWrt 后台页面。

照这个顺序做：

```text
下载安装包 -> 在 OpenWrt 后台上传安装 -> 打开 服务 -> localClash
-> 填写订阅 -> 开始初始化
```

![localClash LuCI overview running state](docs/assets/luci-overview-running.png)

## 1. 下载安装包

打开最新发布页：

[https://github.com/qoli/localclash-luci/releases/latest](https://github.com/qoli/localclash-luci/releases/latest)

进入页面后，找到 `Assets`（附件），下载一个安装包。

在最新发布页里，按你的 OpenWrt 版本选择文件：

| 你的 OpenWrt | 下载这个文件 |
| --- | --- |
| OpenWrt 24.10 或更旧 | 文件名以 `_all.ipk` 结尾的安装包 |
| OpenWrt 25.12 或更新 | 文件名以 `.apk` 结尾的安装包 |

大多数用户应该下载 `.ipk`。如果你的系统明确写着 OpenWrt 25.12 或更新版本，再下载 `.apk`。

不要下载 `.sha256` 文件。它不是安装包。

如果不知道 OpenWrt 版本：

1. 打开 OpenWrt 后台。
2. 进入 `状态 -> 概览`。
3. 查看 `固件版本` 或 `OpenWrt 版本`。

## 2. 在 OpenWrt 后台安装

1. 打开 OpenWrt 后台。
2. 进入 `系统 -> 软件包`。
3. 找到 `上传软件包` 或 `上传本地软件包`。
4. 选择刚下载的 `.ipk` 或 `.apk` 文件。
5. 点击上传。
6. 点击安装。
7. 安装完成后，刷新浏览器页面。
8. 在左侧菜单进入 `服务 -> localClash`。

如果左侧菜单还没有出现 localClash，先退出 OpenWrt 后台再重新登录。还不行就重启路由器。

## 3. 第一次使用

进入 `服务 -> localClash` 后，按这个顺序操作：

1. 如果页面提示等待订阅，在概览页填写订阅 URL。
2. 一行填写一个订阅 URL。
3. 按需要勾选 `使用 Smart 核心` 或 `使用 minimal 配置`。
4. 点击 `开始初始化`。
5. 等待任务完成。这里会下载 localClash 核心、Mihomo 和 Dashboard，保存并刷新订阅，生成配置，启动运行时并接管路由器流量。

初始化最后一步会影响整台路由器的网络。如果这台路由器正在用 OpenClash、PassWall 或其他插件维持上网，先不要急着初始化接管，先确认自己知道怎么恢复原来的插件。

## 4. 以后怎么更新

localClash 分成两部分：

- `localclash-luci`：OpenWrt 后台页面，也就是这里下载的 `.ipk` / `.apk`。
- `localClash` 核心：真正负责订阅、配置、Mihomo 和路由器接管。

只有这个仓库发布新的 LuCI 安装包时，才需要重新下载安装 `.ipk` 或 `.apk`。

如果只是 localClash 核心更新，通常不用重新安装 LuCI。进入 `服务 -> localClash`，点击更新核心或重新初始化即可。

## 5. 常见问题

安装后看不到菜单、提示核心缺失、初始化失败等问题，见 [常见问题](docs/faq.md)。

## 6. 支持项目

```text
＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝
＞＞＞　支持 localClash　＜＜＜

如果它帮你省了时间，也可以请作者喝杯咖啡。

▼ ▼ ▼ ▼ ▼ ▼ ▼ ▼ ▼ ▼ ▼ ▼ ▼ ▼ ▼ ▼ ▼ ▼ ▼
＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝
```

[【支持 localClash】](https://github.com/qoli/localClash/blob/main/SUPPORT.md)

## 7. 更多文档

- 产品边界：[docs/openwrt-luci.md](docs/openwrt-luci.md)
- 真机测试：[docs/real-router-safe-test.md](docs/real-router-safe-test.md)
- 发布流程：[docs/github-release-runbook.md](docs/github-release-runbook.md)

## 许可证

MIT License。见 [LICENSE](LICENSE)。
