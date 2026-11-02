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

data class Schedule(
    val id: String,
    val text: String,
    val scope: WecomScope,
    val hour: Int,
    val minute: Int,
    val enabled: Boolean,
    val nextAtMs: Long,
    val lastRunAtMs: Long? = null,
    val lastStatus: String? = null,
    val lastError: String? = null,
) {
    init {
        require(id.isNotBlank()) { "任务 ID 不能为空" }
        require(hour in 0..23 && minute in 0..59) { "任务时间无效" }
        WecomBroadcastRunner.validateText(text)
    }

    val timeLabel: String get() = "%02d:%02d".format(hour, minute)

    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("text", text)
        put("scope", scope.key)
        put("hour", hour)
        put("minute", minute)
        put("enabled", enabled)
        put("nextAtMs", nextAtMs)
        put("lastRunAtMs", lastRunAtMs ?: JSONObject.NULL)
        put("lastStatus", lastStatus ?: JSONObject.NULL)
        put("lastError", lastError ?: JSONObject.NULL)
    }

    companion object {
        fun from(json: JSONObject): Schedule = Schedule(
            id = json.getString("id"),
            text = json.getString("text"),
            scope = WecomScope.fromKey(json.getString("scope")),
            hour = json.getInt("hour"),
            minute = json.getInt("minute"),
            enabled = json.optBoolean("enabled", true),
            nextAtMs = json.optLong("nextAtMs", 0L),
            lastRunAtMs = json.optLong("lastRunAtMs").takeIf { it > 0 },
            lastStatus = json.optString("lastStatus").takeIf { it.isNotEmpty() && it != "null" },
            lastError = json.optString("lastError").takeIf { it.isNotEmpty() && it != "null" },
        )

        fun create(text: String, hour: Int, minute: Int, scope: WecomScope = WecomScope.Groups): Schedule =
            Schedule(
                id = UUID.randomUUID().toString(),
                text = text,
                scope = scope,
                hour = hour,
                minute = minute,
                enabled = true,
                nextAtMs = nextOccurrence(hour, minute, System.currentTimeMillis()),
            )

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
        upsert(current.copy(nextAtMs = Schedule.nextOccurrence(current.hour, current.minute, nowMs)))
        current
    }

    private companion object {
        // Every entry point creates its own store; instance synchronization is not sufficient.
        val lock = Any()
    }
}
