package com.por.auto.agent.ai

import org.json.JSONObject
import java.net.URI

/** 纯函数：URL 拼接与两种协议的响应解析，方便单测。 */
object AiParsing {

    fun join(base: String, path: String): String {
        val trimmed = base.trim().trimEnd('/')
        if (trimmed.isEmpty()) throw AiException("Base URL 不能为空")
        val uri = runCatching { URI(trimmed) }.getOrNull()
            ?: throw AiException("Base URL 格式无效")
        val local = uri.host in setOf("localhost", "127.0.0.1", "10.0.2.2")
        if (uri.host.isNullOrBlank() || uri.rawUserInfo != null ||
            uri.rawQuery != null || uri.rawFragment != null ||
            (uri.scheme != "https" && !(uri.scheme == "http" && local))
        ) {
            throw AiException("Base URL 必须使用 HTTPS，且不能包含账号、查询参数或片段")
        }
        return "$trimmed/$path"
    }

    /** OpenAI / Anthropic 的 /models 都是 { data: [ { id } ] }。 */
    fun models(json: String): List<String> {
        val data = runCatching { JSONObject(json).optJSONArray("data") }.getOrNull()
            ?: throw AiException("返回格式不是模型列表")
        return (0 until data.length()).mapNotNull { i ->
            data.optJSONObject(i)?.optString("id")?.takeIf { it.isNotBlank() }
        }.distinct()
    }

    fun openAiContent(json: String): String {
        val text = runCatching {
            JSONObject(json).getJSONArray("choices").getJSONObject(0)
                .getJSONObject("message").optString("content")
        }.getOrNull()
        if (text.isNullOrBlank()) throw AiException("返回里没有消息内容")
        return text.trim()
    }

    fun anthropicContent(json: String): String {
        val text = runCatching {
            JSONObject(json).getJSONArray("content").getJSONObject(0).optString("text")
        }.getOrNull()
        if (text.isNullOrBlank()) throw AiException("返回里没有消息内容")
        return text.trim()
    }

    /** 错误响应里带 message 时给出更具体的原因。 */
    fun errorMessage(code: Int, body: String): String {
        val detail = runCatching {
            val root = JSONObject(body)
            (root.optJSONObject("error")?.optString("message"))
                ?: root.optString("message")
        }.getOrNull()?.takeIf { it.isNotBlank() }
        return "HTTP $code：${detail ?: body.take(300).ifBlank { "无返回内容" }}"
    }
}
