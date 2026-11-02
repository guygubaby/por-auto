package com.por.auto.agent.wecom

internal data class RecipientRow(val title: String, val position: Int?)

internal fun visibleRowCenter(row: List<Int>, viewport: List<Int>): Pair<Int, Int>? {
    val left = maxOf(row[0], viewport[0])
    val top = maxOf(row[1], viewport[1])
    val right = minOf(row[2], viewport[2])
    val bottom = minOf(row[3], viewport[3])
    if (right <= left || bottom <= top) return null
    return (left + right) / 2 to (top + bottom) / 2
}

/** List positions distinguish viewport overlap from different chats with the same title. */
internal class RecipientSnapshot {
    private val titles = sortedMapOf<Int, String>()
    private val positions = mutableMapOf<String, Int>()
    private var unindexed: List<String>? = null
    private var expectedCount: Int? = null
    private var pages = 0

    fun addPage(rows: List<RecipientRow>, totalCount: Int?) {
        if (totalCount != null) {
            if (expectedCount != null && expectedCount != totalCount) {
                throw WecomException("会话列表数量已变化，未冻结名单")
            }
            expectedCount = totalCount
        }
        if (rows.map { WecomTitle.key(it.title) }.distinct().size != rows.size) {
            throw WecomException("会话重名，无法安全区分")
        }
        if (unindexed != null || rows.any { it.position == null }) {
            if (pages > 0) throw WecomException("多屏会话缺少列表位置，无法确认完整名单")
            unindexed = rows.map { it.title }
        } else {
            for (row in rows) {
                val position = requireNotNull(row.position)
                val key = WecomTitle.key(row.title)
                if (titles[position]?.let { it != row.title } == true) {
                    throw WecomException("会话列表顺序已变化，未冻结名单")
                }
                if (positions[key]?.let { it != position } == true) {
                    throw WecomException("会话重名或列表顺序变化：${row.title}")
                }
                titles[position] = row.title
                positions[key] = position
            }
        }
        pages++
    }

    fun finish(): List<String> {
        val result = unindexed ?: titles.values.toList()
        if ((expectedCount != null && result.size != expectedCount) ||
            (unindexed == null && titles.keys.withIndex().any { (index, position) -> index != position })
        ) {
            throw WecomException("会话名单读取不完整，未发送")
        }
        return result
    }
}
