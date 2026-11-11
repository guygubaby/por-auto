package com.por.auto.agent.ui

import android.content.Context

/** 主题偏好存在本机，重启后照旧。 */
class ThemeStore(private val context: Context) {

    private val prefs get() = context.getSharedPreferences("ui", Context.MODE_PRIVATE)

    fun load(): ThemeMode = ThemeMode.fromKey(prefs.getString(KEY_THEME, null))

    fun save(mode: ThemeMode) {
        prefs.edit().putString(KEY_THEME, mode.name).apply()
    }

    private companion object {
        const val KEY_THEME = "theme"
    }
}
