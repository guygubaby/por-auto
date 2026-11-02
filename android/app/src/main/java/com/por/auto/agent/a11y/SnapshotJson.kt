package com.por.auto.agent.a11y

import org.json.JSONArray
import org.json.JSONObject

/** 把 ScreenSnapshot 编码成可读 JSON。P0 用 org.json，避免额外序列化依赖。 */
object SnapshotJson {
    fun encode(snapshot: ScreenSnapshot): String {
        val root = JSONObject()
        root.put("capturedAt", snapshot.capturedAt)
        root.put("packageName", snapshot.packageName ?: JSONObject.NULL)
        root.put("screen", JSONObject().put("width", snapshot.width).put("height", snapshot.height))
        root.put("hash", java.lang.Long.toHexString(snapshot.hash))
        root.put("protected", snapshot.protected)
        root.put("windows", JSONArray().apply {
            snapshot.windows.forEach { put(windowJson(it)) }
        })
        root.put("elements", JSONArray().apply {
            snapshot.elements.forEach { put(elementJson(it)) }
        })
        return root.toString(2)
    }

    private fun windowJson(window: UiWindow): JSONObject = JSONObject().apply {
        put("index", window.index)
        put("type", window.type)
        put("layer", window.layer)
        put("title", window.title ?: JSONObject.NULL)
        put("packageName", window.packageName ?: JSONObject.NULL)
        put("focused", window.focused)
        put("active", window.active)
        put("nodeCount", window.nodeCount)
    }

    private fun elementJson(element: UiElement): JSONObject = JSONObject().apply {
        put("ref", element.ref)
        put("parentRef", element.parentRef ?: JSONObject.NULL)
        put("actionRef", element.actionRef ?: JSONObject.NULL)
        put("editRef", element.editRef ?: JSONObject.NULL)
        put("depth", element.depth)
        put("windowIndex", element.windowIndex)
        put("role", element.role)
        put("name", element.name)
        put("resourceId", element.resourceId ?: JSONObject.NULL)
        put("bounds", intArray(element.bounds))
        put("boundsPx", intArray(element.boundsPx))
        put("clickable", element.clickable)
        put("editable", element.editable)
        put("scrollable", element.scrollable)
        put("hint", element.hint)
        put("secret", element.secret)
        put("packageName", element.packageName ?: JSONObject.NULL)
    }

    private fun intArray(values: List<Int>): JSONArray = JSONArray().apply {
        values.forEach { put(it) }
    }
}
