package com.wangzan101.mika.about

import com.wangzan101.mika.porauto.PorAutoBackend
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject

/**
 * 读 por-auto 后端 `/latest` 的版本信息：
 * `{ versionCode, versionName, notes, size, sha256, publishedAt }`。
 * 安装包固定从 `/latest.apk` 下载，大小和 SHA-256 用来校验下载结果。
 */
object PorAutoReleases {
    private val json = Json { ignoreUnknownKeys = true }

    fun fromBackend(text: String): ReleaseInfo? = runCatching {
        val o = json.parseToJsonElement(text).jsonObject
        val version = o.str("versionName")?.takeIf { it.isNotBlank() } ?: error("no versionName")
        ReleaseInfo(
            version = AppVersion.normalize(version),
            name = AppVersion.normalize(version),
            notes = o.str("notes").orEmpty().trim(),
            date = o.str("publishedAt")?.take(10)?.takeIf { it.length == 10 },
            pageUrl = PorAutoBackend.DOWNLOAD_PAGE,
            apkUrl = PorAutoBackend.APK_URL,
            apkSize = o.strOrNumber("size")?.toLongOrNull(),
            apkDigest = o.str("sha256")?.takeIf { it.isNotBlank() }?.let { "sha256:$it" },
            versionCode = o.strOrNumber("versionCode")?.toLongOrNull(),
        )
    }.getOrNull()

    private fun JsonObject.str(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
    private fun JsonObject.strOrNumber(key: String): String? = (this[key] as? JsonPrimitive)?.content
}
