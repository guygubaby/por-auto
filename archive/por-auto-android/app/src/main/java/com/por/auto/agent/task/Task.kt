package com.por.auto.agent.task

import android.content.Context
import com.por.auto.agent.wecom.WecomScope
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.UUID

enum class TaskKind(val key: String, val label: String) {
    /** 一句话目标，由 AI 助手看着屏幕执行。 */
    Agent("agent", "AI 操作"),

    /** 企业微信群发：先试运行，再正式发送。 */
    Wecom("wecom", "企业微信群发"),
    ;

    companion object {
        fun fromKey(key: String): TaskKind = entries.firstOrNull { it.key == key } ?: Agent
    }
}

/** 一个可反复执行的自动化任务：AI 操作用 prompt，群发用 message + scope。 */
data class Task(
    val id: String,
    val title: String,
    val kind: TaskKind,
    val prompt: String = "",
    val message: String = "",
    val scope: WecomScope = WecomScope.Groups,
    val createdAt: Long = System.currentTimeMillis(),
    val lastRunAt: Long? = null,
    val lastStatus: String? = null,
    val lastError: String? = null,
) {
    val summary: String
        get() = when (kind) {
            TaskKind.Agent -> prompt
            TaskKind.Wecom -> "${scope.label} · $message"
        }

    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("title", title)
        put("kind", kind.key)
        put("prompt", prompt)
        put("message", message)
        put("scope", scope.key)
        put("createdAt", createdAt)
        put("lastRunAt", lastRunAt ?: JSONObject.NULL)
        put("lastStatus", lastStatus ?: JSONObject.NULL)
        put("lastError", lastError ?: JSONObject.NULL)
    }

    companion object {
        fun from(json: JSONObject): Task = Task(
            id = json.getString("id"),
            title = json.optString("title").ifBlank { "未命名任务" },
            kind = TaskKind.fromKey(json.optString("kind")),
            prompt = json.optString("prompt"),
            message = json.optString("message"),
            scope = runCatching { WecomScope.fromKey(json.optString("scope")) }
                .getOrDefault(WecomScope.Groups),
            createdAt = json.optLong("createdAt", 0L),
            lastRunAt = json.optLong("lastRunAt").takeIf { it > 0 },
            lastStatus = json.optString("lastStatus").takeIf { it.isNotEmpty() && it != "null" },
            lastError = json.optString("lastError").takeIf { it.isNotEmpty() && it != "null" },
        )

        fun create(
            title: String,
            kind: TaskKind,
            prompt: String = "",
            message: String = "",
            scope: WecomScope = WecomScope.Groups,
        ): Task = Task(
            id = UUID.randomUUID().toString(),
            title = title.trim().ifBlank {
                when (kind) {
                    TaskKind.Agent -> prompt.trim().take(20)
                    TaskKind.Wecom -> message.trim().take(20)
                }.ifBlank { "未命名任务" }
            },
            kind = kind,
            prompt = prompt.trim(),
            message = message.trim(),
            scope = scope,
        )
    }
}

class TaskStore(private val file: File) {

    constructor(context: Context) : this(File(context.filesDir, "tasks.json"))

    fun all(): List<Task> = synchronized(lock) {
        if (!file.exists()) return emptyList()
        val array = JSONArray(file.readText())
        (0 until array.length()).map { Task.from(array.getJSONObject(it)) }
    }

    private fun save(list: List<Task>) {
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

    fun upsert(task: Task): Unit = synchronized(lock) {
        val list = all().toMutableList()
        val index = list.indexOfFirst { it.id == task.id }
        if (index >= 0) list[index] = task else list += task
        save(list)
    }

    fun remove(id: String): Unit = synchronized(lock) {
        save(all().filterNot { it.id == id })
    }

    fun find(id: String): Task? = synchronized(lock) { all().firstOrNull { it.id == id } }

    fun update(id: String, transform: (Task) -> Task): Task? = synchronized(lock) {
        val current = find(id) ?: return null
        transform(current).also(::upsert)
    }

    private companion object {
        val lock = Any()
    }
}
