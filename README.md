# AP Monitor

AP Monitor is a LuCI plugin for viewing the status of access points from OpenWrt. It refreshes once when you open the page, and you can refresh it again with a button.

- View AP status, radio information, and connected clients when the device provides them.
- Search clients by name, IP address, or MAC address. Supported OpenWrt APs can also report signal strength and link rates.
- Connect through a supported router HTTP management API or SSH to an OpenWrt AP with `hostapd` ubus methods.
- Follow LuCI's English or Simplified Chinese language setting. Queries only read status and do not change wireless or Mesh settings.

Support depends on the AP firmware and its available interfaces.

## 中文

AP监测是用于 OpenWrt 的 LuCI 插件，可以查看接入点的运行状态。打开页面时查询一次，也可以点击按钮再次查询。

- 在设备提供数据时，显示 AP 状态、无线信息和已连接终端。
- 按名称、IP 或 MAC 搜索终端；受支持的 OpenWrt AP 还可显示信号强度和连接速率。
- 支持已适配的路由器 HTTP 管理接口，以及提供 `hostapd` ubus 方法的 OpenWrt AP（SSH 连接）。
- 界面跟随 LuCI 的简体中文或英文设置。查询只读取状态，不修改无线或 Mesh 配置。

具体支持情况取决于 AP 固件及其接口。
