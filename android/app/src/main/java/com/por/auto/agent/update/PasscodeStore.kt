package com.por.auto.agent.update

import android.content.Context
import java.security.MessageDigest

/** 记住已经通过的口令指纹；服务端换了口令，指纹对不上就会重新要求输入。 */
class PasscodeStore(private val context: Context) {

    private val prefs get() = context.getSharedPreferences("passcode", Context.MODE_PRIVATE)

    fun sha256(): String = prefs.getString(KEY_SHA, "").orEmpty()

    fun version(): Int = prefs.getInt(KEY_VERSION, 0)

    fun accept(sha256: String, version: Int) {
        prefs.edit().putString(KEY_SHA, sha256).putInt(KEY_VERSION, version).apply()
    }

    private companion object {
        const val KEY_SHA = "sha256"
        const val KEY_VERSION = "version"
    }
}

fun sha256Hex(text: String): String =
    MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }
