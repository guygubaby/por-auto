#!/bin/sh
# 从真机拉取 PorAuto P0 最近一次读屏 JSON（debug 包可用 run-as）。
# 用法：android/scripts/pull-dump.sh [输出文件]
set -eu

out="${1:-wecom-dump.json}"
adb shell run-as com.por.auto.agent cat files/dumps/latest.json > "$out"
echo "saved to $out"
