include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-localclash
PKG_VERSION:=0.1.0
PKG_RELEASE:=75
PKGARCH:=all
PKG_LICENSE:=MIT

LUCI_TITLE:=LuCI support for localClash
LUCI_DEPENDS:=+luci-base +rpcd +uclient-fetch +ca-bundle +jsonfilter +firewall4 +nftables +ip-full +kmod-tun +kmod-nft-tproxy

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
