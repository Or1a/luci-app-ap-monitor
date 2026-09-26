# AP监测（OpenWrt LuCI 插件）

[English README](README.en.md) · 许可证：[GPL-3.0-only](LICENSE)

为 OpenWrt 提供打开页面时及手动按需查询 AP 状态的 LuCI 页面。当前有两种连接方式：提供已适配 HTTP 管理接口与 SHA1 登录流程的原厂固件，以及提供 `hostapd.*` ubus 接口的 OpenWrt AP（SSH 公钥登录）。不同型号和固件可能提供不同字段；尚未适配的固件需要单独核对其接口。

安装后在「状态 → AP监测 → 管理 AP」添加 AP，填写 IPv4 地址，名称可选，并选择连接方式。路由器 HTTP 接口模式通过「设置登录密码」保存 AP 的后台管理密码；已有凭据显示「密码已保存」，点击「更新登录密码」后才展开输入框。更新的是插件保存的登录凭据，不会修改 AP 后台密码。HTTP 模式下的可选 MAC 用于核对设备身份，并非 DHCP 地址预留或登录凭据。启用开关位于高级设置。发行包不预置 AP。

监测页按 AP 展示状态卡片，终端列表支持按名称、IP 或 MAC 搜索。每次打开监测页面时自动查询一次，也可点击「查询状态」手动刷新。插件不会自动轮询或发送 Ping，并且最多同时查询三台 AP。HTTP 模式每次查询使用到各 AP 的直接 HTTP 连接，获取登录参数并认证一次，然后分别读取系统、无线与终端信息；AP 支持时复用同一连接。OpenWrt SSH 模式每次查询建立一次 SSH 连接，读取 `/proc` 和 `hostapd.*` 的只读 ubus 方法。没有额外的 TCP 测速探测，也不把接口响应时间作为 Wi-Fi 延迟。页面的「已读取」「部分可读」「无法查询」表示本次信息读取结果，不能据此断言整台 AP 或终端联网正常。HTTP 模式的连续运行时间及内存占用来自固件系统状态接口，SSH 模式来自远端 `/proc`；CPU 采样可靠性尚未核实，暂不展示。HTTP 模式的当前信道取自 `wifi_detail_all` 的 `channelInfo.channel`；SSH 模式来自 `hostapd` 的 `get_status.channel`。

无线终端归属通过 `wifi_connect_devices` 提供的关联列表核验，并尽量从 OpenWrt 未过期的 DHCP 租约补齐设备名和 IP。通用设备列表可能包含有线、经其他 AP 转发或归属未确认的设备，不能全部算作当前 AP 的无线终端。与已配置 AP 的 MAC 匹配的条目不计入无线终端数量；不同无线接口使用其他 MAC 时，可能无法识别。接口不支持或未返回充分信息时，页面会保留相应限制，不能据此断言没有设备连接。

这些数据是最近一次查询时的快照。系统、无线与终端读取互不依赖，某一项失败会明确标出，并保留其他成功的数据；不会把查询失败显示为零台终端。上联丢包、无线重传和终端实际联网能力尚未测量。

## 页面功能

- 界面跟随 LuCI 的语言设置，支持简体中文和英文。在「系统 → 系统 → 语言和界面」选择语言，保存并重新打开页面即可；选择「自动」时由 LuCI 根据浏览器语言决定。菜单、设置、提示及时间格式一起切换，AP 名称、SSID 和导出数据保持原值。其他未提供翻译的语言使用英文。
- 「设备详情」显示硬件型号、固件版本、取样时间和各项查询结果；型号可能是固件报告的硬件代号。
- 终端列表支持名称／IP／MAC 搜索、频段筛选和名称排序。OpenWrt SSH 返回有效 RSSI 时可按信号由弱到强排序。
- OpenWrt SSH 提供的终端信号以 dBm 显示，连接速率按终端视角显示上行（终端 → AP）和下行（AP → 终端），单位 Mbps。这不是实时流量或测速结果。固件未提供有效数据时不显示对应列。
- 「导出结果」下载当前这次查询的 JSON 数据，用于本地排查。它包含 AP 和终端名称、IP、MAC 等网络信息，不包含登录凭据；导出、搜索及筛选都不再次请求 AP。
- 多 SSID 的 OpenWrt AP 按无线接口显示终端数；AP 总数按 MAC 去重，避免把同一频段总数重复显示到每个 SSID 上。

实机支持范围与未验证字段见 [兼容性记录](docs/compatibility.md)。

## OpenWrt SSH 连接方式

在监测页面所属的 OpenWrt 路由器上准备一个仅 root 可读（`0600`）的 SSH 私钥，放在 `/root/.ssh/`，并在 AP 上为对应账户授权公钥。该路由器默认使用 Dropbear SSH 客户端，因此私钥需采用其支持的格式。将 AP 的主机公钥加入监测路由器的 `/root/.ssh/known_hosts`，并核对主机指纹，然后在「管理 AP」中选择「OpenWrt SSH」、填写私钥路径；用户名默认 `root`，端口默认 `22`。查询以批处理模式执行，拒绝未记录或变化的主机密钥，也不会尝试密码登录。

目标 AP 需提供 `ubus` 和 `hostapd.<无线接口>` 的 `get_status`、`get_clients` 方法。监测路由器只运行远端的只读命令，不上传脚本或修改无线配置。不同固件即使可以 SSH 登录，也不一定有这些接口；这时系统运行数据仍可读取，无线和终端数据会标记为不可用。要适配原厂固件 SSH、华硕／梅林等固件，还需分别实现其无线接口解析，不能仅凭 SSH 端口开放推断终端归属。

HTTP 模式使用后台管理密码登录 HTTP 接口并读取状态，无需 AP 的 SSH 凭据。两种模式都不会修改 AP 的无线、中继或 Mesh 配置。

LuCI 密码输入框将密码提交到 OpenWrt 的认证后端，后端在 `/etc/ap_monitor.auth` 中保存登录所需的派生摘要，不保存明文密码。文件仅允许 root 读写（`0600`），摘要仍属于登录凭据；页面只显示是否已配置，不回显摘要。该文件会随 OpenWrt 系统备份保留。

也可在 OpenWrt 上以 root 运行以下命令，按提示输入各 AP 的后台管理密码：

```sh
/usr/libexec/ap-monitor-set-auth AP_IP [AP_IP ...]
```

将 `AP_IP` 替换为已在监测设置中添加的 AP 地址。

依赖 `luci-base` 和 `python3`；使用 SSH 模式时，监测路由器还需具备 Dropbear 或兼容的 SSH 客户端。可将本目录加入 OpenWrt 构建系统的 package feed，构建 `luci-app-ap-monitor`。手动安装时，将 `root/` 下的文件复制到 OpenWrt 对应路径，将 `htdocs/` 下的文件复制到 `/www/` 对应路径，并将 `tools/set-auth.py` 安装为 `/usr/libexec/ap-monitor-set-auth`。后端及命令行工具需要可执行权限。升级已有安装时保留现有的 `/etc/config/ap_monitor` 和认证文件，最后重启 `rpcd`、`uhttpd` 以加载接口权限和菜单。

构建时通过 `luci-base/host` 提供的官方 `po2lmo` 编译中文翻译，并将翻译随主包安装。英文直接使用源码中的默认文本，无需单独语言包。手动安装还需执行以下命令，并把生成的文件放到路由器的 `/usr/lib/lua/luci/i18n/`（权限 `0644`）：

```sh
po2lmo po/zh_Hans/ap-monitor.po ap-monitor.zh-cn.lmo
```

翻译源文件位于 `po/zh_Hans/`，新语言可参考 `po/templates/` 的模板，并在 Makefile 中加入相应编译和安装步骤。修改菜单后清除 `/tmp/luci-indexcache.*`，重新加载 LuCI 页面。

## 接口依据

系统运行时间与内存字段参照[原厂固件的状态接口实现](https://github.com/dmamontov/miwifi-luci-api/blob/main/miwifi_r1350_firmware_c56d8_1.0.29/misystem.lua#L439)，并在设备上核对返回结构。不同固件的字段缺失或接口错误均按未知处理，不以默认零值补齐。

OpenWrt 的终端字段和速率单位参照[官方 hostapd ubus 实现](https://github.com/openwrt/openwrt/blob/main/package/network/services/hostapd/src/src/ap/ubus.c)：`rate.rx/tx` 为 kbit/s，转换为 Mbps 时除以 1000；正数的厂商自定义信号值不会套用 dBm 解释。
