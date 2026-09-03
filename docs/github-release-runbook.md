# GitHub Release Runbook

本仓库使用 GitHub Actions 构建和发布 LuCI Release。Release tag 是唯一发布
入口；CI 不自动修改版本、不自动创建 tag，也不会覆盖已经公开的 Release。

## 发布产物

每个 Release 必须包含以下 13 个仓库自有产物：

- OpenWrt 24.10 及更早版本使用的 `.ipk` 和 SHA-256；
- OpenWrt 25.12 及更新版本使用的 `.apk` 和 SHA-256；
- Linux amd64、arm64 的 `dnsqualify`、SHA-256 和 Release manifest；
- iStoreOS x86_64、aarch64 离线 `.run` 和 SHA-256。

源码压缩包由 GitHub 自动生成，不计入上述 allow-list。

LuCI、Core 和 dnsqualify 是三个独立源码与 Release channel。普通 LuCI 安装包
不会内置 Core；iStore `.run` 是明确的离线 bundle，因此只使用
`release/core-release.json` 固定的 Core tag。LuCI Release 构建的 dnsqualify
二进制则只来自 `release/dnsqualify-source.json` 固定的公开仓库 commit。更新任一
source lock 不代表必须发布 LuCI，发布决定仍以 LuCI 变更为准。

## CI 分工

`.github/workflows/ci.yml` 在 pull request 和 `main` push 上执行：

1. JavaScript、rpcd shell、installer 和 Python 语法检查；
2. 全部 rpcd helper 测试；
3. 按 source lock 获取并验证 dnsqualify 的精确 commit，再执行 test 和 vet；
4. 构建 IPK、APK、dnsqualify 和两个 `.run`；
5. 验证精确资产集合、全部 SHA-256 和 Makeself 内容；
6. 上传保留 7 天的候选 Actions artifact，不创建 Release。

`.github/workflows/release.yml` 对 tag 重新执行同一套检查，全部成功后才创建
GitHub Release。已存在 Release、tag 与 Makefile 版本不一致、tag commit 不一致，
都会直接失败。

上述 CI/Release 自动检查只覆盖源码测试、构建和资产完整性，不执行也不替代
iStoreOS QEMU 功能验收。唯一功能发布门槛是 Core 维护的
[iStoreOS Release 测试 SOP](https://github.com/qoli/localClash/blob/main/docs/istoreos-release-test-sop.md)
（相邻仓库路径：`../localClash/docs/istoreos-release-test-sop.md`）。
Docker installer mock 测试已退役；Docker IPK/APK 构建与部署工具保留。
ARM 真机不是强制发布门槛，x86 QEMU 通过也不代表 ARM runtime 已验证。

Release 页面顶部的普通用户下载指南由
`scripts/generate-release-notes.py` 根据 tag 和 Makefile 包版本生成。指南直接列出
IPK、APK 及两个 iStoreOS 离线包的用途和下载链接；GitHub 自动生成的 changelog
保留在指南下方。不要在 workflow 里手写版本化资产 URL。

## 代理执行分工：独立 Kimi Reviewer 与 Luna High

改动影响面、测试条目、前置依赖、执行顺序及证据沿用，必须由独立 Pi CLI
环境中的 provider `kimi-coding`、model `k3-256k`（Kimi K3 256K）、thinking `max` Reviewer 判断。
按 [SOP 第 1.4 节](https://github.com/qoli/localClash/blob/main/docs/istoreos-release-test-sop.md#14-獨立-pi-clikimi-影響面審查與測試依賴計畫)
提供可追溯的客观资料包；不继承实现对话、项目／用户配置或 session，禁止工具
和分享。直接使用 CLI 发送 prompt、逐行接收 JSON，不引入 pi-ai SDK；只安全复用
Pi 登录中的 Kimi 凭证，保留失败的部分输出并核对完成事件。主代理及 Luna 不得
自审替代或自行改写选测结论；缺少资料交回 Reviewer，
改动或新证据影响测试计划时重新审查，不自动把针对性测试扩大为全部发布验收。

代理执行发布时，主代理负责用户授权范围、候选身份、资料包、协调、证据审核及最终放行；
**发布执行和测试任务必须交给 Luna High 子代理**，显式设置
`model: gpt-5.6-luna`、`reasoning_effort: high`，不得继承默认模型或改用 Luna Max。
测试包括下文的本地检查、构建验证、QEMU 验收、针对性回归及发布后验证；
不能只让子代理列计划，再由主代理代跑测试。

派单、执行者记录、资源隔离、原始证据及修复回写遵守
[SOP 第 1.3 节](https://github.com/qoli/localClash/blob/main/docs/istoreos-release-test-sop.md#13-luna-high-子代理執行契約)。
默认一个执行子代理顺序工作；只有可隔离的独立任务才由主代理拆分并行，
子代理不得继续派发，也不得共写同一 VM、端口、候选目录或验收总报告。
指定模型／effort 无法启动时报告执行缺口，不静默换模型或由主代理代跑。
已有有效证据可经适用性审核后沿用，保留原执行者，不要求因分工变化全部重跑。

推送、tag 和 Release 操作必须处于用户发布授权内，并在主代理审核对应关卡
后由执行子代理操作。主代理核对证据及文件回写，不以子代理的完成消息代替
G99。针对性测试仍按 SOP 第 1.1–1.2 节选测，不自动扩成完整发布验收。
本节不修改现有 CI runner，也不表示 GitHub Actions 已自动创建 Luna 子代理。
Reviewer 的 ready 只表示可派发测试，不代表发布通过；保留 review ID、输入 SHA、
原始回复、依赖计划及逐项执行结果，主代理按计划核对回写和 G99。

## 1. 准备版本提交

确认 `main` 是预期分支，工作树没有无关修改，并检查最近 Release：

```sh
git status --short --branch
gh auth status
gh release list --limit 5
```

修改 `openwrt/luci-app-localclash/Makefile` 的 `PKG_RELEASE`。版本映射必须是：

```text
PKG_VERSION:=0.1.0
PKG_RELEASE:=44
tag: v0.1.0-44
```

不得复用已有 tag 或覆盖旧 Release。

## 2. 更新离线 Bundle Core Pin

只有需要让新的 iStore 离线包携带不同 Core 时，才修改
`release/core-release.json`。必须填写精确 tag manifest URL 和该 manifest 的
SHA-256；禁止填写 `latest`、镜像地址或未校验 URL。

Core manifest 本身还必须严格声明相同 tag、官方仓库 URL、Linux amd64/arm64
资产和 base assets。`scripts/resolve-core-release.py` 会验证这些 invariant。

Makeself 同理由 `release/makeself-release.json` 固定版本、官方 Release URL 和
SHA-256。升级时必须在单独变更中验证两个架构的 `.run`。

## 2.1 更新 dnsqualify Source Pin

只有需要让 LuCI CI 与下一版 Release 使用不同 dnsqualify 源码时，才修改
`release/dnsqualify-source.json`。`repository` 和 `clone_url` 必须指向
`qoli/dnsqualify`，`commit` 必须是完整的 40 字符小写 Git SHA；禁止使用
`main`、tag、`latest` 或 LuCI 内嵌源码。

`scripts/prepare-dnsqualify-source.py` 会获取该 commit，并验证 checkout 的
origin、HEAD 与干净工作树。任何缺失或不一致都会直接失败。

## 3. 本地验证

常规开发至少运行聚焦测试：

```sh
python3 -m unittest scripts/test_generate_release_notes.py scripts/test_resolve_core_release.py scripts/test_prepare_dnsqualify_source.py

for file in openwrt/luci-app-localclash/htdocs/luci-static/resources/view/localclash/*.js; do
  node --check "$file"
done

sh -n openwrt/luci-app-localclash/root/usr/libexec/rpcd/localclash
sh -n packaging/istore/install.sh

for test_script in scripts/test-rpcd-*.sh scripts/test-hotplug-takeover-restore.sh; do
  bash "$test_script"
done

python3 scripts/prepare-dnsqualify-source.py
(cd .build/dnsqualify-source && go test ./... && go vet ./...)
```

需要本地构建完整候选产物时：

```sh
tag="$(awk -F':=' '/^PKG_VERSION:=/ { version=$2 } /^PKG_RELEASE:=/ { release=$2 } END { print "v" version "-" release }' openwrt/luci-app-localclash/Makefile)"
export SOURCE_DATE_EPOCH="$(git show -s --format=%ct HEAD)"
scripts/build-release-assets.sh "$tag"
```

构建脚本只接受与 Makefile 完全一致的 tag。`dist/` 和 `.build/` 是本地生成
目录，不得提交。

## 4. 提交并等待 Main CI

提交并推送源代码后，等待 `CI` workflow 成功。核对候选 artifact，而不是只看
单个 build step。失败必须在源代码或脚本中修复；不得从本机手工上传替代产物。

## 5. 人工通过 QEMU SOP，再创建并推送 Tag

推送 release tag 前，必须由 Luna High 子代理按上述 canonical SOP 执行 iStoreOS
QEMU 功能验收，主代理审核证据并由发布责任人放行；记录通过结果、对应源码
commit、候选产物及其校验值、执行子代理身份和证据位置。
CI 绿色、成功构建或 Makeself 校验通过都不能代替这项人工门槛；尚未通过时不得
推送 tag。验收后若源码或候选产物改变，必须对最终候选重新验收。

确认 QEMU SOP 已通过，再次核对 `main` commit、版本和 CI run 后创建 tag：

```sh
tag="v<PKG_VERSION>-<PKG_RELEASE>"
git tag "$tag"
git push origin "$tag"
```

推送 tag 会启动 `Release` workflow。CI 不会替用户执行这一步。

如需对已经存在但尚未公开 Release 的 tag 重跑，可从 Actions 手动运行
`Release` 并输入该 tag。workflow 始终 checkout 该 tag，不会改用 `main`。
手动重跑同样要求该 tag 对应的 QEMU SOP 验收已经通过。

## 6. 发布后验证

等待 workflow 成功后核对：

```sh
gh run list --workflow Release --limit 5
gh release view "$tag" --json tagName,isDraft,isPrerelease,assets,url
git ls-remote --tags origin "$tag"
```

必须确认：

- workflow 成功，Release 不是 draft 或 prerelease；
- tag 指向已审核的 commit；
- 自有资产数量和名称与 CI allow-list 完全一致；
- 每个 `.sha256` 都能校验对应产物；
- 两个 `.run` 通过 `--info`、`--list`、`--check` 和 `--noexec`；
- 核对发布产物与 QEMU 验收候选的对应关系，并保留验收证据；
- 按证据说明架构覆盖范围：x86 QEMU 通过不代表 ARM runtime 已验证。
  ARM 真机不是强制发布门槛；没有独立 ARM runtime 证据时，不得宣称已验证。

发布后如发现资产错误，增加 `PKG_RELEASE` 并发布新版本。不要 clobber、移动或
重新绑定已经公开的 tag。

## iStore 离线安装边界

iStore `.run` 是 Makeself 自解压 shell archive，只面向 iStoreOS/opkg，不替代
OpenWrt 25 的 APK。bundle 包含 LuCI IPK、固定 Core、对应架构 dnsqualify、Core
base assets、manifest 和 checksums。

installer 不运行 `opkg update`，不访问网络，也不选择 `latest`。它会在安装前
验证 root、必要系统命令、架构、全部 SHA-256 和基础文件完整性。任何条件不满足
都明确失败，不会改为在线下载。官方 policy/rule 文件采用逐文件原子更新，已有的
额外用户文件会保留。安装过程不会写入订阅、策略或网络接管状态。
