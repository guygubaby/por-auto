package com.wangzan101.mika.porauto

import android.content.Context
import com.wangzan101.mika.core.model.Capabilities
import com.wangzan101.mika.core.model.ModelRole
import com.wangzan101.mika.settings.KeyCipher
import com.wangzan101.mika.settings.KeystoreKeyCipher
import com.wangzan101.mika.settings.ProviderConfig
import com.wangzan101.mika.settings.ProviderPresets
import com.wangzan101.mika.settings.ProviderStore
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.util.Base64

/** 0.4 的包名和密钥库保留着；只在新配置为空时导入一次，旧密文不删除。 */
internal fun migrateLegacyProvider(context: Context, store: ProviderStore) {
    val prefs = context.getSharedPreferences("ai", Context.MODE_PRIVATE)
    if (prefs.getBoolean("migratedToProviders", false)) return
    if (store.providers.value.isNotEmpty() ||
        importLegacyProvider(store, prefs.all, KeystoreKeyCipher("por_auto_ai_key"))) {
        check(prefs.edit().putBoolean("migratedToProviders", true).commit())
    }
}

internal fun importLegacyProvider(store: ProviderStore, legacy: Map<String, *>, cipher: KeyCipher): Boolean {
    if (store.providers.value.isNotEmpty()) return false
    val kind = when (legacy["provider"]) {
        "OpenAiCompatible", "OpenCodeGo", null -> ProviderConfig.Kind.OpenAiCompat
        "Anthropic" -> ProviderConfig.Kind.Anthropic
        else -> return false
    }
    val base = (legacy["baseUrl"] as? String)?.trim()?.takeIf { it.toHttpUrlOrNull() != null } ?: return false
    val model = (legacy["model"] as? String)?.trim()?.takeIf { it.isNotEmpty() } ?: return false
    val secret = legacy["secret"] as? String ?: return false
    val key = runCatching { cipher.decrypt(Base64.getDecoder().decode(secret)).toString(Charsets.UTF_8) }
        .getOrNull()?.takeIf { it.isNotBlank() } ?: return false
    val preset = ProviderPresets.forBaseUrl(base)
    val provider = store.connect(
        preset?.label ?: "PorAuto", kind, base, key, emptyList(),
        sessionHeader = if (legacy["provider"] == "OpenCodeGo") "x-opencode-session" else preset?.sessionHeader,
        typed = setOf(model), untested = true,
    )
    return store.use(ModelRole.Main, provider.id, model,
        preset?.capabilities ?: Capabilities(toolCalls = true, vision = false, contextTokens = 64_000, reasoning = false))
}
