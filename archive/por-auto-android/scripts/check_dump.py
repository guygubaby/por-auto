#!/usr/bin/env python3
"""检查 PorAuto P0 导出的节点 JSON，辅助真机企微验证。

用法：
    python3 android/scripts/check_dump.py wecom-dump.json --expect home
    python3 android/scripts/check_dump.py wecom-dump.json --expect chat

home：消息首页，应看到「全部 / 群聊」等分类。
chat：会话页，应看到完整标题、「发送」和可编辑输入框。
"""

import argparse
import json
import sys

HOME_KEYWORDS = ["全部", "群聊", "消息", "通讯录", "工作台", "我"]
CHAT_KEYWORDS = ["发送"]
MAX_PRINT = 30


def target_elements(dump):
    """取控件最多的应用窗口；没有窗口信息时退回全部元素。"""
    elements = dump.get("elements", [])
    windows = dump.get("windows", [])
    app_windows = [w for w in windows if w.get("type") == "application"]
    if not app_windows:
        return elements
    target = max(app_windows, key=lambda w: w.get("nodeCount", 0))
    scoped = [e for e in elements if e.get("windowIndex") == target.get("index")]
    return scoped or elements


def find(elements, text):
    return [e for e in elements if text in (e.get("name") or "")]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("path")
    parser.add_argument("--expect", choices=["home", "chat"], default="home")
    args = parser.parse_args()

    with open(args.path, encoding="utf-8") as f:
        dump = json.load(f)

    elements = target_elements(dump)
    package = dump.get("packageName")
    print(f"package: {package}")
    print(f"capturedAt: {dump.get('capturedAt')}")
    print(f"screen: {dump.get('screen')}")
    print(f"windows: {[(w.get('type'), w.get('packageName'), w.get('nodeCount')) for w in dump.get('windows', [])]}")
    print(f"elements: {len(elements)}  protected: {dump.get('protected')}")
    print()

    keywords = HOME_KEYWORDS if args.expect == "home" else CHAT_KEYWORDS
    missing = []
    found = set()
    print(f"keywords ({args.expect}):")
    for kw in keywords:
        hits = find(elements, kw)
        if hits:
            found.add(kw)
            e = hits[0]
            print(f"  {kw}: {len(hits)}  ref={e['ref']} actionRef={e.get('actionRef')} bounds={e.get('bounds')}")
        else:
            print(f"  {kw}: MISSING")
            missing.append(kw)
    print()

    editable = [e for e in elements if e.get("editable")]
    print(f"editable nodes: {len(editable)}")
    for e in editable[:10]:
        print(f"  {e['ref']} editRef={e.get('editRef')} name={e.get('name')!r} resourceId={e.get('resourceId')}")
    print()

    clickable = [e for e in elements if e.get("clickable")]
    print(f"clickable nodes: {len(clickable)}")
    for e in clickable[:MAX_PRINT]:
        print(
            f"  {e['ref']} actionRef={e.get('actionRef')} "
            f"name={(e.get('name') or '')[:30]!r} resourceId={e.get('resourceId')}"
        )
    print()

    if args.expect == "home":
        # 「全部」和「群聊」是同一个筛选器的两种状态，命中任意一个即可。
        ok = package == "com.tencent.wework" and bool(found & {"全部", "群聊"})
    else:
        # 输入框为空时「发送」按钮不出现，所以只要求可编辑输入框。
        ok = package == "com.tencent.wework" and bool(editable)
        if "发送" not in found:
            print("note: 发送按钮未出现（输入框为空时正常）")
    print("RESULT:", "OK" if ok else "CHECK", "missing=", missing, "editable=", bool(editable))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
