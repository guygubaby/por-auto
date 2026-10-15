"""Open one Android phone and read its own WeChat nickname without editing it."""

import argparse
import json
import re
import shutil
import subprocess
import sys
import traceback
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parent
WECHAT = "com.tencent.mm"
ACCOUNT_PATTERN = r"微信号\s*[:：].*"


def choose_device(devices: dict[str, str], requested: str | None) -> str:
    ready = [serial for serial, state in devices.items() if state == "device"]
    if requested and devices.get(requested) == "device":
        return requested
    if not requested and len(ready) == 1:
        return ready[0]
    listing = ", ".join(f"{serial}: {state}" for serial, state in devices.items())
    if not requested and len(ready) > 1:
        raise RuntimeError(f"发现多台手机，请用 --serial 指定一台：{listing}")
    raise RuntimeError(
        f"没有找到可操作的手机（{listing or '设备列表为空'}）。"
        "请连接 USB 数据线、打开 USB 调试、解锁手机并允许这台电脑调试。"
    )


def find_me_tab(xml: str, screen_height: int) -> tuple[int, int]:
    tabs: dict[str, list[tuple[int, int]]] = {"我": [], "通讯录": [], "发现": []}
    for node in ET.fromstring(xml).iter("node"):
        label = node.get("text") or node.get("content-desc")
        bounds = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", node.get("bounds", ""))
        if label not in tabs or not bounds:
            continue
        left, top, right, bottom = map(int, bounds.groups())
        if right > left and bottom > top and top >= screen_height * 0.75:
            tabs[label].append(((left + right) // 2, (top + bottom) // 2))
    matches = {
        point
        for point in tabs["我"]
        if all(
            any(abs(other[1] - point[1]) <= screen_height * 0.02 for other in tabs[label])
            for label in ("通讯录", "发现")
        )
    }
    if len(matches) != 1:
        raise RuntimeError("无法唯一识别微信底部的‘我’。请回到微信主界面，关闭弹窗后重试。")
    return matches.pop()


def parse_nickname(xml: str) -> str:
    root = ET.fromstring(xml)
    if not any(node.get("text") == "个人信息" for node in root.iter("node")):
        raise RuntimeError("当前不是可识别的微信个人信息页。")
    parents = {child: parent for parent in root.iter() for child in parent}
    candidates = set()
    for label in root.iter("node"):
        if label.get("text") not in ("昵称", "名字"):
            continue
        row = parents.get(label)
        while row is not None:
            values = [
                node.get("text", "")
                for node in row.iter("node")
                if node is not label and node.get("text", "").strip()
            ]
            if values:
                if len(values) == 1:
                    candidates.add(values[0])
                break
            row = parents.get(row)
    if len(candidates) != 1:
        raise RuntimeError("无法唯一读取昵称字段；已停止，不猜测微信号或其他文本。")
    return candidates.pop()


def open_profile(device) -> str:
    device.screen_on()
    if WECHAT not in device.app_list():
        raise RuntimeError("这台手机没有安装微信 com.tencent.mm。")
    device.app_start(WECHAT)
    if not device.app_wait(WECHAT, front=True, timeout=15):
        raise RuntimeError("微信没有进入前台，请检查手机是否已解锁。")
    if not device(text="个人信息").exists:
        account = device(textMatches=ACCOUNT_PATTERN)
        if not account.exists:
            device(text="通讯录").wait(timeout=10)
            _, height = device.window_size()
            device.click(*find_me_tab(device.dump_hierarchy(), height))
        if not account.wait(timeout=10) or account.count != 1:
            raise RuntimeError("未识别到‘我’页面的微信号入口，请检查登录状态、语言和当前页面。")
        account.click()
        if not device(text="个人信息").wait(timeout=10):
            raise RuntimeError("点击个人资料入口后没有出现‘个人信息’页面。")
    return parse_nickname(device.dump_hierarchy())


def save_evidence(device, folder: Path) -> None:
    try:
        device.screenshot(str(folder / "screen.png"))
    except Exception as error:
        print(f"无法保存 screen.png：{error}", file=sys.stderr)
    try:
        (folder / "hierarchy.xml").write_text(
            device.dump_hierarchy(), encoding="utf-8"
        )
    except Exception as error:
        print(f"无法保存 hierarchy.xml：{error}", file=sys.stderr)


def main() -> int:
    parser = argparse.ArgumentParser(description="打开 Android 手机投屏和微信，读取自己的微信昵称。")
    parser.add_argument("--serial", help="ADB 设备序列号；仅连接一台时自动选择")
    args = parser.parse_args()
    device = None
    folder = None
    mirror = None
    try:
        adb = shutil.which("adb")
        if not adb:
            raise RuntimeError("未找到 adb，请先安装 Android platform-tools 并加入 PATH。")
        output = subprocess.run(
            [adb, "devices", "-l"], check=True, capture_output=True, text=True, timeout=15
        ).stdout
        devices = {}
        for line in output.splitlines()[1:]:
            parts = line.split()
            if len(parts) >= 2 and not line.startswith("*"):
                devices[parts[0]] = parts[1]
        serial = choose_device(devices, args.serial)
        print(f"[1/4] 已选择手机：{serial}", flush=True)

        import uiautomator2 as u2

        timestamp = datetime.now(ZoneInfo("Asia/Shanghai")).strftime("%Y%m%d-%H%M%S-%f")
        folder = ROOT / "runs" / timestamp
        folder.mkdir(parents=True)
        scrcpy = shutil.which("scrcpy")
        if scrcpy:
            with (folder / "scrcpy.log").open("w", encoding="utf-8") as log:
                mirror = subprocess.Popen(
                    [scrcpy, "--serial", serial, "--no-audio", "--window-title", f"微信示例 - {serial}"],
                    stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                    start_new_session=True,
                )
            print("[2/4] 已启动投屏进程；窗口可以保留查看手机。", flush=True)
        else:
            print("[2/4] 未安装 scrcpy，跳过投屏，继续读取。", flush=True)

        device = u2.connect(serial)
        print("[3/4] 正在打开微信 → 我 → 个人信息。", flush=True)
        nickname = open_profile(device)
        save_evidence(device, folder)
        (folder / "result.json").write_text(
            json.dumps({"device_serial": serial, "nickname": nickname}, ensure_ascii=False, indent=2)
            + "\n", encoding="utf-8"
        )
        if mirror is not None and mirror.poll() is not None:
            print(f"投屏进程已退出，详情见：{folder / 'scrcpy.log'}", file=sys.stderr)
        print(f"[4/4] 微信昵称：{nickname}\n结果目录：{folder}")
        return 0
    except Exception as error:
        print(f"执行失败：{error}", file=sys.stderr)
        if folder is not None:
            (folder / "error.txt").write_text(traceback.format_exc(), encoding="utf-8")
            if device is not None:
                save_evidence(device, folder)
            print(f"诊断目录：{folder}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
