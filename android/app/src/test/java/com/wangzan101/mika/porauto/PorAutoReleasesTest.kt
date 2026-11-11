package com.wangzan101.mika.porauto

import com.wangzan101.mika.about.PorAutoReleases
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertNotEquals
import org.junit.Test

class PorAutoReleasesTest {
    @Test
    fun readsBackendRelease() {
        val info = PorAutoReleases.fromBackend(
            """{"versionCode":19,"versionName":"0.5.0","notes":"更新说明","size":123456,"sha256":"${"a".repeat(64)}","publishedAt":"2026-11-11T12:00:00Z"}""",
        )!!
        assertEquals("0.5.0", info.version)
        assertEquals(19L, info.versionCode)
        assertEquals(123456L, info.apkSize)
        assertEquals("sha256:${"a".repeat(64)}", info.apkDigest)
        assertEquals(PorAutoBackend.APK_URL, info.apkUrl)
        assertEquals("2026-11-11", info.date)
    }

    @Test
    fun ignoresBrokenPayload() {
        assertNull(PorAutoReleases.fromBackend("""{"versionCode":19}"""))
        assertNull(PorAutoReleases.fromBackend("not json"))
    }

    @Test
    fun requiresCompleteIntegrityMetadata() {
        val valid = """{"versionCode":19,"versionName":"0.5.0","size":123,"sha256":"${"a".repeat(64)}"}"""
        for (bad in listOf(
            valid.replace("\"versionCode\":19,", ""),
            valid.replace("\"size\":123,", ""),
            valid.replace("19", "0"),
            valid.replace("123", "-1"),
            valid.replace("a".repeat(64), "invalid"),
        )) assertNull(bad, PorAutoReleases.fromBackend(bad))
    }

    @Test
    fun fixedDownloadUrlStillDistinguishesReleases() {
        val first = PorAutoReleases.fromBackend(
            """{"versionCode":19,"versionName":"0.5.0","size":123,"sha256":"${"a".repeat(64)}"}""",
        )!!
        assertNotEquals(first.downloadId, first.copy(versionCode = 20).downloadId)
        assertNotEquals(first.downloadId, first.copy(apkDigest = "sha256:${"b".repeat(64)}").downloadId)
        assertEquals(first.downloadId, first.copy(notes = "new notes").downloadId)
    }
}
