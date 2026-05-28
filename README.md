# localclash-luci

`localclash-luci` 是 localClash 在 OpenWrt / LuCI 裡的圖形介面套件。

你可以把它理解成「先把 localClash 的入口裝到 OpenWrt 裡」，然後再透過
LuCI 介面下載 localClash 核心、Mihomo、Dashboard，填入訂閱，最後啟動代理
與路由器接管。

![localClash LuCI overview running state](docs/assets/luci-overview-running.png)

## 先看懂這個套件做什麼

這個倉庫只發布 OpenWrt 的 LuCI 套件：

- LuCI 頁面，也就是 OpenWrt 後台裡 `Services -> localClash` 的畫面。
- rpcd 權限與 helper，讓 LuCI 可以在路由器上執行 localClash 相關操作。
- OpenWrt 套件資訊，包含 `.ipk` 和 `.apk` 兩種格式。

它不直接打包：

- localClash Go 核心。
- Mihomo 核心。
- Dashboard 靜態資源。
- 你的訂閱 URL。
- 生成後的 Mihomo 設定與 runtime 狀態。

所以第一次安裝完 OpenWrt 套件後，看到「localClash 核心缺失」是正常的。下一步是在 LuCI 頁面點 `一键初始化`，讓它從 localClash release manifest 下載並校驗真正的核心與資源。

完整的產品邊界見 [docs/openwrt-luci.md](docs/openwrt-luci.md)。

## 一般使用者：從 GitHub Release 下載

下載入口有兩種：

- 直接打開 [最新 GitHub Release](https://github.com/qoli/localclash-luci/releases/latest)。
- 或打開 [GitHub 倉庫首頁](https://github.com/qoli/localclash-luci)，在右側找到 `Releases`，點進最新版本。

進入 Release 頁面後，往下找 `Assets`。如果資產列表被折疊，先點開它。

目前最新 LuCI 套件版本是 `v0.1.0-14`，發布時間是 2026-05-28。請下載和你 OpenWrt 套件管理器相符的檔案：

| 你的 OpenWrt 環境 | 下載檔案 | 安裝工具 |
| --- | --- | --- |
| OpenWrt 24.10 或更舊版本 | `luci-app-localclash_0.1.0-14_all.ipk` | `opkg` |
| OpenWrt 25.12 或更新版本 | `luci-app-localclash-0.1.0-r14.apk` | `apk` |

旁邊的 `.sha256` 檔是校驗用的，不是拿來安裝的套件。你不確定該下載哪一個時，先進 OpenWrt 後台看版本：

1. 登入路由器 LuCI 後台。
2. 打開 `Status -> Overview`。
3. 找 `Firmware Version` 或 `OpenWrt Version`。

也可以 SSH 進路由器確認：

```sh
cat /etc/openwrt_release
command -v opkg || command -v apk
```

如果輸出裡有 `opkg`，就用 `.ipk`；如果是 `apk`，就用 `.apk`。

## 安裝前先做三件事

1. 確認你知道路由器管理地址，例如 `192.168.1.1` 或 `192.168.6.1`。
2. 確認你能登入 LuCI，最好也能 SSH 登入 `root@路由器IP`。
3. 如果這台是家裡正在使用的主路由，先到 `System -> Backup / Flash Firmware` 下載一份設定備份。

如果你正在使用 OpenClash、PassWall 或其他透明代理，不要一開始就點網路接管。先完成安裝、初始化、訂閱與狀態檢查，再決定是否接管整台路由器流量。

## 安裝方式一：用 LuCI 上傳套件

適合不熟 SSH 的使用者。

1. 登入 OpenWrt 後台。
2. 打開 `System -> Software`。
3. 找到 `Upload Package...` 或類似的上傳套件入口。
4. 選擇剛下載的 `.ipk` 或 `.apk` 檔。
5. 上傳後點安裝。
6. 安裝完成後，重新整理瀏覽器頁面。
7. 從側邊選單打開 `Services -> localClash`。

如果安裝後沒有看到 `localClash` 選單，先登出再登入 LuCI，或 SSH 到路由器執行：

```sh
/etc/init.d/rpcd restart
```

## 安裝方式二：用 SSH 安裝

把下面的 `192.168.1.1` 換成你的路由器 IP。

OpenWrt 24.10 或更舊版本使用 `.ipk`：

```sh
scp luci-app-localclash_0.1.0-14_all.ipk root@192.168.1.1:/tmp/
ssh root@192.168.1.1
opkg install --force-reinstall /tmp/luci-app-localclash_0.1.0-14_all.ipk
```

OpenWrt 25.12 或更新版本使用 `.apk`：

```sh
scp luci-app-localclash-0.1.0-r14.apk root@192.168.1.1:/tmp/
ssh root@192.168.1.1
apk --allow-untrusted --force-overwrite add --upgrade /tmp/luci-app-localclash-0.1.0-r14.apk
```

安裝後打開：

```text
http://路由器IP/cgi-bin/luci/admin/services/localclash
```

例如：

```text
http://192.168.1.1/cgi-bin/luci/admin/services/localclash
```

## 第一次使用順序

第一次不要急著改進階設定，按這個順序走：

1. 打開 `Services -> localClash`。
2. 等頁面完成狀態檢查。
3. 如果看到初始化未完成，點 `一键初始化`。
4. 等任務視窗顯示完成。這一步會下載或更新 localClash 核心、基礎檔案、Mihomo 核心和 Dashboard，並確保 MCP 服務可用。
5. 如果頁面提示等待訂閱，點 `填写订阅`。
6. 在訂閱頁面裡一行貼一個訂閱 URL。
7. 點 `保存并应用订阅`，等待任務完成。
8. 回到概覽頁，確認 localClash 核心、Mihomo 核心、Dashboard 和訂閱都不是缺失狀態。
9. 確認你真的要讓 localClash 接管路由器流量後，再點 `启动运行时并接管路由器流量`。
10. 成功後狀態應顯示 `运行中`，並能看到網路接管狀態。

第 9 步是會影響整台路由器流量的操作。如果這台路由器正靠 OpenClash 或 PassWall 讓全家上網，先不要點，先閱讀 [真機安全測試 Runbook](docs/real-router-safe-test.md)。

## 日常更新該怎麼做

localClash 有兩條更新線：

- `localclash-luci`：OpenWrt 後台介面套件，也就是這個倉庫發布的 `.ipk` / `.apk`。
- `localClash` 核心：真正處理訂閱、配置渲染、Mihomo runtime、MCP 和路由器接管的核心。

只有 GitHub Release 發布新的 `luci-app-localclash` 套件時，才需要重新下載並安裝 `.ipk` 或 `.apk`。

如果只是 localClash 核心有新版本，通常不需要重裝 LuCI 套件。到 `Services -> localClash` 裡使用更新核心或初始化相關按鈕即可。LuCI helper 會讀取核心 release manifest，選擇符合路由器架構的檔案，校驗 sha256 後安裝。

## 常見問題

### 安裝完為什麼還說核心缺失？

正常。OpenWrt 套件只安裝 LuCI 入口和 helper，不內建 localClash Go 核心。請進 `Services -> localClash` 點 `一键初始化`。

### `.ipk` 和 `.apk` 要兩個都裝嗎？

不要。只選一個。`opkg` 系統裝 `.ipk`，`apk` 系統裝 `.apk`。

### `.sha256` 要怎麼用？

它用來比對下載檔案是否完整。最簡單的做法是打開 `.sha256` 檔，把裡面的長字串和本機計算結果對起來：

```sh
shasum -a 256 luci-app-localclash_0.1.0-14_all.ipk
shasum -a 256 luci-app-localclash-0.1.0-r14.apk
```

你只需要校驗自己下載的那個套件。

### 一鍵初始化失敗怎麼辦？

先看任務視窗裡的日誌。常見原因是路由器無法連到 GitHub、DNS 不通、時間不準導致 HTTPS 驗證失敗，或目前網路需要先透過現有代理才能出國。

如果只是 LuCI 頁面卡住，SSH 仍可用，可以先重啟 rpcd：

```sh
/etc/init.d/rpcd restart
```

### 訂閱 URL 會不會被顯示出來？

訂閱 URL 是敏感資訊。頁面用於輸入和保存訂閱，但不應該把真實訂閱 URL 寫進 issue、文檔、截圖或 commit。

### 我想讓 Agent 連路由器上的 MCP，從哪裡複製？

打開 `Services -> localClash`，概覽或進階頁會提供 MCP 連線引導。照畫面裡的 endpoint 複製給 Agent，不要讓 Agent 讀本機源碼倉庫來代替連真實路由器 MCP。

## 開發者：本地構建套件

本倉庫目前同時構建兩種 OpenWrt 套件格式：

```sh
./scripts/build-openwrt-ipk.sh
./scripts/build-openwrt-apk.sh
```

產物會放在 `dist/`：

```text
dist/luci-app-localclash_<version>-<release>_all.ipk
dist/luci-app-localclash-<version>-r<release>.apk
```

部署到測試路由器：

```sh
OPENWRT_TARGET=root@192.168.1.1 ./scripts/deploy-openwrt-ipk.sh
OPENWRT_TARGET=root@192.168.1.1 ./scripts/deploy-openwrt-apk.sh
```

真機測試前先讀 [docs/real-router-safe-test.md](docs/real-router-safe-test.md)。它把 package 安裝、初始化、訂閱、runtime、MCP、網路接管分成不同階段，避免在家用主路由上誤傷現有 OpenClash / PassWall 網路。

## 發布邊界

LuCI 套件和 localClash 核心是分開發布的。

- 修改 LuCI 頁面、rpcd helper、ACL、menu、OpenWrt 套件 metadata 或打包腳本時，才需要發布新的 `localclash-luci` release。
- 只有 localClash 核心更新時，不需要發布新的 LuCI 套件。
- 公開 release 必須同時上傳 `.ipk`、`.ipk.sha256`、`.apk`、`.apk.sha256`，並清楚標註 OpenWrt 24.x / 25.x 的差異。

實際發布流程見 [docs/github-release-runbook.md](docs/github-release-runbook.md)。

## 套件結構

OpenWrt 套件內容位於：

```text
openwrt/luci-app-localclash/
```

主要包含：

- `htdocs/`：LuCI 前端頁面。
- `root/usr/libexec/rpcd/localclash`：LuCI helper。
- `root/usr/share/rpcd/acl.d/`：rpcd ACL。
- `root/usr/share/luci/menu.d/`：LuCI 選單。
- `root/usr/share/localclash/mcp-help.txt`：MCP 連線引導文字。

`bootstrap_core` 預設讀取：

```text
https://github.com/qoli/localClash/releases/latest/download/localclash-release-manifest.json
```

測試或替代 release channel 可以用 `LOCALCLASH_RELEASE_MANIFEST` 覆蓋。

## 支持

localclash-luci 沿用 localClash 核心專案的自願支持方式：

[Support localClash](https://github.com/qoli/localClash/blob/main/SUPPORT.md)

## 授權

localclash-luci 使用 MIT License。見 [LICENSE](LICENSE)。
