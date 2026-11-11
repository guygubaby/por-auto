package com.por.auto.agent.a11y

/** 纯函数：坐标归一化、去重键、FNV-1a 指纹。可 JVM 单测。 */
object Normalize {
    const val MAX = 999
    const val FNV_OFFSET = 1469598103934665603L

    fun bounds(left: Int, top: Int, right: Int, bottom: Int, width: Int, height: Int): List<Int> {
        if (width <= 0 || height <= 0) return listOf(0, 0, 0, 0)
        return listOf(
            scale(left, width),
            scale(top, height),
            scale(right, width),
            scale(bottom, height),
        )
    }

    private fun scale(value: Int, size: Int): Int =
        ((value.toLong() * MAX) / size).coerceIn(0L, MAX.toLong()).toInt()

    fun key(role: String, name: String, boundsPx: List<Int>): String =
        "$role|$name|${boundsPx.joinToString(",")}"

    fun fnv(hash: Long, value: String?): Long {
        var h = hash
        for (c in value.orEmpty()) {
            h = (h xor c.code.toLong()) * 1099511628211L
        }
        return h
    }
}
