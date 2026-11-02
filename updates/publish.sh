#!/usr/bin/env sh
# 用法: updates/publish.sh <apk 路径> <版本名> <versionCode> [更新说明]
# 例:   updates/publish.sh android/dist/PorAuto-0.1.3-release.apk 0.1.3 4 "修复首页识别"
# 版本号必须和 APK 里的一致，脚本会自己核对。
set -eu

APK=${1:?需要 apk 路径}
NAME=${2:?需要版本名}
CODE=${3:?需要 versionCode}
NOTES=${4:-}

[ -f "$APK" ] || { echo "找不到 $APK"; exit 1; }

AAPT=$(ls "$HOME"/Library/Android/sdk/build-tools/*/aapt2 2>/dev/null | tail -1 || true)
if [ -n "$AAPT" ]; then
  BADGING=$("$AAPT" dump badging "$APK")
  APK_CODE=$(printf '%s' "$BADGING" | sed -n "s/.*versionCode='\([0-9]*\)'.*/\1/p" | head -1)
  APK_NAME=$(printf '%s' "$BADGING" | sed -n "s/.*versionName='\([^']*\)'.*/\1/p" | head -1)
  [ "$APK_CODE" = "$CODE" ] || { echo "versionCode 对不上：APK 是 $APK_CODE，参数是 $CODE"; exit 1; }
  [ "$APK_NAME" = "$NAME" ] || { echo "versionName 对不上：APK 是 $APK_NAME，参数是 $NAME"; exit 1; }
fi

SIZE=$(wc -c < "$APK" | tr -d ' ')
SHA=$(shasum -a 256 "$APK" | awk '{print $1}')
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

# 用 python 生成 JSON，说明里有引号或换行也不会把元数据弄坏。
python3 - "$TMP" "$CODE" "$NAME" "$NOTES" "$SIZE" "$SHA" <<'PY'
import datetime
import json
import sys

path, code, name, notes, size, sha = sys.argv[1:7]
payload = {
    "versionCode": int(code),
    "versionName": name,
    "notes": notes,
    "size": int(size),
    "sha256": sha,
    "publishedAt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
}
with open(path, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, ensure_ascii=False)
PY

pnpm dlx wrangler@latest r2 object put por-auto-releases/latest.apk \
  --file "$APK" --content-type application/vnd.android.package-archive --remote
pnpm dlx wrangler@latest r2 object put por-auto-releases/latest.json \
  --file "$TMP" --content-type application/json --remote

echo "已发布 $NAME ($CODE) size=$SIZE sha256=$SHA"
