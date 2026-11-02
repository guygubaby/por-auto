package assets

import "embed"

// Files are validated by scripts/prepare-assets.mjs before packaging.
//
//go:embed runtime/* workflows/* mobile/* input-manifest.json por-input.apk adb-manifest.json platform-tools.zip u2.jar u2-hint.dex u2-NOTICE.txt
var Files embed.FS
