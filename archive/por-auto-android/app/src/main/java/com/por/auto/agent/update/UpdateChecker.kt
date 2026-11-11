package com.por.auto.agent.update

import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.BufferedReader
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

class UpdateException(message: String) : Exception(message)

data class ReleaseInfo(
    val versionCode: Int,
    val versionName: String,
    val notes: String,
    val size: Long,
    val sha256: String,
)

/**
 * 检查更新只认自建的后端：GET /latest 拿版本信息，GET /latest.apk 下安装包。
 * 下载后核对 sha256，对不上就不装。
 */
class UpdateChecker(private val context: Context) {

    fun currentVersionCode(): Int {
        val info = context.packageManager.getPackageInfo(context.packageName, 0)
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            info.longVersionCode.toInt()
        } else {
            @Suppress("DEPRECATION")
            info.versionCode
        }
    }

    /** 服务端还没发过版时返回 null。 */
    suspend fun latest(): ReleaseInfo? = withContext(Dispatchers.IO) {
        val text = request("$BASE_URL/latest") ?: return@withContext null
        val json = JSONObject(text)
        ReleaseInfo(
            versionCode = json.getInt("versionCode"),
            versionName = json.optString("versionName"),
            notes = json.optString("notes"),
            size = json.optLong("size"),
            sha256 = json.optString("sha256"),
        )
    }

    suspend fun download(release: ReleaseInfo): File = withContext(Dispatchers.IO) {
        val dir = File(context.cacheDir, "updates").apply { mkdirs() }
        val target = File(dir, "por-auto-${release.versionCode}.apk")
        val connection = (URL("$BASE_URL/latest.apk").openConnection() as HttpURLConnection).apply {
            connectTimeout = 15_000
            readTimeout = 120_000
        }
        try {
            val code = connection.responseCode
            if (code !in 200..299) throw UpdateException("下载失败：HTTP $code")
            connection.inputStream.use { input ->
                target.outputStream().use { output -> input.copyTo(output) }
            }
        } catch (e: IOException) {
            throw UpdateException("下载失败：${e.message ?: e.javaClass.simpleName}")
        } finally {
            connection.disconnect()
        }
        if (release.sha256.isNotBlank() && sha256(target) != release.sha256.lowercase()) {
            target.delete()
            throw UpdateException("安装包校验失败，已删除")
        }
        target
    }

    fun install(file: File) {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        context.startActivity(
            Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            },
        )
    }

    private fun request(url: String): String? {
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 15_000
            readTimeout = 30_000
            setRequestProperty("Accept", "application/json")
        }
        return try {
            val code = connection.responseCode
            if (code == 404) return null
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use(BufferedReader::readText).orEmpty()
            if (code !in 200..299) throw UpdateException("检查更新失败：HTTP $code")
            text
        } catch (e: IOException) {
            throw UpdateException("检查更新失败：${e.message ?: e.javaClass.simpleName}")
        } finally {
            connection.disconnect()
        }
    }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(8192)
            while (true) {
                val read = input.read(buffer)
                if (read <= 0) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    private companion object {
        const val BASE_URL = "https://por-auto.guygubaby.top"
    }
}
