package com.por.auto.agent.ai

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
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
 * OpenCode Go 走 OpenAI 协议，另加应用自己的 User-Agent 和固定的 x-opencode-session 会话头。
 * base URL 由用户填写，末尾斜杠会被去掉。
 */
class AiClient {

    suspend fun fetchModels(config: AiConfig, apiKey: String): List<String> = withContext(Dispatchers.IO) {
        val url = AiParsing.join(config.baseUrl, "models")
        val response = request(url, apiKey, config, body = null)
        AiParsing.models(response)
    }

    suspend fun chat(config: AiConfig, apiKey: String, instruction: String): String =
        complete(config, apiKey, instruction, SYSTEM_PROMPT)

    /** 让模型把一句话变成「正文 + 范围」。只填表，不执行任何动作。 */
    suspend fun plan(config: AiConfig, apiKey: String, instruction: String): AiPlan =
        AiParsing.plan(complete(config, apiKey, instruction, PLAN_PROMPT))

    /** 助手：根据目标和当前屏幕给出下一步动作。 */
    suspend fun act(config: AiConfig, apiKey: String, instruction: String): String =
        complete(config, apiKey, instruction, AGENT_PROMPT)

    private suspend fun complete(
        config: AiConfig,
        apiKey: String,
        instruction: String,
        system: String,
    ): String = withContext(Dispatchers.IO) {
        var attempt = 0
        while (true) {
            try {
                return@withContext when (config.provider) {
                    AiProvider.OpenAiCompatible, AiProvider.OpenCodeGo ->
                        openAiChat(config, apiKey, instruction, system)
                    AiProvider.Anthropic -> anthropicChat(config, apiKey, instruction, system)
                }
            } catch (e: AiException) {
                // 只有限流、服务端出错、网络断了值得再试；Key 错、额度用完、模型名不对再试也一样。
                if (attempt >= MAX_RETRIES || !transient(e)) throw e
                delay(1_000L shl attempt)
                attempt++
            }
        }
        @Suppress("UNREACHABLE_CODE")
        ""
    }

    private fun transient(e: AiException): Boolean {
        val message = e.message.orEmpty()
        return message.contains("网络错误") ||
            message.contains("HTTP 429") ||
            Regex("HTTP 5\\d\\d").containsMatchIn(message)
    }

    private fun openAiChat(config: AiConfig, apiKey: String, instruction: String, system: String): String {
        val body = JSONObject().apply {
            put("model", config.model)
            put("messages", JSONArray().apply {
                put(JSONObject().put("role", "system").put("content", system))
                put(JSONObject().put("role", "user").put("content", instruction))
            })
            put("temperature", 0.3)
        }
        val response = request(
            AiParsing.join(config.baseUrl, "chat/completions"),
            apiKey,
            config,
            body.toString(),
        )
        return AiParsing.openAiContent(response)
    }

    private fun anthropicChat(config: AiConfig, apiKey: String, instruction: String, system: String): String {
        val body = JSONObject().apply {
            put("model", config.model)
            put("max_tokens", 1024)
            put("system", system)
            put("messages", JSONArray().apply {
                put(JSONObject().put("role", "user").put("content", instruction))
            })
        }
        val response = request(
            AiParsing.join(config.baseUrl, "messages"),
            apiKey,
            config,
            body.toString(),
        )
        return AiParsing.anthropicContent(response)
    }

    private fun request(url: String, apiKey: String, config: AiConfig, body: String?): String {
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            // Do not forward provider credentials to a redirect destination.
            instanceFollowRedirects = false
            requestMethod = if (body == null) "GET" else "POST"
            connectTimeout = 15_000
            readTimeout = 60_000
            setRequestProperty("Accept", "application/json")
            if (body != null) setRequestProperty("Content-Type", "application/json")
            when (config.provider) {
                AiProvider.OpenAiCompatible -> setRequestProperty("Authorization", "Bearer $apiKey")
                AiProvider.Anthropic -> {
                    setRequestProperty("x-api-key", apiKey)
                    setRequestProperty("anthropic-version", "2023-06-01")
                }
                // OpenCode Go 要求按编程 Agent 识别：自己的 UA + 稳定的会话头。
                AiProvider.OpenCodeGo -> {
                    setRequestProperty("Authorization", "Bearer $apiKey")
                    setRequestProperty("User-Agent", USER_AGENT)
                    config.sessionId.takeIf { it.isNotBlank() }?.let {
                        setRequestProperty("x-opencode-session", it)
                    }
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
        const val USER_AGENT = "PorAuto-Agent/0.1.0"
        const val MAX_RETRIES = 3

        const val SYSTEM_PROMPT =
            "你在帮用户写一条发到企业微信群的短消息。只输出消息正文，不要解释、不要引号、不要 Markdown。"

        const val PLAN_PROMPT =
            "把用户的要求整理成一条企业微信群发。只输出 JSON，不要解释、不要 Markdown。" +
                "格式：{\"message\":\"要发送的正文\",\"scope\":\"groups|direct|both\"}。" +
                "scope 取值：groups=全部群聊，direct=全部单聊，both=全部会话。" +
                "用户没说范围时用 groups。message 必须是可直接发送的正文。"

        const val AGENT_PROMPT =
            "你在手机上帮用户操作界面。每一步只输出一个 JSON 动作，不要解释、不要 Markdown。\n" +
                "动作：\n" +
                "{\"action\":\"tap\",\"index\":3} 点击第 3 个控件\n" +
                "{\"action\":\"input\",\"index\":5,\"text\":\"你好\"} 在第 5 个控件输入文字，index 可省略（默认当前焦点）\n" +
                "{\"action\":\"back\"} 返回\n" +
                "{\"action\":\"scroll\",\"direction\":\"down\"} 滚动\n" +
                "{\"action\":\"wait\",\"ms\":1000} 等待\n" +
                "{\"action\":\"open\",\"package\":\"com.tencent.wework\"} 打开应用\n" +
                "{\"action\":\"done\",\"summary\":\"结果\"} 目标完成\n" +
                "{\"action\":\"stop\",\"reason\":\"原因\"} 做不到或不该继续\n" +
                "规则：index 只能来自当前屏幕列表；" +
                "发消息、打开应用、切换页面、输入文字、点发送都直接做，不要停下来征求确认，也不要替你判断哪些群不该发；" +
                "只有付款、转账、删除、注销、卸载、恢复出厂、格式化、退出登录这类有金钱风险或不可撤销的操作才用 stop；" +
                "不要重复已经做过且没效果的动作；完成或无法继续时用 done / stop 结束。"
    }
}
