package com.por.auto.agent.wecom

import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class RunStoreTest {
    @get:Rule
    val temporary = TemporaryFolder()

    @Test
    fun latestAndHistoryPreserveAStoppedRun() {
        val store = RunStore(temporary.root)
        val result = BroadcastResult(
            true,
            listOf(
                RecipientResult("A", WecomScope.Groups, "rehearsed"),
                RecipientResult("B", WecomScope.Groups, "failed", "existing draft"),
            ),
        )
        store.save(result)
        assertEquals(result, store.latest())
        val history = store.history().single()
        assertEquals(1, history.completed)
        assertEquals(1, history.failed)
        assertEquals(result.results, history.targets)
        assertEquals(result.error, history.error)
    }

    @Test
    fun runsFinishedInTheSameMillisecondHaveDifferentUiKeys() {
        listOf("run-a.json", "run-b.json").forEach { name ->
            File(temporary.root, name).writeText("""{"finishedAt":123,"targets":[]}""")
        }
        val history = RunStore(temporary.root).history()
        assertEquals(2, history.size)
        assertEquals(1, history.map { it.finishedAt }.distinct().size)
        assertEquals(2, history.map { it.id }.distinct().size)
    }
}
