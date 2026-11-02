package com.por.auto.agent.ai

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

class AiException(message: String) : Exception(message)

/**
 * 只实现两种协议：OpenAI 兼容（/chat/completions、/models）和 Anthropic 兼容（/messages、/models）。
 * base URL 由用户填写，末尾斜杠会被去掉。
 */
class AiClient {

    suspend fun fetchModels(config: AiConfig, apiKey: String): List<String> = withContext(Dispatchers.IO) {
        val url = AiParsing.join(config.baseUrl, "models")
        val response = request(url, apiKey, config.provider, body = null)
        AiParsing.models(response)
    }

    suspend fun chat(config: AiConfig, apiKey: String, instruction: String): String =
        withContext(Dispatchers.IO) {
            when (config.provider) {
                AiProvider.OpenAiCompatible -> openAiChat(config, apiKey, instruction)
                AiProvider.Anthropic -> anthropicChat(config, apiKey, instruction)
            }
        }

    private fun openAiChat(config: AiConfig, apiKey: String, instruction: String): String {
        val body = JSONObject().apply {
            put("model", config.model)
            put("messages", JSONArray().apply {
                put(JSONObject().put("role", "system").put("content", SYSTEM_PROMPT))
                put(JSONObject().put("role", "user").put("content", instruction))
            })
            put("temperature", 0.3)
        }
        val response = request(
            AiParsing.join(config.baseUrl, "chat/completions"),
            apiKey,
            config.provider,
            body.toString(),
        )
        return AiParsing.openAiContent(response)
    }

    private fun anthropicChat(config: AiConfig, apiKey: String, instruction: String): String {
        val body = JSONObject().apply {
            put("model", config.model)
            put("max_tokens", 1024)
            put("system", SYSTEM_PROMPT)
            put("messages", JSONArray().apply {
                put(JSONObject().put("role", "user").put("content", instruction))
            })
        }
        val response = request(
            AiParsing.join(config.baseUrl, "messages"),
            apiKey,
            config.provider,
            body.toString(),
        )
        return AiParsing.anthropicContent(response)
    }

    private fun request(url: String, apiKey: String, provider: AiProvider, body: String?): String {
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            // Do not forward provider credentials to a redirect destination.
            instanceFollowRedirects = false
            requestMethod = if (body == null) "GET" else "POST"
            connectTimeout = 15_000
            readTimeout = 60_000
            setRequestProperty("Accept", "application/json")
            if (body != null) setRequestProperty("Content-Type", "application/json")
            when (provider) {
                AiProvider.OpenAiCompatible -> setRequestProperty("Authorization", "Bearer $apiKey")
                AiProvider.Anthropic -> {
                    setRequestProperty("x-api-key", apiKey)
                    setRequestProperty("anthropic-version", "2023-06-01")
                }
            }
        }
        try {
            if (body != null) connection.doOutput = true
            body?.let { connection.outputStream.use { out -> out.write(it.toByteArray(Charsets.UTF_8)) } }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use(BufferedReader::readText).orEmpty()
            if (code !in 200..299) throw AiException(AiParsing.errorMessage(code, text))
            return text
        } catch (e: AiException) {
            throw e
        } catch (e: IOException) {
            throw AiException("网络错误：${e.message ?: e.javaClass.simpleName}")
        } finally {
            connection.disconnect()
        }
    }

    private companion object {
        const val SYSTEM_PROMPT =
            "你在帮用户写一条发到企业微信群的短消息。只输出消息正文，不要解释、不要引号、不要 Markdown。"
    }
}
