package com.por.auto.agent.wecom

/** 会话标题比对：允许群标题后面的「(成员数)」；出现省略号一律不认。 */
object WecomTitle {
    private val SPACE = Regex("\\s")
    private val ELLIPSIS = Regex("…|\\.{3}|·{3}")
    private val MEMBER_SUFFIX = Regex("\\d+\\)")

    fun key(value: String): String = value
        .replace(SPACE, "")
        .replace("（", "(")
        .replace("）", ")")
        .replace("｜", "|")
        .replace("丨", "|")
        .replace(ELLIPSIS, "…")

    fun same(actual: String, expected: String): Boolean {
        val a = key(actual)
        val b = key(expected)
        if ("…" in a || "…" in b) return false
        if (a == b) return true
        val prefix = "$b("
        return a.startsWith(prefix) && MEMBER_SUFFIX.matches(a.removePrefix(prefix))
    }
}
