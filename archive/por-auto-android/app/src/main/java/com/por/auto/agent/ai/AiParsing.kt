package com.por.auto.agent.ai

import org.json.JSONObject
import java.net.URI

data class AiPlan(val text: String, val scopeKey: String?)

private val SCOPE_KEYS = setOf("groups", "direct", "both")

/** 纯函数：URL 拼接与两种协议的响应解析，方便单测。 */
object AiParsing {

    fun join(base: String, path: String): String {
        val trimmed = base.trim().trimEnd('/')
        if (trimmed.isEmpty()) throw AiException("Base URL 不能为空")
        val uri = runCatching { URI(trimmed) }.getOrNull()
            ?: throw AiException("Base URL 格式无效")
        if (uri.host.isNullOrBlank() || uri.rawUserInfo != null ||
            uri.rawQuery != null || uri.rawFragment != null ||
            (uri.scheme != "https" && uri.scheme != "http")
        ) {
            throw AiException("Base URL 必须是 http(s) 地址，且不能包含账号、查询参数或片段")
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

    /**
     * 把模型回复解析成「正文 + 范围」。模型经常带 ```json 围栏或前后解释，
     * 只要能抠出第一个对象就用它；抠不出来就整段当正文，范围留空由用户选。
     */
    fun plan(reply: String): AiPlan {
        if (reply.isBlank()) throw AiException("返回里没有消息内容")
        val start = reply.indexOf('{')
        val end = reply.lastIndexOf('}')
        val json = if (start >= 0 && end > start) {
            runCatching { JSONObject(reply.substring(start, end + 1)) }.getOrNull()
        } else {
            null
        } ?: return AiPlan(reply.trim(), null)
        val text = json.optString("message").ifBlank { json.optString("text") }.trim()
        if (text.isEmpty()) throw AiException("返回里没有消息内容")
        val scope = json.optString("scope").trim().lowercase().takeIf { it in SCOPE_KEYS }
        return AiPlan(text, scope)
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
