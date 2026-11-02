package com.por.auto.agent.capture

import android.content.Context
import java.io.File

/** 节点 JSON 存在 filesDir/dumps；latest.json 给界面读，screen-*.json 留最近 50 份。 */
class DumpStore(private val context: Context) {

    fun save(json: String): File {
        val dir = dir()
        val file = File(dir, "screen-${System.currentTimeMillis()}.json")
        file.writeText(json)
        File(dir, "latest.json").writeText(json)
        prune(dir)
        return file
    }

    fun latest(): String? = File(dir(), "latest.json").takeIf { it.isFile }?.readText()

    private fun dir(): File = File(context.filesDir, "dumps").apply { mkdirs() }

    private fun prune(dir: File) {
        dir.listFiles { file -> file.name.startsWith("screen-") && file.name.endsWith(".json") }
            ?.sortedByDescending { it.lastModified() }
            ?.drop(50)
            ?.forEach { it.delete() }
    }
}
