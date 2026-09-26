#!/usr/bin/python3
"""Store router HTTP login derivations without keeping plaintext passwords."""

import getpass
import ipaddress
import os
import runpy
import sys

RPC_PLUGIN = "/usr/libexec/rpcd/ap-monitor"


def main():
    if len(sys.argv) < 2 or os.geteuid() != 0:
        raise SystemExit("用法（root）：ap-monitor-set-auth AP_IP [AP_IP ...]")
    try:
        addresses = [str(ipaddress.IPv4Address(value)) for value in sys.argv[1:]]
    except ipaddress.AddressValueError:
        raise SystemExit("AP 地址必须是有效的 IPv4 地址；未保存。") from None
    try:
        backend = runpy.run_path(RPC_PLUGIN)
        dispatch = backend["dispatch"]
    except Exception:
        raise SystemExit("无法加载认证后端，请检查插件安装。") from None

    requests = []
    for ip in addresses:
        password = getpass.getpass(f"{ip} 的路由器后台密码：")
        if not 1 <= len(password) <= 256:
            raise SystemExit("密码长度必须为 1 至 256 个字符；未保存。")
        try:
            password.encode("utf-8")
        except UnicodeError:
            raise SystemExit("密码包含无法保存的字符；未保存。") from None
        requests.append({"ip": ip, "password": password})

    for request in requests:
        try:
            result = dispatch("set_auth", request)
            if result != {"success": True}:
                raise RuntimeError("save_failed")
        except Exception:
            raise SystemExit("保存未完成，请检查认证文件权限和插件安装。") from None
    print("认证摘要已保存；未保存明文密码。")


if __name__ == "__main__":
    main()
