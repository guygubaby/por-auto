package com.por.auto.agent.schedule

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.content.ContextCompat
import com.por.auto.agent.wecom.BroadcastResult
import com.por.auto.agent.wecom.RecipientResult
import com.por.auto.agent.wecom.RunStore

/** 闹钟落点：拉起前台服务执行，再排下一次。 */
class ScheduleReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_RUN) return
        val id = intent.getStringExtra(EXTRA_ID) ?: return
        try {
            val store = ScheduleStore(context)
            val schedule = store.claimDue(id, System.currentTimeMillis()) ?: return
            store.find(id)?.let { AlarmScheduler(context).schedule(it) }
            try {
                ContextCompat.startForegroundService(
                    context,
                    Intent(context, BroadcastService::class.java)
                        .setAction(BroadcastService.ACTION_RUN)
                        .putExtra(BroadcastService.EXTRA_ID, id),
                )
            } catch (e: RuntimeException) {
                if (e !is IllegalStateException && e !is SecurityException) throw e
                val reason = "系统不允许启动后台任务，跳过本次；请允许精确闹钟"
                store.update(id) {
                    it.copy(lastRunAtMs = System.currentTimeMillis(), lastStatus = "skipped", lastError = reason)
                }
                RunStore(context).save(
                    BroadcastResult(false, listOf(RecipientResult("—", schedule.scope, "skipped", reason)), reason),
                )
            }
        } catch (e: Exception) {
            Log.e("ScheduleReceiver", "Unable to dispatch schedule", e)
        }
    }

    companion object {
        const val ACTION_RUN = "com.por.auto.agent.action.SCHEDULE_RUN"
        const val EXTRA_ID = "scheduleId"
    }
}

/** 开机后重新排闹钟。 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action !in setOf(
                Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED,
                Intent.ACTION_TIME_CHANGED, Intent.ACTION_TIMEZONE_CHANGED,
                android.app.AlarmManager.ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED,
            )
        ) return
        val store = ScheduleStore(context)
        val scheduler = AlarmScheduler(context)
        val now = System.currentTimeMillis()
        try {
            store.all().forEach { schedule ->
                val next = store.update(schedule.id) {
                    if (it.enabled) it.copy(nextAtMs = Schedule.nextOccurrence(it.hour, it.minute, now)) else it
                }
                next?.let(scheduler::schedule)
            }
        } catch (e: Exception) {
            Log.e("BootReceiver", "Unable to restore schedule alarms", e)
        }
    }
}
