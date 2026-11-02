#!/usr/bin/env sh
# 用法: updates/publish.sh <apk 路径> <版本名> <versionCode> [更新说明]
# 例:   updates/publish.sh android/dist/PorAuto-Agent-0.1.2-release.apk 0.1.2 3 "修复首页识别"
# 说明里不要带英文引号，直接写进 JSON。
set -eu

APK=${1:?需要 apk 路径}
NAME=${2:?需要版本名}
CODE=${3:?需要 versionCode}
NOTES=${4:-}

[ -f "$APK" ] || { echo "找不到 $APK"; exit 1; }

SIZE=$(wc -c < "$APK" | tr -d ' ')
SHA=$(shasum -a 256 "$APK" | awk '{print $1}')
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

printf '{"versionCode":%s,"versionName":"%s","notes":"%s","size":%s,"sha256":"%s","publishedAt":"%s"}' \
  "$CODE" "$NAME" "$NOTES" "$SIZE" "$SHA" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$TMP"

pnpm dlx wrangler@latest r2 object put por-auto-releases/latest.apk \
  --file "$APK" --content-type application/vnd.android.package-archive --remote
pnpm dlx wrangler@latest r2 object put por-auto-releases/latest.json \
  --file "$TMP" --content-type application/json --remote

echo "已发布 $NAME ($CODE) size=$SIZE sha256=$SHA"
