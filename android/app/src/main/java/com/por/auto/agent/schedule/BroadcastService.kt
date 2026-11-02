package com.por.auto.agent.schedule

import android.annotation.SuppressLint
import android.app.KeyguardManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.por.auto.agent.a11y.AgentAccessibilityService
import com.por.auto.agent.update.RunUploads
import com.por.auto.agent.wecom.RunMeta
import com.por.auto.agent.wecom.RunStore
import com.por.auto.agent.wecom.WecomBroadcastRunner
import com.por.auto.agent.wecom.BroadcastResult
import com.por.auto.agent.wecom.RecipientResult
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * 前台服务：到点执行一次群发。
 * 锁屏或无障碍未开时直接跳过并记录，不尝试绕过锁屏。
 */
class BroadcastService : Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var activeRuns = 0

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action != ACTION_RUN) {
            stopSelf(startId)
            return START_NOT_STICKY
        }
        val scheduleId = intent.getStringExtra(EXTRA_ID)
        val runNow = intent.getBooleanExtra(EXTRA_RUN_NOW, false)
        if (!startForegroundCompat("准备执行定时任务")) {
            notifyResult("定时任务未执行", "系统未允许前台服务，请检查权限")
            stopSelf(startId)
            return START_NOT_STICKY
        }
        activeRuns++
        scope.launch {
            try {
                execute(scheduleId, runNow)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.e("BroadcastService", "Unable to execute schedule", e)
                notifyResult("定时任务已停止", e.message ?: "执行失败")
            } finally {
                if (--activeRuns == 0) {
                    stopForeground(STOP_FOREGROUND_REMOVE)
                    stopSelf()
                }
            }
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    private suspend fun execute(scheduleId: String?, runNow: Boolean) = withContext(Dispatchers.IO) {
        val store = ScheduleStore(this@BroadcastService)
        val schedule = scheduleId?.let(store::find)
            ?: return@withContext notifyResult("定时任务不存在", "已被删除，未执行")
        if (!runNow && !schedule.enabled) {
            return@withContext notifyResult("定时任务已暂停", "未执行")
        }

        val keyguard = getSystemService(KeyguardManager::class.java)
        if (keyguard?.isKeyguardLocked == true) {
            return@withContext skip(store, schedule, "手机已锁屏，跳过本次")
        }
        val service = AgentAccessibilityService.instance
            ?: return@withContext skip(store, schedule, "无障碍服务未开启，跳过本次")

        val startedAt = System.currentTimeMillis()
        val lines = mutableListOf<String>()
        val runner = WecomBroadcastRunner(service) { line ->
            lines += line
            updateNotification("${schedule.timeLabel} ${schedule.text}", line)
        }
        val result = runCatching {
            runner.run(schedule.text, schedule.scope, dryRun = false)
        }.getOrElse {
            if (it is CancellationException) throw it
            BroadcastResult(
                dryRun = false,
                results = listOf(
                    RecipientResult(
                        "—", schedule.scope, "failed", it.message ?: it.javaClass.simpleName,
                    ),
                ),
                error = it.message ?: it.javaClass.simpleName,
            )
        }
        val meta = RunMeta(
            kind = "schedule",
            startedAt = startedAt,
            scope = schedule.scope,
            text = schedule.text,
            log = lines.toList(),
            device = RunMeta.device(this@BroadcastService),
        )
        val saved = runCatching { RunStore(this@BroadcastService).save(result, meta) }
            .onFailure { Log.e("BroadcastService", "Unable to save run result", it) }
            .getOrNull()
        saved?.let { file -> RunUploads.enqueue(file) }

        val finishedAt = System.currentTimeMillis()
        // Merge into the current definition; a completed run must not undo pause/delete.
        store.update(schedule.id) {
            it.copy(
                lastRunAtMs = finishedAt,
                lastStatus = if (result.error == null) "sent" else "failed",
                lastError = result.error,
            )
        }

        val summary = if (result.error == null) {
            "已发送 ${result.completed} 个"
        } else {
            "已停止：${result.error}"
        }
        notifyResult("定时 ${schedule.timeLabel}", summary)
    }

    private fun skip(store: ScheduleStore, schedule: Schedule, reason: String) {
        store.update(schedule.id) {
            it.copy(
                lastRunAtMs = System.currentTimeMillis(),
                lastStatus = "skipped",
                lastError = reason,
            )
        }
        val result = BroadcastResult(
            false,
            listOf(RecipientResult("—", schedule.scope, "skipped", reason)),
            reason,
        )
        val meta = RunMeta(
            kind = "schedule",
            startedAt = System.currentTimeMillis(),
            scope = schedule.scope,
            text = schedule.text,
            log = listOf("跳过：$reason"),
            device = RunMeta.device(this),
        )
        val saved = runCatching { RunStore(this).save(result, meta) }.getOrNull()
        saved?.let { file -> RunUploads.enqueue(file) }
        notifyResult("定时 ${schedule.timeLabel} 已跳过", reason)
    }

    /**
     * 服务类型在清单里已声明为 specialUse，这里用两参数 startForeground 即可，
     * 系统会按清单类型登记。权限被拒时返回 false，调用方跳过本次执行。
     */
    private fun startForegroundCompat(text: String): Boolean {
        val permission = foregroundPermission(Build.VERSION.SDK_INT)
        if (permission != null && androidx.core.content.ContextCompat.checkSelfPermission(this, permission) !=
            android.content.pm.PackageManager.PERMISSION_GRANTED
        ) {
            return false
        }
        return try {
            ensureChannel()
            val notification = builder("定时任务", text).setOngoing(true).build()
            startForeground(NOTIFICATION_ID, notification)
            true
        } catch (e: SecurityException) {
            false
        }
    }

    private fun updateNotification(title: String, text: String) {
        runCatching {
            NotificationManagerCompat.from(this).notify(NOTIFICATION_ID, builder(title, text).setOngoing(true).build())
        }
    }

    private fun notifyResult(title: String, text: String) {
        runCatching {
            NotificationManagerCompat.from(this).notify(
                RESULT_ID,
                builder(title, text).setAutoCancel(true).build(),
            )
        }
    }

    private fun builder(title: String, text: String): NotificationCompat.Builder =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_agenda)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setOnlyAlertOnce(true)

    private fun ensureChannel() {
        val channel = NotificationChannel(CHANNEL_ID, "定时任务", NotificationManager.IMPORTANCE_DEFAULT)
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    companion object {
        // These inlined permission names are selected using the caller's runtime SDK.
        @SuppressLint("InlinedApi")
        internal fun foregroundPermission(sdk: Int): String? = when {
            sdk >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE -> android.Manifest.permission.FOREGROUND_SERVICE_SPECIAL_USE
            sdk >= Build.VERSION_CODES.P -> android.Manifest.permission.FOREGROUND_SERVICE
            else -> null
        }

        const val ACTION_RUN = "com.por.auto.agent.action.BROADCAST_RUN"
        const val EXTRA_ID = "scheduleId"
        const val EXTRA_RUN_NOW = "runNow"
        private const val CHANNEL_ID = "por_auto_schedule"
        private const val NOTIFICATION_ID = 2001
        private const val RESULT_ID = 2002
    }
}
