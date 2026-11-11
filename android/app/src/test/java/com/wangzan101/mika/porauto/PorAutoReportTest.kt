package com.wangzan101.mika.porauto

import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import org.junit.Test

class PorAutoReportTest {
    @Test
    fun redactsCredentialsBeforeQueuingOrUploading() {
        val token = "sk-" + "a".repeat(24)
        val report = RunReport(
            "run-1", "use $token", "failed", "Bearer abcdefghijklmnop", 0, 1,
            listOf(ReportStep(0, 1, "tap", token, token, token, true)),
        )
        val payload = PorAutoReport.payload(report, buildJsonObject {}).toString()
        assertFalse(payload.contains(token))
        assertFalse(payload.contains("abcdefghijklmnop"))
        assertTrue(payload.contains("***"))
    }

    @Test
    fun payloadKeepsStepsAndCounts() {
        val report = RunReport(
            runId = "run-1",
            goal = "打开设置",
            outcome = "failed",
            error = "找不到按钮",
            startedAtMs = 0,
            finishedAtMs = 3_600_000,
            steps = listOf(
                ReportStep(0, 1, "tap", "点击", "设置", null, false),
                ReportStep(60_000, 2, "tap", "点击", "关于", "画面没有变化", true),
            ),
        )
        val payload = PorAutoReport.payload(report, buildJsonObject { put("model", "test") })

        assertEquals("assistant", payload["kind"]!!.jsonPrimitive.content)
        assertEquals("打开设置", payload["text"]!!.jsonPrimitive.content)
        assertEquals("找不到按钮", payload["error"]!!.jsonPrimitive.content)
        assertEquals("test", payload["device"]!!.jsonObject["model"]!!.jsonPrimitive.content)
        val results = payload["results"]!!.jsonArray
        assertEquals(2, results.size)
        assertEquals("done", results[0].jsonObject["status"]!!.jsonPrimitive.content)
        assertEquals("failed", results[1].jsonObject["status"]!!.jsonPrimitive.content)
        assertEquals("画面没有变化", results[1].jsonObject["error"]!!.jsonPrimitive.content)
        val log = payload["log"]!!.jsonArray
        assertEquals(3, log.size)
        assertTrue(log.last().jsonPrimitive.content.contains("结束：failed"))
    }
}
