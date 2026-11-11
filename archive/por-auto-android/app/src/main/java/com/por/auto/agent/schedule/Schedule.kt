package com.por.auto.agent.schedule

import android.content.Context
import com.por.auto.agent.wecom.WecomScope
import com.por.auto.agent.wecom.WecomBroadcastRunner
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.time.Instant
import java.time.LocalTime
import java.time.ZoneId
import java.util.UUID

enum class RepeatKind(val key: String, val label: String) {
    Daily("daily", "每天"),
    Hourly("hourly", "每小时"),
    Interval("interval", "按间隔"),
    ;

    companion object {
        fun fromKey(key: String): RepeatKind = entries.firstOrNull { it.key == key } ?: Daily
    }
}

data class Schedule(
    val id: String,
    val text: String,
    val scope: WecomScope,
    val hour: Int,
    val minute: Int,
    val repeat: RepeatKind = RepeatKind.Daily,
    val intervalMinutes: Int = 60,
    val enabled: Boolean,
    val nextAtMs: Long,
    val lastRunAtMs: Long? = null,
    val lastStatus: String? = null,
    val lastError: String? = null,
    /** 关联的任务；为空的是旧版直接存正文的企微定时。 */
    val taskId: String? = null,
) {
    init {
        require(id.isNotBlank()) { "任务 ID 不能为空" }
        require(hour in 0..23 && minute in 0..59) { "任务时间无效" }
        require(intervalMinutes in 5..1440) { "间隔应在 5 分钟到 24 小时之间" }
        if (taskId == null) WecomBroadcastRunner.validateText(text)
    }

    val timeLabel: String
        get() = when (repeat) {
            RepeatKind.Daily -> "%02d:%02d".format(hour, minute)
            RepeatKind.Hourly -> "每小时 :%02d".format(minute)
            RepeatKind.Interval -> "每 $intervalMinutes 分钟"
        }

    /** 下一次触发时间：每天按钟点，每小时按分钟，间隔按现在往后推。 */
    fun nextAfter(nowMs: Long, zone: ZoneId = ZoneId.systemDefault()): Long = when (repeat) {
        RepeatKind.Daily -> nextOccurrence(hour, minute, nowMs, zone)
        RepeatKind.Hourly -> nextHourly(minute, nowMs, zone)
        RepeatKind.Interval -> nowMs + intervalMinutes * 60_000L
    }

    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("text", text)
        put("scope", scope.key)
        put("hour", hour)
        put("minute", minute)
        put("repeat", repeat.key)
        put("intervalMinutes", intervalMinutes)
        put("enabled", enabled)
        put("nextAtMs", nextAtMs)
        put("lastRunAtMs", lastRunAtMs ?: JSONObject.NULL)
        put("lastStatus", lastStatus ?: JSONObject.NULL)
        put("lastError", lastError ?: JSONObject.NULL)
        put("taskId", taskId ?: JSONObject.NULL)
    }

    companion object {
        fun from(json: JSONObject): Schedule = Schedule(
            id = json.getString("id"),
            text = json.getString("text"),
            scope = WecomScope.fromKey(json.getString("scope")),
            hour = json.getInt("hour"),
            minute = json.getInt("minute"),
            repeat = RepeatKind.fromKey(json.optString("repeat", RepeatKind.Daily.key)),
            intervalMinutes = json.optInt("intervalMinutes", 60),
            enabled = json.optBoolean("enabled", true),
            nextAtMs = json.optLong("nextAtMs", 0L),
            lastRunAtMs = json.optLong("lastRunAtMs").takeIf { it > 0 },
            lastStatus = json.optString("lastStatus").takeIf { it.isNotEmpty() && it != "null" },
            lastError = json.optString("lastError").takeIf { it.isNotEmpty() && it != "null" },
            taskId = json.optString("taskId").takeIf { it.isNotEmpty() && it != "null" },
        )

        fun create(
            text: String,
            hour: Int,
            minute: Int,
            scope: WecomScope = WecomScope.Groups,
            repeat: RepeatKind = RepeatKind.Daily,
            intervalMinutes: Int = 60,
            taskId: String? = null,
        ): Schedule {
            val now = System.currentTimeMillis()
            val draft = Schedule(
                id = UUID.randomUUID().toString(),
                text = text,
                scope = scope,
                hour = hour,
                minute = minute,
                repeat = repeat,
                intervalMinutes = intervalMinutes,
                enabled = true,
                nextAtMs = now,
                taskId = taskId,
            )
            return draft.copy(nextAtMs = draft.nextAfter(now))
        }

        /** 下一次触发：今天的钟点已过就顺延到明天。 */
        fun nextOccurrence(hour: Int, minute: Int, nowMs: Long, zone: ZoneId = ZoneId.systemDefault()): Long {
            val now = Instant.ofEpochMilli(nowMs)
            val date = now.atZone(zone).toLocalDate()
            var at = date.atTime(LocalTime.of(hour, minute)).atZone(zone)
            if (!at.toInstant().isAfter(now)) {
                at = date.plusDays(1).atTime(LocalTime.of(hour, minute)).atZone(zone)
            }
            return at.toInstant().toEpochMilli()
        }

        /** 每小时的第 minute 分；这一分钟的整点已过就顺延到下一个小时。 */
        fun nextHourly(minute: Int, nowMs: Long, zone: ZoneId = ZoneId.systemDefault()): Long {
            val now = Instant.ofEpochMilli(nowMs)
            var at = now.atZone(zone).withMinute(minute).withSecond(0).withNano(0)
            if (!at.toInstant().isAfter(now)) at = at.plusHours(1)
            return at.toInstant().toEpochMilli()
        }
    }
}

class ScheduleStore(private val file: File) {

    constructor(context: Context) : this(File(context.filesDir, "schedules.json"))

    fun all(): List<Schedule> = synchronized(lock) {
        if (!file.exists()) return emptyList()
        val array = JSONArray(file.readText())
        (0 until array.length()).map { Schedule.from(array.getJSONObject(it)) }
    }

    private fun save(list: List<Schedule>) {
        val array = JSONArray()
        list.forEach { array.put(it.toJson()) }
        val temporary = File(file.parentFile, "${file.name}.tmp")
        try {
            FileOutputStream(temporary).use {
                it.write(array.toString(2).toByteArray(Charsets.UTF_8))
                it.fd.sync()
            }
            Files.move(
                temporary.toPath(), file.toPath(),
                StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING,
            )
        } finally {
            temporary.delete()
        }
    }

    fun upsert(schedule: Schedule): Unit = synchronized(lock) {
        val list = all().toMutableList()
        val index = list.indexOfFirst { it.id == schedule.id }
        if (index >= 0) list[index] = schedule else list += schedule
        save(list)
    }

    fun remove(id: String): Unit = synchronized(lock) {
        save(all().filterNot { it.id == id })
    }

    fun find(id: String): Schedule? = synchronized(lock) { all().firstOrNull { it.id == id } }

    fun update(id: String, transform: (Schedule) -> Schedule): Schedule? = synchronized(lock) {
        val current = find(id) ?: return null
        transform(current).also(::upsert)
    }

    /** Advance before execution so duplicate deliveries and process death cannot replay this alarm. */
    fun claimDue(id: String, nowMs: Long): Schedule? = synchronized(lock) {
        val current = find(id) ?: return null
        if (!current.enabled || current.nextAtMs > nowMs) return null
        upsert(current.copy(nextAtMs = current.nextAfter(nowMs)))
        current
    }

    private companion object {
        // Every entry point creates its own store; instance synchronization is not sufficient.
        val lock = Any()
    }
}
