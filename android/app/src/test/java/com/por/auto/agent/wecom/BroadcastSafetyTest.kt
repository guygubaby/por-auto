package com.por.auto.agent.wecom

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class BroadcastSafetyTest {
    private fun target(status: String, error: String? = null) =
        RecipientResult("group", WecomScope.Groups, status, error)

    @Test
    fun partialRehearsalDoesNotAuthorizeSending() {
        val result = BroadcastResult(
            true,
            listOf(target("rehearsed"), target("failed", "existing draft"), target("skipped")),
        )
        assertEquals("existing draft", result.error)
        assertFalse(result.rehearsed)
        assertFalse(BroadcastResult(true, emptyList()).rehearsed)
        assertFalse(BroadcastResult(true, listOf(target("rehearsed"), target("skipped"))).rehearsed)
        assertTrue(BroadcastResult(true, listOf(target("rehearsed"))).rehearsed)
    }

    @Test
    fun uncertainSendIsNotReportedAsSuccess() {
        val result = BroadcastResult(false, listOf(target("sent"), target("uncertain", "not confirmed")))
        assertEquals("not confirmed", result.error)
        assertEquals(1, result.completed)
        assertEquals(1, result.failed)
    }

    @Test
    fun overlappingRunIsRejectedAndCancellationReleasesGate() = runTest {
        val entered = CompletableDeferred<Unit>()
        val first = launch {
            BroadcastGate.withRun {
                entered.complete(Unit)
                awaitCancellation()
            }
        }
        entered.await()
        try {
            val second = runCatching { BroadcastGate.withRun { error("must not run") } }
            assertTrue(second.exceptionOrNull() is WecomException)
        } finally {
            first.cancelAndJoin()
        }
        assertEquals("available", BroadcastGate.withRun { "available" })
    }

    @Test
    fun failedRunReleasesGate() = runTest {
        assertTrue(runCatching { BroadcastGate.withRun { throw IllegalStateException() } }.isFailure)
        assertEquals(true, BroadcastGate.withRun { true })
    }

    @Test
    fun textValidationUsesUtf8BytesAndRejectsControls() {
        WecomBroadcastRunner.validateText("a".repeat(4000))
        WecomBroadcastRunner.validateText("line 1\nline 2\tend")
        assertThrows(WecomException::class.java) { WecomBroadcastRunner.validateText("a".repeat(4001)) }
        assertThrows(WecomException::class.java) { WecomBroadcastRunner.validateText("\u4e2d".repeat(1334)) }
        assertThrows(WecomException::class.java) { WecomBroadcastRunner.validateText(" ") }
        assertThrows(WecomException::class.java) { WecomBroadcastRunner.validateText("a\u0000b") }
    }
}
