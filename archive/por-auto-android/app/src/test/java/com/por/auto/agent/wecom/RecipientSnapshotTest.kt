package com.por.auto.agent.wecom

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertNull
import org.junit.Test

class RecipientSnapshotTest {
    @Test
    fun viewportBoundaryRowsAreCollectedAndTappedInsideTheList() {
        val viewport = listOf(0, 0, 300, 650)
        assertEquals(150 to 625, visibleRowCenter(listOf(0, 600, 300, 700), viewport))
        assertEquals(150 to 25, visibleRowCenter(listOf(0, -50, 300, 50), viewport))
        assertNull(visibleRowCenter(listOf(0, 650, 300, 750), viewport))
        val snapshot = RecipientSnapshot()
        snapshot.addPage((0..6).map { RecipientRow("group-$it", it) }, 13)
        snapshot.addPage((6..12).map { RecipientRow("group-$it", it) }, 13)
        assertEquals((0..12).map { "group-$it" }, snapshot.finish())
    }

    @Test
    fun viewportOverlapDoesNotDuplicateRecipients() {
        val snapshot = RecipientSnapshot()
        snapshot.addPage(listOf(RecipientRow("A", 0), RecipientRow("B", 1)), 3)
        snapshot.addPage(listOf(RecipientRow("B", 1), RecipientRow("C", 2)), 3)
        assertEquals(listOf("A", "B", "C"), snapshot.finish())
    }

    @Test
    fun duplicateTitleOnDifferentPageStopsDiscovery() {
        val snapshot = RecipientSnapshot()
        snapshot.addPage(listOf(RecipientRow("A", 0)), 2)
        assertThrows(WecomException::class.java) {
            snapshot.addPage(listOf(RecipientRow(" A ", 1)), 2)
        }
    }

    @Test
    fun reorderedOrResizedListStopsDiscovery() {
        val reordered = RecipientSnapshot()
        reordered.addPage(listOf(RecipientRow("A", 0)), 2)
        assertThrows(WecomException::class.java) {
            reordered.addPage(listOf(RecipientRow("B", 0)), 2)
        }
        val resized = RecipientSnapshot()
        resized.addPage(listOf(RecipientRow("A", 0)), 2)
        assertThrows(WecomException::class.java) {
            resized.addPage(listOf(RecipientRow("B", 1)), 3)
        }
    }

    @Test
    fun missingRowsCannotBecomeAFrozenList() {
        val gap = RecipientSnapshot()
        gap.addPage(listOf(RecipientRow("A", 0), RecipientRow("C", 2)), null)
        assertThrows(WecomException::class.java) { gap.finish() }
        val incomplete = RecipientSnapshot()
        incomplete.addPage(listOf(RecipientRow("A", 0)), 2)
        assertThrows(WecomException::class.java) { incomplete.finish() }
    }

    @Test
    fun unindexedListIsAllowedOnlyOnOnePage() {
        val snapshot = RecipientSnapshot()
        snapshot.addPage(listOf(RecipientRow("A", null)), 1)
        assertEquals(listOf("A"), snapshot.finish())
        assertThrows(WecomException::class.java) {
            snapshot.addPage(listOf(RecipientRow("B", null)), 1)
        }
    }
}
