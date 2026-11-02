package com.por.auto.agent.wecom

/**
 * 企业微信控件 ID 的版本映射。
 * 左边是内部稳定名（和 desktop/mobile 的 wecom-ids.js 一致），右边是该版本的真实资源 ID。
 * 未收录的版本直接拒绝运行，避免在错误控件上点击。
 */
class WecomIds private constructor(private val ids: Map<String, String>) {

    val messageTab: String get() = id("ncq")
    val list: String get() = id("czp")
    val rowTitle: String get() = id("hrr")
    val filterText: String get() = id("fg8")
    val filterButton: String get() = id("fg9")
    val editor: String get() = id("i_6")
    val messageBody: String get() = id("i_d")
    val messageRow: String get() = id("message_row")
    val avatar: String get() = id("message_avatar")

    private fun id(name: String): String =
        ids[name] ?: throw WecomException("企业微信版本映射缺少控件：$name")

    companion object {
        private val VERSIONS: Map<String, Map<String, String>> = mapOf(
            "5.0.12" to mapOf(
                "ncq" to "o6j",
                "czp" to "db5",
                "fg8" to "fwr",
                "fg9" to "fws",
                "hrr" to "ibi",
                "ndh" to "o7a",
                "ndw" to "o7p",
                "og3" to "pce",
                "mi0" to "n8x",
                "i_6" to "iu5",
                "i_d" to "ith",
                "lba" to "m0f",
                "n5o" to "nxc",
                "km_" to "l_8",
                "message_row" to "ixq",
                "message_avatar" to "j3b",
            ),
        )

        fun forVersion(versionName: String?): WecomIds {
            val ids = VERSIONS[versionName] ?: throw WecomException(
                "未收录的企业微信版本：${versionName ?: "未知"}，请先补充 wecom-ids 映射",
            )
            return WecomIds(ids)
        }

        val supportedVersions: Set<String> get() = VERSIONS.keys
    }
}
