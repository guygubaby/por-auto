package com.por.auto.input

import android.content.ContentProvider
import android.content.ContentValues
import android.content.pm.PackageManager
import android.database.Cursor
import android.net.Uri
import android.os.Binder
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.provider.Settings
import org.json.JSONObject
import java.security.MessageDigest
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class InputProvider : ContentProvider() {
    override fun onCreate() = true
    @Suppress("DEPRECATION")
    private fun authorize() {
        val uid = Binder.getCallingUid()
        if (uid == 2000 || uid == Process.myUid()) return
        val pm = requireNotNull(context).packageManager
        val packages = pm.getPackagesForUid(uid) ?: throw SecurityException("UNTRUSTED_CALLER")
        if (packages.size != 1 || packages[0] != "org.autojs.autojs6") throw SecurityException("UNTRUSTED_CALLER")
        val signatures = pm.getPackageInfo(packages[0], PackageManager.GET_SIGNATURES).signatures
        if (signatures == null || signatures.size != 1) throw SecurityException("UNTRUSTED_CALLER")
        val hash = MessageDigest.getInstance("SHA-256").digest(signatures[0].toByteArray()).joinToString("") { "%02x".format(it.toInt() and 255) }
        if (hash != "31a681fcfffb3e428420cae280ded89292b12a3b0f59e19b7a73e32a8ae4c213") throw SecurityException("UNTRUSTED_CALLER")
    }

    override fun call(method: String, arg: String?, extras: Bundle?): Bundle {
        authorize()
        val canceled = AtomicBoolean(false)
        val task = FutureTask {
            try {
                if (method !in listOf("status", "read", "write", "clearOwned", "restore") || (arg?.length ?: 0) > 25000) throw InputFailure("INVALID_REQUEST")
                val request = JSONObject(arg ?: "{}")
                if (request.optInt("protocolVersion") != 1) throw InputFailure("UNSUPPORTED_PROTOCOL")
                val result = if (method == "status") {
                    JSONObject().put("selectedIme", Settings.Secure.getString(requireNotNull(context).contentResolver, Settings.Secure.DEFAULT_INPUT_METHOD))
                } else (PorInputMethod.current ?: throw InputFailure("IME_NOT_SELECTED")).execute(method, request, canceled)
                result.put("ok", true).put("protocolVersion", 1).put("versionCode", BuildConfig.VERSION_CODE)
            } catch (error: InputFailure) { JSONObject().put("ok", false).put("error", error.code) }
            catch (_: Exception) { JSONObject().put("ok", false).put("error", "INPUT_REQUEST_FAILED_NO_REPLAY") }
        }
        val handler = Handler(Looper.getMainLooper())
        return try {
            if (!handler.post(task)) throw IllegalStateException()
            Bundle().apply { putString("result", task.get(8, TimeUnit.SECONDS).toString()) }
        } catch (_: Exception) {
            canceled.set(true); task.cancel(false); handler.removeCallbacks(task)
            Bundle().apply { putString("result", "{\"ok\":false,\"error\":\"INPUT_TIMEOUT_NO_REPLAY\"}") }
        }
    }
    override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor = throw UnsupportedOperationException()
    override fun getType(uri: Uri): String = throw UnsupportedOperationException()
    override fun insert(uri: Uri, values: ContentValues?): Uri = throw UnsupportedOperationException()
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = throw UnsupportedOperationException()
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = throw UnsupportedOperationException()
}
