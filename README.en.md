# AP Monitor for OpenWrt LuCI

[简体中文](README.md) · License: [GPL-3.0-only](LICENSE)

AP Monitor shows a snapshot of access points and their associated wireless clients in LuCI. It queries once when the page opens and again when you press **Refresh status**. The interface follows the LuCI language setting and supports English and Simplified Chinese.

## Supported connections

| Driver | Access | Available data |
| --- | --- | --- |
| Router HTTP API | HTTP login with the AP administrator password | Verified wireless client associations, radio channel, uptime, memory, model and firmware where the firmware supplies them. |
| OpenWrt SSH | Key authentication with verified host keys | `hostapd.*` client associations and radio status, plus system data from `/proc`. Valid RSSI and link rates are shown when the AP provides them. |

Router HTTP support has been checked on AX6000 (RA72), BE3600 Pro (RN01), and AX3000 (RA80) firmware versions listed in [compatibility notes](docs/compatibility.md). Other firmware may differ. SSH access alone does not provide wireless client details on every router firmware. Positive `signal` values are not presented as dBm or percentages because their semantics have not been verified. Router traffic statistics are not shown as Wi-Fi link rates.

The client list supports search by name, IP and MAC, band filtering, and name sorting. Valid RSSI from OpenWrt SSH also enables weakest-signal sorting. Export downloads the current JSON snapshot, including device names, IPs and MACs, without credentials.

## Install and configure

Add this directory to an OpenWrt package feed and build `luci-app-ap-monitor`. Dependencies are `luci-base` and `python3`; SSH mode also requires a compatible SSH client. The build compiles the Chinese LuCI catalog with `po2lmo`.

Open **Status → AP Monitor → Manage APs**. Add an AP with its management IPv4 address and select its connection method. For Router HTTP, use **Set login password** to store the administrator login credential in the router's protected auth file. It stores a derived login hash, not the plaintext password. The optional MAC field verifies AP identity; it is not a DHCP reservation.

For OpenWrt SSH, place a root-only (`0600`) compatible private key under `/root/.ssh/` on the monitoring router, authorize its public key on the AP, and verify the AP's host key in `/root/.ssh/known_hosts`. Enter the private-key path in AP settings. The monitor only executes read-only commands remotely.

The package does not contain AP addresses, passwords, keys, or example production configuration. It does not change Wi-Fi, Mesh or network settings. Connection errors and missing metrics remain explicit instead of being reported as zero.

See the [Chinese README](README.md) for manual installation and API details. GPL-3.0-only requires distributors of modified versions to provide the corresponding source under the same license. Private changes do not need to be published.
