package com.por.auto.input

import org.junit.Assert.*
import org.junit.Test

class DraftGuardTest {
    private fun fails(code: String, action: () -> Unit) {
        try { action(); fail("expected $code") } catch (error: InputFailure) { assertEquals(code, error.code) }
    }
    @Test fun onlyTheExactDraftWrittenInThisSessionCanBeCleared() {
        val guard = DraftGuard("session")
        fails("DRAFT_NOT_OWNED") { guard.beginClear("c0", "owner", "1") }
        fails("EXISTING_DRAFT") { guard.beginWrite("w0", "existing", "1", "owner") }
        guard.beginWrite("w1", "", "中文🙂\n1", "owner")
        fails("DUPLICATE_REQUEST_NO_REPLAY") { guard.beginWrite("w1", "", "1", "owner") }
        fails("DRAFT_CHANGED") { guard.beginClear("c1", "other-owner", "中文🙂\n1") }
        fails("DRAFT_CHANGED") { guard.beginClear("c1", "owner", "changed") }
        assertEquals("中文🙂\n1", guard.beginClear("c1", "owner", "中文🙂\n1"))
        guard.clearCompleted()
        fails("DRAFT_NOT_OWNED") { guard.beginClear("c2", "owner", "中文🙂\n1") }
    }
    @Test fun utf8LimitAndControlCharactersAreValidatedBeforeAnyWrite() {
        val guard = DraftGuard("session")
        for (text in listOf(" ", "\u0000", "中".repeat(1334))) fails("INVALID_TEXT") { guard.beginWrite("w", "", text, "owner") }
        guard.beginWrite("w", "", "中".repeat(1333), "owner")
    }
}
