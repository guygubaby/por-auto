package com.por.auto.agent.ai

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

enum class AiProvider(val label: String, val defaultBaseUrl: String = "") {
    OpenAiCompatible("OpenAI 兼容"),
    Anthropic("Anthropic 兼容"),
    OpenCodeGo("OpenCode Go", "https://opencode.ai/inference/go/openai/v1"),
}

data class AiConfig(
    val provider: AiProvider = AiProvider.OpenAiCompatible,
    val baseUrl: String = "",
    val model: String = "",
    val hasKey: Boolean = false,
    /** OpenCode Go 需要每次请求带同一个会话 ID；安装后固定不变。 */
    val sessionId: String = "",
) {
    val ready: Boolean get() = baseUrl.isNotBlank() && model.isNotBlank() && hasKey

    fun sameEndpoint(provider: AiProvider, baseUrl: String): Boolean =
        this.provider == provider &&
            this.baseUrl.trim().trimEnd('/') == baseUrl.trim().trimEnd('/')
}

/** API Key 用 Android Keystore 的 AES-GCM 加密后存 SharedPreferences，配置文件里不出现明文。 */
object SecretBox {
    private const val ALIAS = "por_auto_ai_key"
    private const val ANDROID_KEYSTORE = "AndroidKeyStore"

    fun encrypt(plain: String): String = runCatching {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val iv = cipher.iv
        val body = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        Base64.encodeToString(iv + body, Base64.NO_WRAP)
    }.getOrElse { throw AiException("无法安全保存 API Key，配置未修改") }

    fun decrypt(blob: String): String? = runCatching {
        val raw = Base64.decode(blob, Base64.NO_WRAP)
        if (raw.size <= IV_SIZE) return null
        val iv = raw.copyOfRange(0, IV_SIZE)
        val body = raw.copyOfRange(IV_SIZE, raw.size)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv))
        String(cipher.doFinal(body), Charsets.UTF_8)
    }.getOrNull()

    private const val IV_SIZE = 12

    private fun key(): SecretKey {
        val store = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (store.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build(),
        )
        return generator.generateKey()
    }
}

class AiConfigStore(private val context: Context) {

    private val prefs get() = context.getSharedPreferences("ai", Context.MODE_PRIVATE)

    fun load(): AiConfig = AiConfig(
        provider = runCatching { AiProvider.valueOf(prefs.getString(KEY_PROVIDER, null) ?: "") }
            .getOrDefault(AiProvider.OpenAiCompatible),
        baseUrl = prefs.getString(KEY_BASE_URL, "").orEmpty(),
        model = prefs.getString(KEY_MODEL, "").orEmpty(),
        hasKey = !prefs.getString(KEY_SECRET, null).isNullOrEmpty(),
        sessionId = sessionId(),
    )

    /** 首次使用时生成并存下来，之后每次都带同一个值。 */
    fun sessionId(): String = prefs.getString(KEY_SESSION, null)
        ?: UUID.randomUUID().toString().also { prefs.edit().putString(KEY_SESSION, it).apply() }

    /** apiKey 为空表示沿用已保存的 Key。 */
    fun save(config: AiConfig, apiKey: String?) {
        AiParsing.join(config.baseUrl, "models")
        val encrypted = if (apiKey.isNullOrBlank()) {
            keyFor(config.provider, config.baseUrl, "")
            prefs.getString(KEY_SECRET, null)
        } else {
            SecretBox.encrypt(apiKey)
        }
        prefs.edit()
            .putString(KEY_PROVIDER, config.provider.name)
            .putString(KEY_BASE_URL, config.baseUrl)
            .putString(KEY_MODEL, config.model)
            .putString(KEY_SECRET, encrypted)
            .apply()
    }

    fun keyFor(provider: AiProvider, baseUrl: String, supplied: String): String {
        if (supplied.isNotBlank()) return supplied
        if (!load().sameEndpoint(provider, baseUrl)) {
            throw AiException("变更协议或 Base URL 后，请重新填写 API Key")
        }
        return apiKey()?.takeIf { it.isNotBlank() } ?: throw AiException("请填写 API Key")
    }

    fun clearKey() {
        prefs.edit().remove(KEY_SECRET).apply()
    }

    fun apiKey(): String? = prefs.getString(KEY_SECRET, null)?.let(SecretBox::decrypt)

    private companion object {
        const val KEY_PROVIDER = "provider"
        const val KEY_BASE_URL = "baseUrl"
        const val KEY_MODEL = "model"
        const val KEY_SECRET = "secret"
        const val KEY_SESSION = "session"
    }
}
