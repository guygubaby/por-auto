package com.wangzan101.mika.porauto

import com.wangzan101.mika.about.PorAutoReleases
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
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
}
