package com.wangzan101.mika.porauto

import com.wangzan101.mika.core.model.ModelRole
import com.wangzan101.mika.settings.AesGcmKeyCipher
import com.wangzan101.mika.settings.ProviderConfig
import com.wangzan101.mika.settings.ProviderStore
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.util.Base64
import javax.crypto.KeyGenerator

class LegacyProviderTest {
    @get:Rule val temp = TemporaryFolder()
    private val cipher = AesGcmKeyCipher { key }
    private val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    private fun legacy(provider: String = "OpenAiCompatible") = mapOf(
        "provider" to provider, "baseUrl" to "https://gateway.example/v1", "model" to "my-model",
        "secret" to Base64.getEncoder().encodeToString(cipher.encrypt("test-key".toByteArray())),
    )

    @Test fun importsEveryOldProtocolAndPersistsWithoutReplacingCurrentConfiguration() {
        for (protocol in listOf("OpenAiCompatible", "Anthropic", "OpenCodeGo")) {
            val dir = temp.newFolder()
            val store = ProviderStore(dir, cipher)
            assertTrue(importLegacyProvider(store, legacy(protocol), cipher))
            val reloaded = ProviderStore(dir, cipher)
            val config = reloaded.configFor(ModelRole.Main)!!
            assertEquals("my-model", config.model)
            assertEquals("https://gateway.example/v1", config.baseUrl)
            assertEquals(if (protocol == "Anthropic") ProviderConfig.Kind.Anthropic else ProviderConfig.Kind.OpenAiCompat, config.kind)
            assertEquals("test-key", reloaded.apiKey(config.id))
            assertEquals(if (protocol == "OpenCodeGo") "x-opencode-session" else null,
                reloaded.providers.value.single().sessionHeader)
            assertFalse(importLegacyProvider(reloaded, legacy("Anthropic") + ("model" to "other"), cipher))
            assertEquals(config, reloaded.configFor(ModelRole.Main))
        }
    }

    @Test fun invalidOrUndecryptableLegacyDataLeavesNewConfigurationEmpty() {
        for (data in listOf(
            legacy() + ("secret" to "broken"), legacy() - "secret",
            legacy() + ("baseUrl" to "not a url"), legacy() + ("provider" to "unknown"),
        )) {
            val store = ProviderStore(temp.newFolder(), cipher)
            assertFalse(importLegacyProvider(store, data, cipher))
            assertTrue(store.providers.value.isEmpty())
        }
    }
}
