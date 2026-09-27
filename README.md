# AP Monitor

AP Monitor is a LuCI plugin for viewing the status of access points from OpenWrt. It refreshes once when you open the page, and you can refresh it again with a button.

- View AP status, radio information, and connected clients when the device provides them.
- Search clients by name, IP address, or MAC address. Supported OpenWrt APs can also report signal strength and link rates.
- Connect through a supported router HTTP management API or SSH to an OpenWrt AP with `hostapd` ubus methods.
- Follow LuCI's English or Simplified Chinese language setting. Queries only read status and do not change wireless or Mesh settings.

Support depends on the AP firmware and its available interfaces.

## Command-line installation

Run the command for your OpenWrt version on the router as `root`. It downloads the release package and installs it with the matching package manager.

OpenWrt 25.12:

```sh
apk update && wget -O /tmp/ap-monitor.apk 'https://github.com/Or1a/luci-app-ap-monitor/releases/download/v1.6.1/luci-app-ap-monitor-1.6.1-r1-openwrt-25.12.5.apk' && echo '3457def8e3e700ce0e223445b7121847dcaa61db9d87ab550c72460d05408427  /tmp/ap-monitor.apk' | sha256sum -c - && apk add --allow-untrusted /tmp/ap-monitor.apk
```

OpenWrt 24.10:

```sh
opkg update && wget -O /tmp/ap-monitor.ipk 'https://github.com/Or1a/luci-app-ap-monitor/releases/download/v1.6.1/luci-app-ap-monitor_1.6.1-r1_all-openwrt-24.10.7.ipk' && echo '682aa5ccff7dd893ed8f0b39949dc408a0bc6f591d8f1c42a082c5fdaa2fc14f  /tmp/ap-monitor.ipk' | sha256sum -c - && opkg install /tmp/ap-monitor.ipk
```

## 中文

AP监测是用于 OpenWrt 的 LuCI 插件，可以查看接入点的运行状态。打开页面时查询一次，也可以点击按钮再次查询。

- 在设备提供数据时，显示 AP 状态、无线信息和已连接终端。
- 按名称、IP 或 MAC 搜索终端；受支持的 OpenWrt AP 还可显示信号强度和连接速率。
- 支持已适配的路由器 HTTP 管理接口，以及提供 `hostapd` ubus 方法的 OpenWrt AP（SSH 连接）。
- 界面跟随 LuCI 的简体中文或英文设置。查询只读取状态，不修改无线或 Mesh 配置。

具体支持情况取决于 AP 固件及其接口。

## 命令行安装

在 OpenWrt 路由器上以 `root` 身份运行对应版本的命令，即可下载并安装 Release 中的安装包。

OpenWrt 25.12：

```sh
apk update && wget -O /tmp/ap-monitor.apk 'https://github.com/Or1a/luci-app-ap-monitor/releases/download/v1.6.1/luci-app-ap-monitor-1.6.1-r1-openwrt-25.12.5.apk' && echo '3457def8e3e700ce0e223445b7121847dcaa61db9d87ab550c72460d05408427  /tmp/ap-monitor.apk' | sha256sum -c - && apk add --allow-untrusted /tmp/ap-monitor.apk
```

OpenWrt 24.10：

```sh
opkg update && wget -O /tmp/ap-monitor.ipk 'https://github.com/Or1a/luci-app-ap-monitor/releases/download/v1.6.1/luci-app-ap-monitor_1.6.1-r1_all-openwrt-24.10.7.ipk' && echo '682aa5ccff7dd893ed8f0b39949dc408a0bc6f591d8f1c42a082c5fdaa2fc14f  /tmp/ap-monitor.ipk' | sha256sum -c - && opkg install /tmp/ap-monitor.ipk
```
