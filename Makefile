include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-ap-monitor
PKG_VERSION:=1.6.1
PKG_RELEASE:=1
PKG_BUILD_DEPENDS:=luci-base/host

include $(INCLUDE_DIR)/package.mk

define Package/luci-app-ap-monitor
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=AP status monitor for LuCI
  PKGARCH:=all
  DEPENDS:=+luci-base +python3
endef

define Package/luci-app-ap-monitor/description
  Read supported router HTTP APIs or OpenWrt hostapd state over SSH.
endef

define Package/luci-app-ap-monitor/conffiles
/etc/config/ap_monitor
endef

define Build/Compile
	po2lmo ./po/zh_Hans/ap-monitor.po $(PKG_BUILD_DIR)/ap-monitor.zh-cn.lmo
endef

define Package/luci-app-ap-monitor/install
	$(INSTALL_DIR) $(1)/etc/config $(1)/usr/libexec
	$(INSTALL_DIR) $(1)/usr/libexec/rpcd
	$(INSTALL_DIR) $(1)/lib/upgrade/keep.d
	$(INSTALL_DIR) $(1)/usr/share/luci/menu.d $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/status
	$(INSTALL_DIR) $(1)/usr/lib/lua/luci/i18n
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/ap-monitor.zh-cn.lmo $(1)/usr/lib/lua/luci/i18n/
	$(INSTALL_CONF) ./root/etc/config/ap_monitor $(1)/etc/config/ap_monitor
	$(INSTALL_BIN) ./root/usr/libexec/ap-monitor $(1)/usr/libexec/ap-monitor
	$(INSTALL_BIN) ./tools/set-auth.py $(1)/usr/libexec/ap-monitor-set-auth
	$(INSTALL_BIN) ./root/usr/libexec/rpcd/ap-monitor $(1)/usr/libexec/rpcd/ap-monitor
	$(INSTALL_DATA) ./root/lib/upgrade/keep.d/luci-app-ap-monitor $(1)/lib/upgrade/keep.d/
	$(INSTALL_DATA) ./root/usr/share/luci/menu.d/luci-app-ap-monitor.json $(1)/usr/share/luci/menu.d/
	$(INSTALL_DATA) ./root/usr/share/rpcd/acl.d/luci-app-ap-monitor.json $(1)/usr/share/rpcd/acl.d/
	$(INSTALL_DATA) ./htdocs/luci-static/resources/view/status/ap-monitor*.js $(1)/www/luci-static/resources/view/status/
endef

define Package/luci-app-ap-monitor/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	rm -f /tmp/luci-indexcache.*
	/etc/init.d/rpcd reload >/dev/null 2>&1
}
exit 0
endef

$(eval $(call BuildPackage,luci-app-ap-monitor))
