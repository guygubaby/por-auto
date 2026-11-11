package com.por.auto.agent.assistant

import com.por.auto.agent.a11y.ScreenSnapshot

/** 把读屏结果压成模型能读的清单；序号与 elements 下标保持一致，方便回查。 */
object ScreenDigest {

    fun format(snapshot: ScreenSnapshot, limit: Int = 80): String = buildString {
        append("应用：").append(snapshot.packageName ?: "未知").append('\n')
        var shown = 0
        snapshot.elements.forEachIndexed { index, element ->
            if (shown >= limit) return@forEachIndexed
            if (element.name.isBlank() && !element.editable) return@forEachIndexed
            val tags = buildList {
                // 密码框只给位置和提示文字，读屏时已经用 hint 代替了内容。
                if (element.secret) add("密码")
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

/** 一次动作之后该给模型的反馈，或者该不该停。 */
internal sealed interface Verdict {
    data object Ok : Verdict
    data class Nudge(val text: String) : Verdict
    data class Stop(val reason: String) : Verdict
}

/**
 * 卡住判定：先提醒、给几次换做法的机会，到安全网才停。
 * 阈值参考 phongent 的 GuardRules：重复动作 3/6/12，画面无变化 3/6/9/12，连续失败 2/4/8。
 */
internal class StuckGuard {
    private var lastLabel = ""
    private var repeats = 0
    private var repeatWarned = 0
    private var stale = 0
    private var staleWarned = 0
    private var failures = 0
    private var failureWarned = 0

    /** 即将执行的动作；连续的同一个动作最容易变成死循环。 */
    fun action(label: String): Verdict {
        if (label == lastLabel) {
            repeats++
        } else {
            lastLabel = label
            repeats = 1
            repeatWarned = 0
        }
        return when {
            repeats >= REPEAT_STOP -> Verdict.Stop("同一个动作「$label」连续做了 $repeats 次还是没有效果，已停止。")
            repeats >= 6 && repeatWarned < 6 -> {
                repeatWarned = 6
                Verdict.Nudge(
                    "「$label」已经连续做了 6 次。别再原样重试：换一个明显不同的入口，" +
                        "比如滚动、返回上一页、先回桌面再重新打开应用；实在找不到就用 stop 说清楚缺什么。",
                )
            }
            repeats >= 3 && repeatWarned < 3 -> {
                repeatWarned = 3
                Verdict.Nudge("「$label」已经连续做了 3 次，画面可能没有变化。换一条不同的路，不要原样重试。")
            }
            else -> Verdict.Ok
        }
    }

    /** 动作本身执行失败（找不到控件、滑动失败等）。 */
    fun failure(message: String): Verdict {
        failures++
        return when {
            failures >= FAILURE_STOP -> Verdict.Stop("连续 $failures 个动作都没有执行成功，已停止；最后一个：$message")
            failures >= 4 && failureWarned < 4 -> {
                failureWarned = 4
                Verdict.Nudge(
                    "已经连续 4 个动作失败（$message）。先返回或回桌面，重新进入目标应用再试；" +
                        "还是不行就用 stop 说明卡在哪一步。",
                )
            }
            failures >= 2 && failureWarned < 2 -> {
                failureWarned = 2
                Verdict.Nudge("刚才的动作没有执行成功：$message。换一种做法，不要原样重试。")
            }
            else -> Verdict.Ok
        }
    }

    /** 动作成功执行（画面有没有变另算）。 */
    fun success() {
        failures = 0
        failureWarned = 0
    }

    /** 确认过不是加载/动画之后，画面仍然没有变化。 */
    fun unchanged(): Verdict {
        stale++
        return when {
            stale >= STALE_STOP -> Verdict.Stop(
                "连续 $stale 步画面没有变化，已停止；最后一步是「$lastLabel」。",
            )
            stale >= 9 && staleWarned < 9 -> {
                staleWarned = 9
                Verdict.Nudge(
                    "已经连续 9 步没有进展。先回桌面重新打开目标应用，或换一个完全不同的入口；" +
                        "确认做不到就用 stop 说明卡在哪。",
                )
            }
            stale >= 6 && staleWarned < 6 -> {
                staleWarned = 6
                Verdict.Nudge(
                    "连续 6 步画面没有变化。不要再重复同样的操作：换目标（滚动、返回、点别的入口），" +
                        "必要时先回桌面重新打开应用。",
                )
            }
            stale >= 3 && staleWarned < 3 -> {
                staleWarned = 3
                Verdict.Nudge("刚才那一步没有让画面变化。确认点的是不是正确的目标，必要时先滚动或返回再试。")
            }
            else -> Verdict.Ok
        }
    }

    /** 画面变了：滚动、翻页这类重复动作是正常的，重新计数。 */
    fun changed() {
        stale = 0
        staleWarned = 0
        lastLabel = ""
        repeats = 0
        repeatWarned = 0
    }

    private companion object {
        const val REPEAT_STOP = 12
        const val STALE_STOP = 12
        const val FAILURE_STOP = 8
    }
}

/** 不可撤销的操作，目标里没提到就拦下。 */
object AgentGuard {

    private val RISKY = listOf(
        "删除", "清空", "注销", "解绑", "转账", "付款", "支付",
        "举报", "拉黑", "卸载", "恢复出厂", "格式化", "退出登录",
    )

    fun blocked(target: String, goal: String): String? {
        if (RISKY.none { target.contains(it) && !goal.contains(it) }) return null
        return "「$target」包含不可撤销操作，目标里没有提到，已停止"
    }
}
