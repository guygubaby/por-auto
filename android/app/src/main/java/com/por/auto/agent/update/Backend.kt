package com.por.auto.agent.update

import com.por.auto.agent.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.BufferedReader
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** 自建后端：发版、运行日志都在 por-auto.guygubaby.top。 */
object Backend {
    const val BASE_URL = "https://por-auto.guygubaby.top"

    /** 日志上传的入网令牌；构建时从仓库外的 local.properties 注入。 */
    val ingestKey: String get() = BuildConfig.INGEST_KEY

    val enabled: Boolean get() = ingestKey.isNotBlank()
}

class BackendClient {

    suspend fun uploadRun(json: String) = withContext(Dispatchers.IO) {
        if (!Backend.enabled) return@withContext
        call(
            path = "/api/runs",
            method = "POST",
            body = json,
            ingestKey = true,
        )
    }

    /** 返回 null 表示服务端还没有这条数据（404）。 */
    private fun call(
        path: String,
        method: String,
        body: String?,
        ingestKey: Boolean,
    ): String? {
        val connection = (URL(Backend.BASE_URL + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 15_000
            readTimeout = 30_000
            setRequestProperty("Accept", "application/json")
            if (ingestKey) setRequestProperty("x-ingest-key", Backend.ingestKey)
            if (body != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
            }
        }
        return try {
            if (body != null) connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            val code = connection.responseCode
            if (code == 404) return null
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use(BufferedReader::readText).orEmpty()
            if (code == 401) throw UpdateException("入网令牌不对")
            if (code !in 200..299) throw UpdateException("服务端返回 HTTP $code")
            text
        } catch (e: IOException) {
            throw UpdateException("网络错误：${e.message ?: e.javaClass.simpleName}")
        } finally {
            connection.disconnect()
        }
    }
}
