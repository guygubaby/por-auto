package com.por.auto.agent.update

import com.por.auto.agent.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.BufferedReader
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** 自建后端：发版、运行日志、AI 配置、口令都在 por-auto.guygubaby.top。 */
object Backend {
    const val BASE_URL = "https://por-auto.guygubaby.top"

    /** 日志上传和配置下发的入网令牌；构建时从仓库外的 local.properties 注入。 */
    val ingestKey: String get() = BuildConfig.INGEST_KEY

    val enabled: Boolean get() = ingestKey.isNotBlank()
}

data class RemotePasscode(val version: Int)

data class RemoteAiConfig(
    val provider: String,
    val baseUrl: String,
    val model: String,
    val apiKey: String,
)

class BackendClient {

    suspend fun uploadRun(json: String) = withContext(Dispatchers.IO) {
        if (!Backend.enabled) return@withContext
        call(
            path = "/api/runs",
            method = "POST",
            body = json,
            ingestKey = true,
            passcodeSha = null,
        )
    }

    /** 服务端没配过口令时返回 null。 */
    suspend fun passcode(): RemotePasscode? = withContext(Dispatchers.IO) {
        if (!Backend.enabled) return@withContext null
        val text = call("/api/passcode", "GET", null, ingestKey = true, passcodeSha = null) ?: return@withContext null
        val json = JSONObject(text)
        RemotePasscode(json.optInt("version"))
    }

    /** 口令不对会返回 401，[UpdateException] 里带说明。 */
    suspend fun aiConfig(passcodeSha: String): RemoteAiConfig? = withContext(Dispatchers.IO) {
        if (!Backend.enabled) return@withContext null
        val text = call("/api/config", "GET", null, ingestKey = true, passcodeSha = passcodeSha)
            ?: return@withContext null
        val json = JSONObject(text)
        RemoteAiConfig(
            provider = json.optString("provider"),
            baseUrl = json.optString("baseUrl"),
            model = json.optString("model"),
            apiKey = json.optString("apiKey"),
        )
    }

    /** 返回 null 表示服务端还没有这条数据（404）。 */
    private fun call(
        path: String,
        method: String,
        body: String?,
        ingestKey: Boolean,
        passcodeSha: String?,
    ): String? {
        val connection = (URL(Backend.BASE_URL + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 15_000
            readTimeout = 30_000
            setRequestProperty("Accept", "application/json")
            if (ingestKey) setRequestProperty("x-ingest-key", Backend.ingestKey)
            passcodeSha?.let { setRequestProperty("x-passcode-sha256", it) }
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
            if (code == 401) throw UpdateException("口令不对")
            if (code !in 200..299) throw UpdateException("服务端返回 HTTP $code")
            text
        } catch (e: IOException) {
            throw UpdateException("网络错误：${e.message ?: e.javaClass.simpleName}")
        } finally {
            connection.disconnect()
        }
    }
}
