package com.por.auto.agent.wecom

import org.junit.Assert.assertEquals
import org.junit.Test

class WecomDraftTest {

    @Test
    fun existingDraftIsNeverOverwritten() {
        assertEquals(DraftState.Changed, draftStateOf("别人的草稿", "要发的话"))
        assertEquals(DraftState.Empty, draftStateOf("", "要发的话"))
        assertEquals(DraftState.Ready, draftStateOf("要发的话", "要发的话"))
        assertEquals(DraftState.Ready, draftStateOf("", ""))
    }
}
