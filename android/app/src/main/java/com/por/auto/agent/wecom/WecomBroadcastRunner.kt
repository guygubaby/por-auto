package com.por.auto.agent.wecom

import android.view.accessibility.AccessibilityNodeInfo
import com.por.auto.agent.a11y.AgentAccessibilityService
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay

enum class WecomScope { Groups, Direct, Both }

data class RecipientResult(
    val title: String,
    val scope: WecomScope,
    val status: String, // sent / rehearsed / failed / uncertain / skipped
    val error: String? = null,
)

data class BroadcastResult(
    val dryRun: Boolean,
    val results: List<RecipientResult>,
    val error: String? = results.firstOrNull { it.status == "failed" || it.status == "uncertain" }
        ?.let { it.error ?: "运行已停止，请检查对象结果" },
) {
    val completed: Int get() = results.count { it.status == "sent" || it.status == "rehearsed" }
    val failed: Int get() = results.count { it.status == "failed" || it.status == "uncertain" }
    val rehearsed: Boolean
        get() = dryRun && error == null && results.isNotEmpty() && results.all { it.status == "rehearsed" }
}

/**
 * P1 的确定性企微群发：回首页 → 切群聊 → 冻结名单 → 逐个打开 → 核对标题/草稿 →
 * 试运行只输入并清理；正式发送只点一次并回读，不重试。
 */
class WecomBroadcastRunner(
    private val service: AgentAccessibilityService,
    private val log: (String) -> Unit,
) {
    private val actions = WecomActions(service)
    private lateinit var ids: WecomIds

    suspend fun run(text: String, scope: WecomScope, dryRun: Boolean): BroadcastResult =
        BroadcastGate.withRun { execute(text, scope, dryRun) }

    private suspend fun execute(text: String, scope: WecomScope, dryRun: Boolean): BroadcastResult {
        validateText(text)
        if (scope != WecomScope.Groups) throw WecomException("当前只支持群聊分类")
        val results = mutableListOf<RecipientResult>()
        try {
            ids = WecomIds.forVersion(packageVersion())
            log("企业微信 ${packageVersion()}，启动")
            if (!actions.launchWecom()) throw WecomException("无法启动企业微信")
            waitForPackage(15_000)
            log("回到消息首页")
            home()
            log("切换到${if (scope == WecomScope.Groups) "群聊" else "全部"}")
            recipientPage(scope)
            log("读取会话列表")
            val recipients = discover(scope)
            if (recipients.isEmpty()) throw WecomException("没有可处理的会话")
            log("名单已冻结：${recipients.size} 个")

            for ((index, title) in recipients.withIndex()) {
                var attempted = false
                try {
                    log("(${index + 1}/${recipients.size}) 打开 $title")
                    returnToList(scope)
                    openChat(title, scope)
                    sendText(title, text, dryRun) { attempted = true }
                    results += RecipientResult(title, scope, if (dryRun) "rehearsed" else "sent")
                    log(if (dryRun) "试运行通过：$title" else "已发送：$title")
                } catch (e: Exception) {
                    if (e is CancellationException) throw e
                    results += RecipientResult(
                        title = title,
                        scope = scope,
                        status = if (attempted) "uncertain" else "failed",
                        error = e.message ?: e.javaClass.simpleName,
                    )
                    log("停止：$title — ${e.message}")
                    for (i in index + 1 until recipients.size) {
                        results += RecipientResult(recipients[i], scope, "skipped")
                    }
                    break
                }
                if (index + 1 < recipients.size) delay(1000)
            }
            return BroadcastResult(dryRun, results)
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            if (results.isEmpty()) {
                results += RecipientResult("—", scope, "failed", e.message)
            }
            return BroadcastResult(dryRun, results, e.message ?: e.javaClass.simpleName)
        }
    }

    private fun packageVersion(): String? = runCatching {
        service.packageManager.getPackageInfo(WecomTree.PACKAGE, 0).versionName
    }.getOrNull()

    private suspend fun waitForPackage(timeoutMs: Long) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            if (actions.focusedPackage() == WecomTree.PACKAGE) return
            delay(300)
        }
        throw WecomException("企业微信没有在前台")
    }

    private suspend fun readTree(): WecomTree {
        repeat(12) {
            try {
                return WecomTree.read(service)
            } catch (e: StaleTreeException) {
                delay(400)
            }
        }
        throw WecomException("无法读取企业微信页面")
    }

    private suspend fun home() {
        repeat(8) {
            val tree = readTree()
            try {
                if (isHome(tree)) return
                val tab = messageTab(tree)
                if (tab != null) {
                    if (!actions.click(tab.centerX, tab.centerY)) throw WecomException("点击消息导航失败")
                } else {
                    if (!actions.back()) throw WecomException("返回消息首页失败")
                }
            } finally {
                tree.close()
            }
            delay(700)
        }
        throw WecomException("未能回到企业微信消息首页")
    }

    private fun isHome(tree: WecomTree): Boolean =
        tree.all(ids.messageTab).any { it.text == "消息" } &&
            tree.all(ids.list).isNotEmpty() &&
            tree.all(ids.filterText).isNotEmpty()

    private fun messageTab(tree: WecomTree): WecomTree.Node? {
        val height = service.resources.displayMetrics.heightPixels
        val text = tree.nodes.firstOrNull {
            it.text == "消息" && it.valid && it.bounds[1] > height * 0.75
        } ?: return null
        val tab = clickableAncestor(tree, text) ?: return null
        return tab.takeIf { it.bounds[1] > height * 0.75 }
    }

    private fun clickableAncestor(tree: WecomTree, node: WecomTree.Node): WecomTree.Node? {
        var current: WecomTree.Node? = node
        repeat(5) {
            val candidate = current ?: return null
            if (candidate.clickable && candidate.valid) return candidate
            current = candidate.parent.takeIf { it >= 0 }?.let { tree.nodes[it] }
        }
        return null
    }

    private suspend fun recipientPage(scope: WecomScope) {
        val desired = if (scope == WecomScope.Groups) "群聊" else "全部"
        repeat(6) {
            val tree = readTree()
            try {
                val filter = tree.one(ids.filterText)
                if (filter.text == desired) return
                val button = tree.one(ids.filterButton)
                if (!actions.click(button.centerX, button.centerY)) throw WecomException("打开会话分类失败")
            } finally {
                tree.close()
            }
            delay(600)

            val options = readTree()
            try {
                val found = options.texts(desired)
                if (found.size != 1) throw WecomException("会话分类不唯一：$desired")
                if (!actions.click(found.single().centerX, found.single().centerY)) {
                    throw WecomException("选择会话分类失败")
                }
            } finally {
                options.close()
            }
            delay(700)
        }
        throw WecomException("未能切换到会话分类：$desired")
    }

    private suspend fun discover(scope: WecomScope): List<String> {
        scrollToTop()
        val collected = RecipientSnapshot()
        repeat(60) {
            val tree = readTree()
            try {
                val list = tree.one(ids.list)
                if (tree.one(ids.filterText).text != "群聊") {
                    throw WecomException("会话分类已变化")
                }
                collected.addPage(
                    rows(tree, scope),
                    list.native.collectionInfo?.rowCount?.takeIf { it >= 0 },
                )
            } finally {
                tree.close()
            }
            if (!scrollList(forward = true)) return collected.finish()
            delay(400)
        }
        throw WecomException("无法确认会话列表末尾，未冻结名单")
    }

    private fun rows(tree: WecomTree, scope: WecomScope): List<RecipientRow> {
        val list = tree.one(ids.list)
        val titles = tree.nodes.filter { it.id == ids.rowTitle && it.valid && tree.under(it, list) }
        val result = mutableListOf<RecipientRow>()
        val seen = mutableSetOf<String>()
        for (title in titles) {
            val row = tree.rowOf(title, list) ?: continue
            if (!row.clickable || visibleRowCenter(row.bounds, list.bounds) == null) continue
            val name = title.text.trim()
            if (name.isEmpty() || name.endsWith("…") || name.endsWith("...")) {
                throw WecomException("会话名称不完整，未猜测")
            }
            if (scope != WecomScope.Groups && name in DIRECT_EXCLUDES) continue
            val key = WecomTitle.key(name)
            if (!seen.add(key)) throw WecomException("会话重名，无法安全区分：$name")
            result += RecipientRow(name, row.position ?: title.position)
        }
        return result
    }

    private suspend fun scrollList(forward: Boolean): Boolean {
        val tree = readTree()
        return try {
            val list = tree.one(ids.list)
            if (!list.native.refresh()) throw StaleTreeException()
            val action = if (forward) {
                AccessibilityNodeInfo.ACTION_SCROLL_FORWARD
            } else {
                AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
            }
            if (list.native.actionList.none { it.id == action }) return false
            actions.requireForeground()
            if (!list.native.performAction(action)) {
                throw WecomException("会话列表滚动失败，未把失败当作列表末尾")
            }
            true
        } finally {
            tree.close()
        }
    }

    /** 每次处理完一个会话都回到列表页，否则下一次读不到列表。 */
    private suspend fun returnToList(scope: WecomScope) {
        val listPage = if (scope == WecomScope.Groups) "群聊" else "全部"
        repeat(6) {
            val tree = readTree()
            try {
                val filter = tree.all(ids.filterText).firstOrNull()
                if (filter != null && filter.text == listPage) return
            } finally {
                tree.close()
            }
            actions.back()
            delay(600)
        }
        // 返回失败时重新从首页切回列表页
        home()
        recipientPage(scope)
    }

    /**
     * 在列表里找目标会话：先看当前屏，再向下滚动查找；都没找到就回到列表开头再往下找一遍。
     * 名单可能跨多屏，不能只按当前可见行点。
     */
    private suspend fun openChat(title: String, scope: WecomScope) {
        repeat(2) { pass ->
            if (pass > 0) {
                scrollToTop()
            }
            repeat(MAX_SEARCH_SCROLLS) {
                val tree = readTree()
                try {
                    val list = tree.one(ids.list)
                    val titleNode = tree.nodes.firstOrNull {
                        it.id == ids.rowTitle && it.text == title && it.valid && tree.under(it, list)
                    }
                    if (titleNode != null) {
                        val row = tree.rowOf(titleNode, list)
                            ?: throw WecomException("会话行不可点击：$title")
                        if (!row.clickable) throw WecomException("会话行不可点击：$title")
                        val point = visibleRowCenter(row.bounds, list.bounds)
                            ?: throw WecomException("目标会话不在可见列表内：$title")
                        if (!actions.click(point.first, point.second)) {
                            throw WecomException("打开会话失败：$title")
                        }
                        log("已点击会话行：$title")
                        delay(700)
                        if (waitChat(title, attempts = 12)) return
                        // 列表还在动时首次点击可能被吞掉：仍在列表页就再点一次。
                        if (isOnList(scope) && clickRow(title)) {
                            log("再次点击：$title")
                            if (waitChat(title, attempts = 12)) return
                        }
                        throw WecomException("没有进入目标会话：$title")
                    }
                } finally {
                    tree.close()
                }
                if (!scrollList(forward = true)) return@repeat
                delay(400)
            }
        }
        throw WecomException("会话列表里找不到：$title")
    }

    private suspend fun scrollToTop() {
        repeat(40) {
            if (!scrollList(forward = false)) return
            delay(300)
        }
        throw WecomException("无法确认会话列表开头，未冻结名单")
    }

    /** 等到进入目标会话。标题不一致直接停；超时返回 false，由调用方决定是否重试点击。 */
    private suspend fun waitChat(title: String, attempts: Int): Boolean {
        repeat(attempts) {
            val tree = readTree()
            try {
                val editor = tree.all(ids.editor).singleOrNull()?.takeIf { it.editable }
                if (editor != null) {
                    val titleNode = tree.all(ids.messageTab).singleOrNull()
                        ?: throw WecomException("聊天标题读不到")
                    if (!WecomTitle.same(titleNode.text, title)) {
                        throw WecomException("打开的会话与目标不一致：${titleNode.text} ≠ $title")
                    }
                    return true
                }
            } finally {
                tree.close()
            }
            delay(500)
        }
        return false
    }

    private suspend fun isOnList(scope: WecomScope): Boolean {
        val expected = if (scope == WecomScope.Groups) "群聊" else "全部"
        val tree = readTree()
        return try {
            tree.all(ids.filterText).any { it.text == expected }
        } catch (e: WecomException) {
            false
        } finally {
            tree.close()
        }
    }

    /** 在当前屏点一次目标行；找不到返回 false。 */
    private suspend fun clickRow(title: String): Boolean {
        val tree = readTree()
        return try {
            val list = tree.one(ids.list)
            val titleNode = tree.nodes.firstOrNull {
                it.id == ids.rowTitle && it.text == title && it.valid && tree.under(it, list)
            } ?: return false
            val row = tree.rowOf(titleNode, list) ?: return false
            if (!row.clickable) return false
            val point = visibleRowCenter(row.bounds, list.bounds) ?: return false
            actions.click(point.first, point.second)
        } finally {
            tree.close()
        }
    }

    private suspend fun sendText(title: String, text: String, dryRun: Boolean, onAttempt: () -> Unit) {
        if (!actions.setText(ids, title, expected = "", text = text)) throw WecomException("写入文字失败")

        waitDraft(title, text)
        log("草稿已核对：$title")

        if (dryRun) {
            clearDraft(title, text)
            log("试运行：已清理草稿 $title")
            return
        }

        val before = outgoing(title, text)
        findAndClickSend(title, text, onAttempt)
        log("已点击发送：$title")
        waitSent(title, text, before)
    }

    private suspend fun waitDraft(title: String, text: String) {
        repeat(20) {
            val tree = readTree()
            try {
                val editor = tree.all(ids.editor).singleOrNull()?.takeIf { it.editable }
                val titleNode = tree.all(ids.messageTab).singleOrNull()
                if (editor != null && titleNode != null && WecomTitle.same(titleNode.text, title)) {
                    val current = if (editor.hint) "" else editor.text
                    if (current == text) return
                    if (current != "") throw WecomException("草稿内容已变化，未发送")
                }
            } finally {
                tree.close()
            }
            delay(300)
        }
        throw WecomException("草稿未写入：$title")
    }

    private suspend fun clearDraft(title: String, text: String) {
        if (!actions.setText(ids, title, expected = text, text = "")) {
            throw WecomException("清理草稿失败")
        }

        repeat(20) {
            val tree = readTree()
            try {
                val editor = tree.one(ids.editor)
                if (!WecomTitle.same(tree.one(ids.messageTab).text, title)) {
                    throw WecomException("清理后会话已变化")
                }
                val current = if (editor.hint) "" else editor.text
                if (current == "") return
            } finally {
                tree.close()
            }
            delay(300)
        }
        throw WecomException("草稿未清理干净，停止")
    }

    private suspend fun findAndClickSend(title: String, text: String, onAttempt: () -> Unit) {
        repeat(15) {
            val tree = readTree()
            try {
                val editor = tree.one(ids.editor).takeIf { it.editable }
                    ?: throw WecomException("发送前找不到输入框")
                val titleNode = tree.one(ids.messageTab)
                if (!WecomTitle.same(titleNode.text, title)) {
                    throw WecomException("发送前会话已变化")
                }
                val current = if (editor.hint) "" else editor.text
                if (current != text) throw WecomException("发送前草稿已变化")

                val candidates = tree.nodes.filter {
                    it.text == "发送" && it.valid &&
                        it.bounds[0] >= editor.bounds[2] &&
                        it.bounds[1] < editor.bounds[3] && it.bounds[3] > editor.bounds[1]
                }
                if (candidates.size > 1) throw WecomException("发送按钮不唯一")
                if (candidates.size == 1) {
                    onAttempt()
                    if (!actions.click(candidates.single().centerX, candidates.single().centerY)) {
                        throw WecomException("发送点击未完成，结果不明")
                    }
                    return
                }
            } finally {
                tree.close()
            }
            delay(300)
        }
        throw WecomException("没有找到发送按钮")
    }

    private data class Outgoing(val count: Int, val maxPosition: Int?)

    private suspend fun outgoing(title: String, text: String): Outgoing {
        val tree = readTree()
        return try {
            if (!WecomTitle.same(tree.one(ids.messageTab).text, title)) {
                throw WecomException("发送前会话已变化")
            }
            outgoing(tree, text)
        } finally {
            tree.close()
        }
    }

    private fun outgoing(tree: WecomTree, text: String): Outgoing {
        val width = service.resources.displayMetrics.widthPixels
        val rows = mutableListOf<WecomTree.Node>()
        for (body in tree.nodes.filter { it.id == ids.messageBody && it.valid && it.text == text }) {
            var current: WecomTree.Node? = body
            while (current != null) {
                val avatars = tree.nodes.filter {
                    it.id == ids.avatar && it.valid && tree.under(it, current)
                }
                if (avatars.size == 1) {
                    val avatar = avatars.single()
                    if (avatar.centerX > width / 2 &&
                        avatar.bounds[0] >= body.bounds[2] &&
                        avatar.bounds[1] < body.bounds[3] && avatar.bounds[3] > body.bounds[1]
                    ) {
                        rows += current
                    }
                    break
                }
                current = current.parent.takeIf { it >= 0 }?.let { tree.nodes[it] }
            }
        }
        val positions = rows.mapNotNull { row ->
            var current: WecomTree.Node? = row
            var position: Int? = null
            while (current != null) {
                if (current.position != null) {
                    position = current.position
                    break
                }
                current = current.parent.takeIf { it >= 0 }?.let { tree.nodes[it] }
            }
            position
        }
        return Outgoing(rows.size, positions.maxOrNull())
    }

    private suspend fun waitSent(title: String, text: String, before: Outgoing) {
        repeat(12) {
            val tree = readTree()
            try {
                val editor = tree.all(ids.editor).singleOrNull()?.takeIf { it.editable }
                val titleNode = tree.all(ids.messageTab).singleOrNull()
                if (editor != null && titleNode != null && WecomTitle.same(titleNode.text, title)) {
                    val current = if (editor.hint) "" else editor.text
                    val after = outgoing(tree, text)
                    val fresh = if (after.maxPosition != null && before.maxPosition != null) {
                        after.maxPosition > before.maxPosition
                    } else {
                        after.count > before.count
                    }
                    if (current == "" && fresh) return
                    if (current != "" && current != text) {
                        throw WecomException("发送后草稿已变化，结果不明")
                    }
                }
            } finally {
                tree.close()
            }
            delay(800)
        }
        throw WecomException("发送结果不明，未自动重发")
    }

    companion object {
        internal fun validateText(text: String) {
            if (text.isBlank()) throw WecomException("消息不能为空")
            if (text.toByteArray(Charsets.UTF_8).size > 4000) throw WecomException("消息最多 4000 字节")
            if (text.any { it.code in 0..8 || it.code in 0x0B..0x0C || it.code in 0x0E..0x1F || it.code == 0x7F }) {
                throw WecomException("消息包含控制字符")
            }
        }

        private const val MAX_SEARCH_SCROLLS = 80

        private val DIRECT_EXCLUDES = setOf(
            "客户联系", "行业资讯", "接收微信中的工作消息", "打卡",
            "企业微信团队", "我的客服", "添加管理员协助你体验",
        )
    }
}
