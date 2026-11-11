package com.por.auto.agent.update

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.io.File

/**
 * 日志上报是附带动作：只排队，不占发送流程的时间。
 * 上传成功会在旁边留一个 .sent 标记，下次启动时把没标记的补传一次。
 */
object RunUploads {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    fun enqueue(file: File) {
        if (!Backend.enabled) return
        scope.launch { upload(file) }
    }

    /** 启动时补传上次没传成功的记录。 */
    fun retryPending(context: Context) {
        if (!Backend.enabled) return
        val dir = File(context.filesDir, "runs")
        val pending = dir.listFiles { f ->
            f.isFile && f.name.startsWith("run-") && f.name.endsWith(".json") && !marker(f).exists()
        } ?: return
        pending.take(20).forEach { file -> scope.launch { upload(file) } }
    }

    private suspend fun upload(file: File) {
        val ok = runCatching { BackendClient().uploadRun(file.readText()) }.isSuccess
        if (ok) runCatching { marker(file).createNewFile() }
    }

    private fun marker(file: File) = File(file.parentFile, "${file.name}.sent")
}
