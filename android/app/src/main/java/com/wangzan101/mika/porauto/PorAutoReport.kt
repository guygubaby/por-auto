package com.wangzan101.mika.porauto

import android.content.Context
import android.os.Build
import android.util.Log
import com.wangzan101.mika.BuildConfig
import com.wangzan101.mika.core.agent.TaskState
import com.wangzan101.mika.core.net.NetProxy
import com.wangzan101.mika.core.record.RunEvent
import com.wangzan101.mika.core.record.Redactor
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Call
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.TimeUnit

/** 运行日志上报里的一步：做了什么、结果如何。 */
data class ReportStep(
    val atMs: Long,
    val step: Int,
    val kind: String,
    val label: String,
    val target: String?,
    val effect: String?,
    val failed: Boolean,
)

/** 一次任务的完整上下文，和 por-auto 后端 `/api/runs` 的字段对应。 */
data class RunReport(
    val runId: String?,
    val goal: String,
    val outcome: String,
    val error: String?,
    val startedAtMs: Long,
    val finishedAtMs: Long,
    val steps: List<ReportStep>,
)

/**
 * 把任务执行记录发到 por-auto 后端。上报是附带动作：只排队，不占任务收尾的时间；
 * 上传成功就删掉排队文件，失败留到下次启动再补传（最多保留 [MAX_PENDING] 条）。
 * 用户可以在 设置 › 高级与其他 › 服务端 关掉。
 */
object PorAutoReport {
    private const val TAG = "PorAutoReport"
    private const val PREFS = "porauto-report"
    private const val KEY_ENABLED = "enabled"
    private const val DIR = "porauto-runs"
    private const val MAX_PENDING = 50
    private const val MAX_RETRY = 20

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val uploads = Mutex()
    private var activeCall: Call? = null
    private val jsonType = "application/json; charset=utf-8".toMediaType()

    private val client: OkHttpClient by lazy {
        NetProxy.shared.client(
            OkHttpClient.Builder()
                .connectTimeout(15, TimeUnit.SECONDS)
                .readTimeout(30, TimeUnit.SECONDS)
                .callTimeout(45, TimeUnit.SECONDS),
        )
    }

    /** 上报开关；构建时没注入入网令牌时整体不可用。 */
    fun enabled(context: Context): Boolean =
        PorAutoBackend.enabled && context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_ENABLED, true)

    @Synchronized
    fun setEnabled(context: Context, enabled: Boolean) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_ENABLED, enabled).apply()
        if (!enabled) activeCall?.cancel()
    }

    /** 任务收尾时调；[end] 是终态，[activities] 是这次实际做过的动作。 */
    fun onRunEnded(
        context: Context,
        runId: String?,
        goal: String,
        end: TaskState,
        activities: List<RunEvent.Activity>,
    ) {
        if (!enabled(context)) return
        val now = System.currentTimeMillis()
        val report = RunReport(
            runId = runId,
            goal = goal,
            outcome = when (end) {
                is TaskState.Succeeded -> if (end.doubtful) "unverified" else "succeeded"
                is TaskState.Failed -> "failed"
                TaskState.Cancelled -> "cancelled"
                else -> "finished"
            },
            error = (end as? TaskState.Failed)?.reason,
            startedAtMs = activities.firstOrNull()?.atMs ?: now,
            finishedAtMs = now,
            steps = activities.map {
                ReportStep(
                    atMs = it.atMs,
                    step = it.step,
                    kind = it.kind,
                    label = it.label,
                    target = it.target,
                    effect = it.effect,
                    failed = it.failed,
                )
            },
        )
        val payload = payload(report, device()).toString()
        scope.launch {
            runCatching {
                // 先落盘，再等旧记录上传；慢网络不能让新记录只留在内存里。
                val file = synchronized(this@PorAutoReport) {
                    if (!enabled(context)) return@launch
                    enqueue(File(context.filesDir, DIR), payload)
                }
                uploads.withLock { upload(context, file) }
            }.onFailure { Log.w(TAG, "could not report run", it) }
        }
    }

    /** 启动时补传上次没传成功的记录。 */
    fun retryPending(context: Context) {
        if (!enabled(context)) return
        scope.launch {
            uploads.withLock {
                val dir = File(context.filesDir, DIR)
                dir.listFiles { f -> f.name.startsWith("run-") && f.name.endsWith(".json") }
                    ?.sortedBy { it.lastModified() }
                    ?.take(MAX_RETRY)
                    ?.forEach { runCatching { upload(context, it) }.onFailure { e -> Log.w(TAG, "could not upload ${it.name}", e) } }
            }
        }
    }

    @Synchronized
    internal fun enqueue(dir: File, payload: String): File {
        check(dir.mkdirs() || dir.isDirectory)
        val partial = File.createTempFile("run-", ".tmp", dir)
        val file = File(dir, partial.name.removeSuffix(".tmp") + ".json")
        try {
            partial.writeText(payload)
            check(partial.renameTo(file))
        } finally {
            partial.delete()
        }
        dir.listFiles { f -> f.name.startsWith("run-") && f.name.endsWith(".json") }
            ?.sortedByDescending { it.lastModified() }
            ?.drop(MAX_PENDING)
            ?.forEach { it.delete() }
        return file
    }

    private fun upload(context: Context, file: File) {
        val call = synchronized(this) {
            if (!enabled(context) || !file.isFile) return
            val request = Request.Builder()
                .url(PorAutoBackend.RUNS_URL)
                .header("x-ingest-key", PorAutoBackend.ingestKey)
                .post(Redactor.text(file.readText()).toRequestBody(jsonType))
                .build()
            client.newCall(request).also { activeCall = it }
        }
        try {
            if (call.execute().use { it.isSuccessful }) file.delete()
        } finally {
            synchronized(this) { activeCall = null }
        }
    }

    private fun device(): JsonObject = buildJsonObject {
        put("model", Build.MODEL)
        put("manufacturer", Build.MANUFACTURER)
        put("android", Build.VERSION.RELEASE)
        put("sdk", Build.VERSION.SDK_INT)
        put("appVersion", BuildConfig.VERSION_NAME)
        put("build", BuildConfig.GIT_HASH)
    }

    /** 纯函数，便于单测：把一次运行整理成后端能读的 JSON。 */
    internal fun payload(report: RunReport, device: JsonObject): JsonObject {
        val time = SimpleDateFormat("HH:mm:ss", Locale.US).apply { timeZone = TimeZone.getDefault() }
        fun clock(atMs: Long) = time.format(Date(atMs))
        return buildJsonObject {
            put("startedAt", report.startedAtMs)
            put("finishedAt", report.finishedAtMs)
            put("kind", "assistant")
            put("scope", "phone")
            put("text", Redactor.text(report.goal))
            put("dryRun", false)
            report.runId?.let { put("runId", it) }
            report.error?.let { put("error", Redactor.text(it)) }
            put("device", device)
            putJsonArray("results") {
                report.steps.forEach { step ->
                    add(
                        buildJsonObject {
                            val target = step.target?.takeIf { it.isNotBlank() }
                            put("title", Redactor.text(buildString {
                                append("第").append(step.step).append("步 ").append(step.label)
                                if (target != null) append(" · ").append(target)
                            }))
                            put("status", if (step.failed) "failed" else "done")
                            if (step.failed) put("error", Redactor.text(step.effect ?: "没有效果"))
                        },
                    )
                }
            }
            putJsonArray("log") {
                report.steps.forEach { step ->
                    add(JsonPrimitive(
                        Redactor.text(buildString {
                            append(clock(step.atMs)).append(' ')
                            append("第").append(step.step).append("步 ")
                            append(step.kind).append(' ').append(step.label)
                            step.target?.takeIf { it.isNotBlank() }?.let { append(" · ").append(it) }
                            step.effect?.takeIf { it.isNotBlank() }?.let { append(" → ").append(it) }
                        }),
                    ))
                }
                add(JsonPrimitive(
                    Redactor.text(buildString {
                        append(clock(report.finishedAtMs)).append(" 结束：").append(report.outcome)
                        report.error?.takeIf { it.isNotBlank() }?.let { append(" · ").append(it) }
                    }),
                ))
            }
        }
    }
}
