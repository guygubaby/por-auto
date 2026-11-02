package com.por.auto.input

import android.app.KeyguardManager
import android.content.ComponentName
import android.inputmethodservice.InputMethodService
import android.provider.Settings
import android.text.InputType
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.ExtractedTextRequest
import android.view.inputmethod.InputConnection
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

class PorInputMethod : InputMethodService() {
    private var guard: DraftGuard? = null
    override fun onCreate() { super.onCreate(); current = this }
    override fun onDestroy() { current = null; super.onDestroy() }
    override fun onStartInput(info: EditorInfo, restarting: Boolean) { super.onStartInput(info, restarting); guard = DraftGuard(UUID.randomUUID().toString()) }
    override fun onFinishInput() { guard = null; super.onFinishInput() }
    override fun onEvaluateFullscreenMode() = false

    private fun connection(expectedPackage: String): InputConnection {
        if (getSystemService(KeyguardManager::class.java).isKeyguardLocked) throw InputFailure("PHONE_LOCKED")
        val info = currentInputEditorInfo ?: throw InputFailure("NO_EDITOR")
        val ic = currentInputConnection ?: throw InputFailure("NO_EDITOR")
        if (!currentInputStarted || guard == null) throw InputFailure("NO_EDITOR")
        if (expectedPackage !in listOf("com.tencent.mm", "com.tencent.wework") || info.packageName != expectedPackage) throw InputFailure("WRONG_EDITOR_PACKAGE")
        val kind = info.inputType and InputType.TYPE_MASK_CLASS
        val variation = info.inputType and InputType.TYPE_MASK_VARIATION
        if (kind != InputType.TYPE_CLASS_TEXT || variation in listOf(InputType.TYPE_TEXT_VARIATION_PASSWORD, InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD, InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD)) throw InputFailure("PRIVATE_OR_UNSUPPORTED_EDITOR")
        return ic
    }

    private fun text(ic: InputConnection): String {
        val request = ExtractedTextRequest().apply { hintMaxChars = 8193; hintMaxLines = 512 }
        val value = ic.getExtractedText(request, 0) ?: throw InputFailure("INCOMPLETE_EDITOR_TEXT")
        val text = value.text?.toString() ?: throw InputFailure("INCOMPLETE_EDITOR_TEXT")
        if (value.startOffset != 0 || value.partialStartOffset != -1 || value.partialEndOffset != -1 || text.toByteArray(Charsets.UTF_8).size > 4000 || value.selectionStart !in 0..text.length || value.selectionEnd !in 0..text.length) throw InputFailure("INCOMPLETE_EDITOR_TEXT")
        val before = ic.getTextBeforeCursor(8193, 0) ?: throw InputFailure("INCOMPLETE_EDITOR_TEXT")
        val after = ic.getTextAfterCursor(8193, 0) ?: throw InputFailure("INCOMPLETE_EDITOR_TEXT")
        if (before.toString() + (ic.getSelectedText(0)?.toString() ?: "") + after.toString() != text) throw InputFailure("EDITOR_CHANGED_DURING_READ")
        return text
    }

    internal fun execute(method: String, request: JSONObject, canceled: AtomicBoolean): JSONObject {
        if (method == "restore") {
            val previous = request.getString("previousIme")
            val own = ComponentName(this, PorInputMethod::class.java)
            val selected = ComponentName.unflattenFromString(Settings.Secure.getString(contentResolver, Settings.Secure.DEFAULT_INPUT_METHOD) ?: "")
            val enabled = (Settings.Secure.getString(contentResolver, Settings.Secure.ENABLED_INPUT_METHODS) ?: "").split(':').map { ComponentName.unflattenFromString(it.substringBefore(';')) }
            val desired = ComponentName.unflattenFromString(previous)
            if (selected != own || desired == null || desired == own || desired !in enabled || canceled.get()) throw InputFailure("CANNOT_RESTORE_IME")
            switchInputMethod(previous)
            return JSONObject().put("restored", true)
        }
        val expectedPackage = request.getString("packageName")
        val ic = connection(expectedPackage)
        val session = guard ?: throw InputFailure("NO_EDITOR")
        val initial = text(ic)
        var ownerId: String? = null
        if (method != "read") {
            if (request.getString("sessionId") != session.sessionId) throw InputFailure("EDITOR_SESSION_CHANGED")
            val next = when (method) {
                "write" -> request.getString("text").also {
                    ownerId = UUID.randomUUID().toString()
                    session.beginWrite(request.getString("requestId"), initial, it, ownerId!!)
                }
                "clearOwned" -> "".also { session.beginClear(request.getString("requestId"), request.getString("ownerId"), initial) }
                else -> throw InputFailure("UNKNOWN_METHOD")
            }
            if (canceled.get()) throw InputFailure("REQUEST_CANCELED")
            if (!ic.finishComposingText() || text(ic) != initial || guard !== session || connection(expectedPackage) !== ic || canceled.get()) throw InputFailure("EDITOR_CHANGED_BEFORE_WRITE")
            ic.beginBatchEdit()
            try {
                if (!ic.setSelection(0, initial.length) || !ic.commitText(next, 1)) throw InputFailure("EDIT_UNKNOWN_NO_REPLAY")
            } finally { ic.endBatchEdit() }
            if (guard !== session || connection(expectedPackage) !== ic || text(ic) != next) throw InputFailure("EDIT_UNKNOWN_NO_REPLAY")
            if (method == "clearOwned") session.clearCompleted()
        }
        return JSONObject().put("packageName", expectedPackage).put("sessionId", session.sessionId)
            .put("text", text(ic)).put("complete", true).put("fieldId", currentInputEditorInfo.fieldId)
            .put("imeAction", currentInputEditorInfo.imeOptions and EditorInfo.IME_MASK_ACTION)
            .also { if (ownerId != null) it.put("ownerId", ownerId) }
    }

    companion object { internal var current: PorInputMethod? = null }
}
