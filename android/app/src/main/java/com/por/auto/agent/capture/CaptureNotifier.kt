package com.por.auto.agent.capture

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.por.auto.agent.MainActivity

/** 通知栏入口：在别的 App（比如企微）页面也能触发一次读屏。 */
class CaptureNotifier(private val context: Context) {

    fun ensureChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "屏幕读取",
            NotificationManager.IMPORTANCE_DEFAULT,
        )
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    fun showReady() {
        val notification = baseBuilder()
            .setContentTitle("PorAuto 读屏")
            .setContentText("在企微页面下拉通知栏，点「读取当前屏幕」")
            .setOngoing(true)
            .addAction(0, "读取当前屏幕", captureIntent())
            .build()
        notify(notification)
    }

    fun showResult(result: CaptureResult) {
        val (title, text) = when (result) {
            is CaptureResult.Success -> {
                val app = result.snapshot.packageName ?: "当前屏幕"
                "已读取 $app" to "${result.snapshot.elements.size} 个控件 · ${result.snapshot.windows.size} 个窗口"
            }
            CaptureResult.NoService -> "无障碍未开启" to "打开 PorAuto Agent，开启无障碍服务后再试"
            CaptureResult.NoWindow -> "没有读到控件" to "确认当前页面已加载，再试一次"
            is CaptureResult.Error -> "读取失败" to result.message
        }
        val notification = baseBuilder()
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setAutoCancel(true)
            .addAction(0, "再读一次", captureIntent())
            .build()
        notify(notification)
    }

    private fun baseBuilder(): NotificationCompat.Builder =
        NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setContentIntent(openIntent())
            .setOnlyAlertOnce(true)

    private fun captureIntent(): PendingIntent =
        PendingIntent.getBroadcast(
            context,
            1,
            Intent(context, CaptureReceiver::class.java).setAction(CaptureReceiver.ACTION_CAPTURE),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

    private fun openIntent(): PendingIntent =
        PendingIntent.getActivity(
            context,
            2,
            Intent(context, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

    private fun notify(notification: Notification) {
        try {
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
        } catch (_: SecurityException) {
            // 通知权限没给：读取仍然会保存到文件，界面里能看到。
        }
    }

    private companion object {
        const val CHANNEL_ID = "por_auto_capture"
        const val NOTIFICATION_ID = 1001
    }
}
