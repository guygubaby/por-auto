#!/usr/bin/env bash
set -euo pipefail
readonly PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${PROJECT_ROOT}"
pnpm prepare:adb windows
pnpm prepare:u2
if [[ "$(uname -s)" == "Darwin" ]]; then
  readonly LLVM_BIN="$(brew --prefix llvm)/bin"
  [[ -x "${LLVM_BIN}/llvm-lib" && -x "${LLVM_BIN}/llvm-rc" ]] || { echo "macOS 交叉构建需要 LLVM：brew install llvm；也可使用 GitHub Windows 构建。" >&2; exit 1; }
  readonly SYSROOT="$(rustc --print sysroot)"
  export WECHAT_RUST_LLD="${SYSROOT}/lib/rustlib/aarch64-apple-darwin/bin/rust-lld"
  export PATH="${PROJECT_ROOT}/scripts/cross-bin:${LLVM_BIN}:${PATH}"
  export XWIN_CACHE_DIR="${XWIN_CACHE_DIR:-${HOME}/Library/Caches/cargo-xwin}"
  export XWIN_ARCH="x86_64"
  export RUSTFLAGS="${RUSTFLAGS:-} -C target-feature=+crt-static"
  pnpm tauri build --runner "${PROJECT_ROOT}/scripts/cargo-xwin.sh" --target x86_64-pc-windows-msvc --bundles nsis
else
  pnpm tauri build --bundles nsis
fi
mkdir -p deliverables
find src-tauri/target -path '*/bundle/nsis/*-setup.exe' -exec cp {} deliverables/ \;
