package com.por.auto.agent.wecom

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

data class RunRecord(
    val id: String,
    val finishedAt: Long,
    val dryRun: Boolean,
    val completed: Int,
    val failed: Int,
    val error: String?,
    val targets: List<RecipientResult>,
)

/** P1 运行记录：最近一次 + 历史，保存在 filesDir/runs。 */
class RunStore(private val dir: File) {

    constructor(context: Context) : this(File(context.filesDir, "runs"))

    /** 日志页用：按时间倒序。 */
    fun history(limit: Int = 50): List<RunRecord> {
        return dir.listFiles { f -> f.name.startsWith("run-") && f.name.endsWith(".json") }
            ?.sortedByDescending { it.lastModified() }
            ?.take(limit)
            ?.mapNotNull { file -> runCatching { parse(JSONObject(file.readText()), file.name) }.getOrNull() }
            .orEmpty()
    }

    private fun parse(root: JSONObject, id: String): RunRecord {
        val targets = root.optJSONArray("targets") ?: JSONArray()
        val results = (0 until targets.length()).mapNotNull { i ->
            val item = targets.optJSONObject(i) ?: return@mapNotNull null
            RecipientResult(
                title = item.optString("title"),
                scope = WecomScope.Groups,
                status = item.optString("status"),
                error = item.optString("error").takeIf { it.isNotEmpty() && it != "null" },
            )
        }
        return RunRecord(
            id = id,
            finishedAt = root.optLong("finishedAt"),
            dryRun = root.optBoolean("dryRun"),
            completed = root.optInt("completed"),
            failed = root.optInt("failed"),
            error = root.optString("error").takeIf { it.isNotEmpty() && it != "null" },
            targets = results,
        )
    }

    fun save(result: BroadcastResult): File = synchronized(lock) {
        val root = JSONObject().apply {
            put("finishedAt", System.currentTimeMillis())
            put("dryRun", result.dryRun)
            put("error", result.error ?: JSONObject.NULL)
            put("completed", result.completed)
            put("failed", result.failed)
            put("targets", JSONArray().apply {
                result.results.forEach { target ->
                    put(JSONObject().apply {
                        put("title", target.title)
                        put("scope", target.scope.name.lowercase())
                        put("status", target.status)
                        put("error", target.error ?: JSONObject.NULL)
                    })
                }
            })
        }
        dir.mkdirs()
        val file = File.createTempFile("run-", ".json", dir)
        file.writeText(root.toString(2))
        File(dir, "latest.json").writeText(root.toString(2))
        dir.listFiles { f -> f.name.startsWith("run-") && f.name.endsWith(".json") }
            ?.sortedByDescending { it.lastModified() }
            ?.drop(50)
            ?.forEach { it.delete() }
        file
    }

    /** 读最近一次记录，供 App 重启后仍能看到上次结果。 */
    fun latest(): BroadcastResult? = synchronized(lock) {
        runCatching {
            val file = File(dir, "latest.json")
            if (!file.isFile) return null
            val record = parse(JSONObject(file.readText()), file.name)
            BroadcastResult(
                dryRun = record.dryRun,
                results = record.targets,
                error = record.error,
            )
        }.getOrNull()
    }

    private companion object {
        val lock = Any()
    }
}
