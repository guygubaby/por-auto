package com.por.auto.agent.schedule

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build

/** AlarmManager 调度。允许精确闹钟时用 setExactAndAllowWhileIdle，否则退回不精确的 setAndAllowWhileIdle。 */
class AlarmScheduler(private val context: Context) {

    private val alarmManager get() = context.getSystemService(AlarmManager::class.java)

    fun canScheduleExact(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarmManager.canScheduleExactAlarms()

    fun schedule(schedule: Schedule) {
        if (!schedule.enabled) {
            cancel(schedule.id)
            return
        }
        val pending = pendingIntent(schedule.id)
        // ponytail: 没有精确闹钟权限时用不精确闹钟，可能晚几分钟；需要更准时再引导用户开权限。
        if (canScheduleExact()) {
            try {
                alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, schedule.nextAtMs, pending)
                return
            } catch (_: SecurityException) {
                // Permission can be revoked between the check and setExactAndAllowWhileIdle.
            }
        }
        alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, schedule.nextAtMs, pending)
    }

    fun cancel(id: String) {
        alarmManager.cancel(pendingIntent(id))
    }

    private fun pendingIntent(id: String): PendingIntent =
        PendingIntent.getBroadcast(
            context,
            0,
            Intent(context, ScheduleReceiver::class.java)
                .setAction(ScheduleReceiver.ACTION_RUN)
                .setData(Uri.Builder().scheme("por-auto").authority("schedule").appendPath(id).build())
                .putExtra(ScheduleReceiver.EXTRA_ID, id),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
}
