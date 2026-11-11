package com.por.auto.agent.wecom

import android.os.Bundle
import android.view.accessibility.AccessibilityNodeInfo
import com.por.auto.agent.a11y.AgentAccessibilityService
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay

enum class WecomScope(val label: String, val key: String) {
    Groups("群聊", "groups"),
    Direct("单聊", "direct"),
    Both("全部", "both");

    /** 消息页的会话分类。单聊没有独立分类，只能从「全部」里排除群聊得到。 */
    val page: String get() = if (this == Groups) "群聊" else "全部"

    companion object {
        fun fromKey(key: String): WecomScope =
            entries.firstOrNull { it.key == key } ?: throw WecomException("不支持的会话分类：$key")
    }
}

/** 写入后的草稿状态；已有别人的内容时绝不覆盖。 */
internal enum class DraftState { Ready, Empty, Changed, WrongChat, Unreadable }

internal fun draftStateOf(current: String, expected: String): DraftState = when {
    current == expected -> DraftState.Ready
    current.isEmpty() -> DraftState.Empty
    else -> DraftState.Changed
}

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

    /** 已知版本用 ID 精确命中；未知版本为 null，全部按界面结构定位。 */
    private var ids: WecomIds? = null
    private val height: Int get() = service.resources.displayMetrics.heightPixels
    private val width: Int get() = service.resources.displayMetrics.widthPixels

    private fun WecomTree.listNode(): WecomTree.Node =
        WecomLayout.list(nodes, ids?.list)?.let { node(it.index) }
            ?: throw WecomException("找不到会话列表")

    private fun WecomTree.editorNode(): WecomTree.Node =
        WecomLayout.editor(nodes, ids?.editor)?.let { node(it.index) }
            ?: throw WecomException("找不到输入框")

    private fun WecomTree.filterLabel(): WecomTree.Node? =
        WecomLayout.label(nodes, "群聊", "全部")?.let { node(it.index) }

    /** 会话页顶部的会话名；列表页没有这个标题。 */
    private fun WecomTree.chatTitleNode(): WecomTree.Node =
        WecomLayout.chatTitle(nodes, height)?.let { node(it.index) }
            ?: throw WecomException("读不到会话标题")

    /** 写入前重新核对会话标题和已有草稿，绝不覆盖别人写了一半的内容。 */
    private fun write(title: String, expected: String, text: String): Boolean {
        val tree = WecomTree.read(service)
        return tree.use {
            if (!WecomTitle.same(it.chatTitleNode().text, title)) {
                throw WecomException("写入前会话已变化")
            }
            val node = it.editorNode().native
            if (!node.refresh() || !node.isVisibleToUser || !node.isEnabled ||
                !node.isEditable || node.isPassword
            ) {
                throw WecomException("当前不是可核对的聊天输入框")
            }
            val current = if (node.isShowingHintText) "" else node.text?.toString().orEmpty()
            if (current != expected) throw WecomException("草稿已变化，未覆盖或清理")
            val args = Bundle().apply {
                putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
            }
            actions.requireForeground()
            node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
        }
    }

    private fun WecomTree.rowTitleNodes(list: WecomTree.Node): List<WecomTree.Node> =
        WecomLayout.rowTitles(nodes, node(list.index), ids?.rowTitle).map { node(it.index) }

    private fun clickableAncestor(tree: WecomTree, node: WecomTree.Node): WecomTree.Node? =
        WecomLayout.clickableAncestor(tree.nodes, node)?.let { tree.node(it.index) }

    suspend fun run(
        text: String,
        scope: WecomScope,
        dryRun: Boolean,
        only: List<String>? = null,
    ): BroadcastResult = BroadcastGate.withRun { execute(text, scope, dryRun, only) }

    private suspend fun execute(
        text: String,
        scope: WecomScope,
        dryRun: Boolean,
        only: List<String>?,
    ): BroadcastResult {
        validateText(text)
        val results = mutableListOf<RecipientResult>()
        try {
            ids = WecomIds.forVersion(packageVersion())
            log(
                "企业微信 ${packageVersion()}，启动" +
                    if (ids == null) "（未收录版本，按界面结构定位）" else "",
            )
            if (!actions.launchWecom()) throw WecomException("无法启动企业微信")
            waitForPackage(15_000)
            log("回到消息首页")
            home()
            log("读取会话列表")
            val recipients = selectTargets(freezeRecipients(scope), only)
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
        var viaNode = false
        repeat(8) {
            val tree = readTree()
            try {
                if (isHome(tree)) return
                // 聊天页底部是输入栏，不是导航栏；先返回，别按导航去点。
                val inChat = WecomLayout.editor(tree.nodes, ids?.editor) != null
                val tab = if (inChat) null else messageTab(tree)
                if (tab == null || !click(tree, tab, viaNode)) {
                    if (!actions.back()) throw WecomException("返回消息首页失败")
                }
            } finally {
                tree.close()
            }
            viaNode = !viaNode
            delay(700)
        }
        throw WecomException("未能回到企业微信消息首页")
    }

    /** 手势被系统吞掉时，下一轮改走节点点击；节点点不动再退回手势。 */
    private suspend fun click(tree: WecomTree, node: LayoutNode, viaNode: Boolean): Boolean {
        val native = tree.node(node.index).native
        return if (viaNode && native.isClickable) {
            actions.clickNode(native) || actions.click(node.centerX, node.centerY)
        } else {
            actions.click(node.centerX, node.centerY)
        }
    }

    /** 首页的判据是会话列表和「全部 / 群聊」分类都在。企微的导航文字是零尺寸的，不能当判据。 */
    private fun isHome(tree: WecomTree): Boolean =
        WecomLayout.list(tree.nodes, ids?.list) != null && tree.filterLabel() != null

    private fun messageTab(tree: WecomTree): LayoutNode? =
        WecomLayout.messageTab(tree.nodes, height)
            ?: WecomLayout.firstNavSlot(tree.nodes, height, width)

    /** 冻结名单。单聊先读一遍群聊分类，再从「全部」里按完整名称排除群会话。 */
    private suspend fun freezeRecipients(scope: WecomScope): List<String> {
        if (scope != WecomScope.Direct) {
            log("切换到${scope.page}")
            recipientPage(scope)
            return discover(scope)
        }
        log("先读群聊分类，用于从全部会话里排除群")
        recipientPage(WecomScope.Groups)
        val groups = discover(WecomScope.Groups).map(WecomTitle::key).toSet()
        log("群聊 ${groups.size} 个，改读全部会话")
        recipientPage(WecomScope.Direct)
        return discover(WecomScope.Direct, exclude = groups)
    }

    private suspend fun recipientPage(scope: WecomScope) {
        val desired = scope.page
        var viaNode = false
        repeat(6) {
            val tree = readTree()
            try {
                val filter = tree.filterLabel() ?: throw WecomException("读不到会话分类")
                if (filter.text == desired) return
                val button = clickableAncestor(tree, filter)
                    ?: throw WecomException("找不到会话分类按钮")
                val changed = click(tree, button, viaNode)
                viaNode = !viaNode
                if (!changed) throw WecomException("打开会话分类失败")
            } finally {
                tree.close()
            }
            delay(600)

            // 菜单展开动画期间同一个选项会短暂出现两份，多读几次再判定。
            var point: Pair<Int, Int>? = null
            var seen = ""
            for (attempt in 0 until 4) {
                val options = readTree()
                try {
                    val found = options.texts(desired)
                    if (found.size == 1) {
                        point = found.single().centerX to found.single().centerY
                    } else {
                        seen = "${found.size} 个：" +
                            found.take(3).joinToString("；") { "${it.bounds}(${it.id})" }
                    }
                } finally {
                    options.close()
                }
                if (point != null) break
                delay(300)
            }
            val target = point ?: throw WecomException("会话分类不唯一：$desired，$seen")
            if (!actions.click(target.first, target.second)) throw WecomException("选择会话分类失败")
            delay(700)
        }
        throw WecomException("未能切换到会话分类：$desired")
    }

    private suspend fun discover(scope: WecomScope, exclude: Set<String> = emptySet()): List<String> {
        scrollToTop()
        val collected = RecipientSnapshot()
        repeat(60) {
            val tree = readTree()
            try {
                val list = tree.listNode()
                if (tree.filterLabel()?.text != scope.page) {
                    throw WecomException("会话分类已变化")
                }
                collected.addPage(
                    rows(tree, scope, exclude),
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

    private fun rows(tree: WecomTree, scope: WecomScope, exclude: Set<String>): List<RecipientRow> {
        val list = tree.listNode()
        val titles = tree.rowTitleNodes(list)
        val result = mutableListOf<RecipientRow>()
        val seen = mutableSetOf<String>()
        for (title in titles) {
            val row = tree.rowOf(title, list) ?: continue
            if (!row.clickable || visibleRowCenter(row.bounds, list.bounds) == null) continue
            val name = title.text.trim()
            if (name.isEmpty() || name.endsWith("…") || name.endsWith("...")) {
                throw WecomException("会话名称不完整，未猜测")
            }
            val key = WecomTitle.key(name)
            if (scope != WecomScope.Groups && (name in DIRECT_EXCLUDES || key in exclude)) continue
            if (!seen.add(key)) throw WecomException("会话重名，无法安全区分：$name")
            result += RecipientRow(name, row.position ?: title.position)
        }
        return result
    }

    private suspend fun scrollList(forward: Boolean): Boolean {
        val tree = readTree()
        return try {
            val list = tree.listNode()
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
        val listPage = scope.page
        repeat(6) {
            val tree = readTree()
            try {
                val filter = tree.filterLabel()
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
                    val list = tree.listNode()
                    val titleNode = tree.rowTitleNodes(list).firstOrNull { it.text == title }
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
                        // 首次手势点击可能被系统吞掉：仍在列表页就换节点点击再试一次。
                        if (isOnList(scope) && clickRow(title, viaNode = true)) {
                            log("再次点击（节点通道）：$title")
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
                val editor = WecomLayout.editor(tree.nodes, ids?.editor)
                if (editor != null) {
                    val titleNode = tree.chatTitleNode()
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
        val expected = scope.page
        val tree = readTree()
        return try {
            tree.filterLabel()?.text == expected
        } catch (e: WecomException) {
            false
        } finally {
            tree.close()
        }
    }

    /** 在当前屏点一次目标行；找不到返回 false。viaNode 为真时改走节点点击。 */
    private suspend fun clickRow(title: String, viaNode: Boolean = false): Boolean {
        val tree = readTree()
        return try {
            val list = tree.listNode()
            val titleNode = tree.rowTitleNodes(list).firstOrNull { it.text == title } ?: return false
            val row = tree.rowOf(titleNode, list) ?: return false
            if (!row.clickable) return false
            val point = visibleRowCenter(row.bounds, list.bounds) ?: return false
            click(tree, row, viaNode)
        } finally {
            tree.close()
        }
    }

    private suspend fun sendText(title: String, text: String, dryRun: Boolean, onAttempt: () -> Unit) {
        if (write(title, expected = "", text = text)) {
            ensureDraft(title, text)
        } else {
            // SET_TEXT 直接报失败也换粘贴；粘贴前会再次核对草稿为空。
            pasteDraft(title, text)
        }
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

    /**
     * SET_TEXT 在自绘或隐藏输入框上可能静默失效。先等它一会儿；仍为空就换剪贴板粘贴，
     * 已有别的内容时绝不覆盖，直接停下。
     */
    private suspend fun ensureDraft(title: String, text: String) {
        repeat(DRAFT_PROBES) {
            when (draftState(title, text)) {
                DraftState.Ready -> return
                DraftState.WrongChat -> throw WecomException("写入前会话已变化")
                DraftState.Changed -> throw WecomException("草稿内容已变化，未发送")
                DraftState.Empty, DraftState.Unreadable -> Unit
            }
            delay(300)
        }
        when (draftState(title, text)) {
            DraftState.Ready -> return
            DraftState.WrongChat -> throw WecomException("粘贴前会话已变化")
            DraftState.Changed -> throw WecomException("草稿内容已变化，未发送")
            DraftState.Empty, DraftState.Unreadable -> Unit
        }
        pasteDraft(title, text)
    }

    private suspend fun draftState(title: String, text: String): DraftState {
        val tree = readTree()
        return try {
            val editor = WecomLayout.editor(tree.nodes, ids?.editor) ?: return DraftState.Unreadable
            val titleNode = WecomLayout.chatTitle(tree.nodes, height) ?: return DraftState.Unreadable
            if (!WecomTitle.same(titleNode.text, title)) return DraftState.WrongChat
            draftStateOf(if (editor.hint) "" else editor.text, text)
        } finally {
            tree.close()
        }
    }

    private suspend fun pasteDraft(title: String, text: String) {
        val backup = actions.setClipboard(text)
        if (!backup.ok) throw WecomException("无法写入剪贴板，输入失败")
        try {
            val tree = readTree()
            try {
                if (!WecomTitle.same(tree.chatTitleNode().text, title)) {
                    throw WecomException("粘贴前会话已变化")
                }
                val node = tree.editorNode().native
                if (!node.refresh() || !node.isVisibleToUser || !node.isEnabled ||
                    !node.isEditable || node.isPassword
                ) {
                    throw WecomException("当前不是可核对的聊天输入框")
                }
                val current = if (node.isShowingHintText) "" else node.text?.toString().orEmpty()
                if (current.isNotEmpty()) throw WecomException("草稿已变化，未覆盖或清理")
                if (!actions.paste(node)) throw WecomException("粘贴输入没有完成")
            } finally {
                tree.close()
            }
            waitDraft(title, text)
            log("输入方式：粘贴")
        } finally {
            actions.restoreClipboard(backup)
        }
    }

    private suspend fun waitDraft(title: String, text: String) {
        repeat(20) {
            val tree = readTree()
            try {
                val editor = WecomLayout.editor(tree.nodes, ids?.editor)
                val titleNode = WecomLayout.chatTitle(tree.nodes, height)
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
        if (!write(title, expected = text, text = "")) {
            throw WecomException("清理草稿失败")
        }

        repeat(20) {
            val tree = readTree()
            try {
                val editor = tree.editorNode()
                if (!WecomTitle.same(tree.chatTitleNode().text, title)) {
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
                val editor = tree.editorNode()
                val titleNode = tree.chatTitleNode()
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
            if (!WecomTitle.same(tree.chatTitleNode().text, title)) {
                throw WecomException("发送前会话已变化")
            }
            outgoing(tree, text)
        } finally {
            tree.close()
        }
    }

    private fun outgoing(tree: WecomTree, text: String): Outgoing {
        val bodyHint = ids?.messageBody
        val avatarHint = ids?.avatar
        val rows = mutableListOf<WecomTree.Node>()
        for (body in tree.nodes.filter {
            it.valid && it.text == text && (bodyHint == null || it.id == bodyHint)
        }) {
            var current: WecomTree.Node? = body
            while (current != null) {
                val avatars = tree.nodes.filter {
                    it.valid && it.centerX > width / 2 && tree.under(it, current) &&
                        (avatarHint?.let { id -> it.id == id } ?: it.role.endsWith("ImageView"))
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
                val editor = WecomLayout.editor(tree.nodes, ids?.editor)
                val titleNode = WecomLayout.chatTitle(tree.nodes, height)
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
        private const val DRAFT_PROBES = 6

        /**
         * 续跑时只处理上一次失败/跳过的会话。名单里已经找不到的会话直接停，
         * 不把「少发一个」当成成功。
         */
        internal fun selectTargets(recipients: List<String>, only: List<String>?): List<String> {
            if (only == null) return recipients
            val wanted = only.map(WecomTitle::key).toSet()
            val missing = only.firstOrNull { title -> recipients.none { WecomTitle.key(it) == WecomTitle.key(title) } }
            if (missing != null) throw WecomException("会话已不在列表里：$missing")
            return recipients.filter { WecomTitle.key(it) in wanted }
        }

        private val DIRECT_EXCLUDES = setOf(
            "客户联系", "行业资讯", "接收微信中的工作消息", "打卡",
            "企业微信团队", "我的客服", "添加管理员协助你体验",
        )
    }
}
