package com.por.auto.agent.assistant

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

/** 助手运行期间挂一个前台通知，让系统别把进程回收；具体执行在 [AgentSession]。 */
class AgentService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        ensureChannel()
        val title = intent?.getStringExtra(EXTRA_TITLE) ?: "AI 助手"
        val text = intent?.getStringExtra(EXTRA_TEXT) ?: "正在操作手机…"
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_compass)
            .setContentTitle(title)
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build()
        runCatching { startForeground(NOTIFICATION_ID, notification) }
        return START_NOT_STICKY
    }

    private fun ensureChannel() {
        val channel = NotificationChannel(CHANNEL_ID, "AI 助手", NotificationManager.IMPORTANCE_LOW)
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    companion object {
        private const val CHANNEL_ID = "por_auto_agent"
        private const val NOTIFICATION_ID = 2101
        private const val EXTRA_TITLE = "title"
        private const val EXTRA_TEXT = "text"

        fun start(context: Context, title: String = "AI 助手", text: String = "正在操作手机…") {
            runCatching {
                ContextCompat.startForegroundService(
                    context,
                    Intent(context, AgentService::class.java)
                        .putExtra(EXTRA_TITLE, title)
                        .putExtra(EXTRA_TEXT, text),
                )
            }
        }

        fun stop(context: Context) {
            runCatching { context.stopService(Intent(context, AgentService::class.java)) }
        }
    }
}
