package com.por.auto.input

internal class InputFailure(val code: String) : IllegalStateException(code)

internal class DraftGuard(val sessionId: String) {
    private val used = mutableSetOf<String>()
    private var owner: Pair<String, String>? = null

    fun beginWrite(requestId: String, current: String, text: String, ownerId: String) {
        validateId(ownerId)
        if (current.isNotEmpty()) throw InputFailure("EXISTING_DRAFT")
        if (text.isBlank() || text.toByteArray(Charsets.UTF_8).size > 4000 || text.any { it.code in 0..8 || it.code in 11..12 || it.code in 14..31 || it.code == 127 }) throw InputFailure("INVALID_TEXT")
        consume(requestId)
        owner = ownerId to text
    }

    fun beginClear(requestId: String, ownerId: String, current: String): String {
        val owned = owner ?: throw InputFailure("DRAFT_NOT_OWNED")
        if (owned.first != ownerId || owned.second != current) throw InputFailure("DRAFT_CHANGED")
        consume(requestId)
        return owned.second
    }

    fun clearCompleted() { owner = null }

    private fun consume(requestId: String) {
        validateId(requestId)
        if (used.contains(requestId)) throw InputFailure("DUPLICATE_REQUEST_NO_REPLAY")
        if (used.size >= 128) throw InputFailure("EDITOR_SESSION_LIMIT")
        used.add(requestId)
    }

    companion object {
        fun validateId(value: String) {
            if (!Regex("[a-zA-Z0-9_-]{1,100}").matches(value)) throw InputFailure("INVALID_REQUEST_ID")
        }
    }
}
