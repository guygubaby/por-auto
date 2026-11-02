package com.por.auto.agent.assistant

import com.por.auto.agent.a11y.ScreenSnapshot

/** 把读屏结果压成模型能读的清单；序号与 elements 下标保持一致，方便回查。 */
object ScreenDigest {

    fun format(snapshot: ScreenSnapshot, limit: Int = 80): String = buildString {
        append("应用：").append(snapshot.packageName ?: "未知").append('\n')
        var shown = 0
        snapshot.elements.forEachIndexed { index, element ->
            if (shown >= limit) return@forEachIndexed
            // 密码框不发给模型，避免把输入内容带出去。
            if (element.secret) return@forEachIndexed
            if (element.name.isBlank() && !element.editable) return@forEachIndexed
            val tags = buildList {
                if (element.editable) add("可输入")
                if (element.clickable) add("可点击")
                if (element.scrollable) add("可滚动")
            }
            append('[').append(index + 1).append("] ")
            append(element.name.ifBlank { "(无文字)" })
            append(" · ").append(element.role.substringAfterLast('.'))
            if (tags.isNotEmpty()) append(" · ").append(tags.joinToString(" / "))
            append('\n')
            shown++
        }
        if (shown == 0) append("(没有可操作的控件)\n")
    }
}

/** 不可撤销的操作，目标里没提到就拦下。 */
object AgentGuard {

    private val RISKY = listOf(
        "删除", "清空", "退出", "注销", "解绑", "转账", "付款", "支付",
        "举报", "拉黑", "卸载", "恢复出厂", "格式化", "退出登录",
    )

    fun blocked(target: String, goal: String): String? {
        if (RISKY.none { target.contains(it) && !goal.contains(it) }) return null
        return "「$target」包含不可撤销操作，目标里没有提到，已停止"
    }
}
