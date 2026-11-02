package com.por.auto.agent.ai

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class AiParsingTest {

    @Test
    fun joinTrimsTrailingSlash() {
        assertEquals("https://x/v1/models", AiParsing.join("https://x/v1/", "models"))
        assertEquals("https://x/v1/models", AiParsing.join("  https://x/v1  ", "models"))
    }

    @Test
    fun joinRejectsEmptyBase() {
        assertThrows(AiException::class.java) { AiParsing.join("   ", "models") }
    }

    @Test
    fun joinRejectsUnsafeOrAmbiguousEndpoints() {
        listOf(
            "http://example.com/v1", "file:///tmp/key", "ftp://example.com",
            "https://user@example.com", "https://example.com/v1?token=secret",
            "https://example.com/v1#fragment", "not a url",
        ).forEach { base ->
            assertThrows(base, AiException::class.java) { AiParsing.join(base, "models") }
        }
        assertEquals("http://127.0.0.1:3425/v1/models", AiParsing.join("http://127.0.0.1:3425/v1", "models"))
    }

    @Test
    fun savedKeyReuseRequiresSameProviderAndEndpoint() {
        val config = AiConfig(provider = AiProvider.Anthropic, baseUrl = "https://a.example/v1/")
        assertTrue(config.sameEndpoint(AiProvider.Anthropic, " https://a.example/v1 "))
        assertEquals(false, config.sameEndpoint(AiProvider.OpenAiCompatible, "https://a.example/v1"))
        assertEquals(false, config.sameEndpoint(AiProvider.Anthropic, "https://b.example/v1"))
        assertEquals(false, config.sameEndpoint(AiProvider.Anthropic, "https://a.example/other"))
    }

    @Test
    fun modelsAreDeduplicatedAndSkipBlank() {
        val json = """{"data":[{"id":"a"},{"id":"b"},{"id":"a"},{"id":""},{}]}"""
        assertEquals(listOf("a", "b"), AiParsing.models(json))
    }

    @Test
    fun modelsRejectsUnexpectedShape() {
        assertThrows(AiException::class.java) { AiParsing.models("""{"object":"list"}""") }
        assertThrows(AiException::class.java) { AiParsing.models("not json") }
    }

    @Test
    fun openAiContentIsTrimmed() {
        val json = """{"choices":[{"message":{"role":"assistant","content":"  hi  "}}]}"""
        assertEquals("hi", AiParsing.openAiContent(json))
    }

    @Test
    fun openAiMissingContentFails() {
        assertThrows(AiException::class.java) { AiParsing.openAiContent("""{"choices":[]}""") }
        assertThrows(AiException::class.java) { AiParsing.openAiContent("""{"choices":[{"message":{"content":"  "}}]}""") }
    }

    @Test
    fun anthropicContentIsTrimmed() {
        val json = """{"content":[{"type":"text","text":" hello "}]}"""
        assertEquals("hello", AiParsing.anthropicContent(json))
    }

    @Test
    fun anthropicMissingContentFails() {
        assertThrows(AiException::class.java) { AiParsing.anthropicContent("""{"content":[]}""") }
    }

    @Test
    fun errorMessagePrefersApiDetail() {
        val message = AiParsing.errorMessage(401, """{"error":{"message":"bad key"}}""")
        assertTrue(message.contains("401"))
        assertTrue(message.contains("bad key"))
    }

    @Test
    fun errorMessageFallsBackToBody() {
        val message = AiParsing.errorMessage(500, "oops")
        assertTrue(message.contains("500"))
        assertTrue(message.contains("oops"))
    }

    @Test
    fun configReadyNeedsUrlModelAndKey() {
        assertTrue(AiConfig(baseUrl = "u", model = "m", hasKey = true).ready)
        assertEquals(false, AiConfig(baseUrl = "u", model = "m", hasKey = false).ready)
        assertEquals(false, AiConfig(baseUrl = "", model = "m", hasKey = true).ready)
        assertEquals(false, AiConfig(baseUrl = "u", model = "", hasKey = true).ready)
    }
}
