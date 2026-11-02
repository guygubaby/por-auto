package com.por.auto.agent.capture

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.por.auto.agent.a11y.ScreenSnapshot
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.io.File

sealed interface CaptureResult {
    data class Success(val snapshot: ScreenSnapshot, val json: String, val file: File) : CaptureResult
    data object NoService : CaptureResult
    data object NoWindow : CaptureResult
    data class Error(val message: String) : CaptureResult
}

/** 通知栏「读取当前屏幕」的落点。悬浮按钮走 CaptureRunner，不经过这里。 */
class CaptureReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_CAPTURE) return
        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                CaptureNotifier(context).showResult(CaptureRunner.capture(context))
            } finally {
                pending.finish()
            }
        }
    }

    companion object {
        const val ACTION_CAPTURE = "com.por.auto.agent.action.CAPTURE"
    }
}
