#!/usr/bin/env python3
"""Generate the beginner-facing download guide for a LuCI GitHub Release."""

from __future__ import annotations

import argparse
import re
from pathlib import Path


REPOSITORY = "qoli/localclash-luci"


def package_version(makefile: Path) -> tuple[str, str]:
    text = makefile.read_text(encoding="utf-8")
    version_match = re.search(r"^PKG_VERSION:=(.+)$", text, re.MULTILINE)
    release_match = re.search(r"^PKG_RELEASE:=(.+)$", text, re.MULTILINE)
    if not version_match or not release_match:
        raise ValueError("package Makefile must define PKG_VERSION and PKG_RELEASE")
    return version_match.group(1).strip(), release_match.group(1).strip()


def render(release_tag: str, repo_root: Path) -> str:
    version, release = package_version(
        repo_root / "openwrt/luci-app-localclash/Makefile"
    )
    expected_tag = f"v{version}-{release}"
    if release_tag != expected_tag:
        raise ValueError(
            f"release tag {release_tag} does not match package metadata {expected_tag}"
        )

    base_url = f"https://github.com/{REPOSITORY}/releases/download/{release_tag}"
    ipk_name = f"luci-app-localclash_{version}-{release}_all.ipk"
    apk_name = f"luci-app-localclash-{version}-r{release}.apk"
    x86_run_name = f"localclash-istore-{release_tag}-x86_64.run"
    arm_run_name = f"localclash-istore-{release_tag}-aarch64.run"

    return f"""## 下载（普通用户看这里）

**只需要下载一个与你的路由器系统匹配的安装文件。**

### OpenWrt 后台上传安装（大多数用户）

- **OpenWrt 24.10 或更旧，软件包页面显示 `opkg`：** [下载 `.ipk` 安装包]({base_url}/{ipk_name})
- **OpenWrt 25.12 或更新，软件包页面显示 `apk`：** [下载 `.apk` 安装包]({base_url}/{apk_name})

如果不确定，请先打开 OpenWrt 后台的“系统 → 软件包”：页面显示 `opkg` 就选 `.ipk`，显示 `apk` 就选 `.apk`。大多数用户使用 `.ipk`。

### iStoreOS 离线整合安装包

离线包包含 LuCI、Core 和初始化所需的基础组件，**只适用于 iStoreOS/opkg**：

- **x86_64 路由器：** [下载 x86_64 `.run` 离线包]({base_url}/{x86_run_name})
- **ARM64／aarch64 路由器：** [下载 ARM64 `.run` 离线包]({base_url}/{arm_run_name})

不确定架构时，在路由器终端执行 `uname -m`。不要在使用 `apk` 的 OpenWrt 上安装这个 `.run` 文件。

### 这些文件普通用户不需要下载

- `.sha256`、`dnsqualify-*` 和 `*-manifest.json`：用于完整性校验或由 localClash 自动使用。
- `Source code (zip)` / `Source code (tar.gz)`：项目源码，不是安装包。

[查看完整安装教程](https://github.com/{REPOSITORY}#第-1-步下载安装包)
"""


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("release_tag")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    notes = render(args.release_tag, repo_root)
    args.output.write_text(notes, encoding="utf-8")


if __name__ == "__main__":
    main()
