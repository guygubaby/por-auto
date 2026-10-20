// GENERATED from mobile-workflows/wechat-suite/src/capture.js
'use strict';

module.exports = function (images, sleep) {
  for (var attempt = 0; attempt < 2; attempt++) {
    var source = images.captureScreen();
    if (!source) { if (!attempt) sleep(150); continue; }
    // Releasing the host frame also disables AutoJs6's stale-image fallback after a capture timeout.
    try { return images.copy(source); } finally { source.recycle(); }
  }
  throw new Error('没有取得新的屏幕画面，已停止；未使用上一帧继续操作');
};
