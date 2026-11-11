package com.por.auto.agent.a11y

/** 一次读屏里的一个控件。bounds 是 0–999 归一化坐标，boundsPx 是原始像素。 */
data class UiElement(
    val ref: String,
    val parentRef: String?,
    /** 最近的可点击祖先（含自己）；点击时用这个 ref，避免点到不可点击的文字节点。 */
    val actionRef: String?,
    /** 最近的可编辑祖先（含自己）；输入时用这个 ref。 */
    val editRef: String?,
    val depth: Int,
    val windowIndex: Int,
    val role: String,
    val name: String,
    val resourceId: String?,
    val bounds: List<Int>,
    val boundsPx: List<Int>,
    val clickable: Boolean,
    val editable: Boolean,
    val scrollable: Boolean,
    val hint: Boolean,
    val secret: Boolean,
    val packageName: String?,
)

/** 一个无障碍窗口。P0 只看主屏，windowIndex 用来把元素分组。 */
data class UiWindow(
    val index: Int,
    val type: String,
    val layer: Int,
    val title: String?,
    val packageName: String?,
    val focused: Boolean,
    val active: Boolean,
    val nodeCount: Int,
)

/** 读屏快照。hash 用来判断界面有没有变。 */
data class ScreenSnapshot(
    val capturedAt: Long,
    val packageName: String?,
    val width: Int,
    val height: Int,
    val windows: List<UiWindow>,
    val elements: List<UiElement>,
    val hash: Long,
    val protected: Boolean,
)
