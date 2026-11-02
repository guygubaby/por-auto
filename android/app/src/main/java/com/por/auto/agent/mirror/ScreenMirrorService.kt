package com.por.auto.agent.mirror

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.util.DisplayMetrics
import android.view.Gravity
import android.view.WindowManager
import android.widget.ImageView
import androidx.core.app.NotificationCompat
import java.nio.ByteBuffer

/**
 * 把屏幕实时投到右上角的小窗里，方便看群发/助手正在点哪里。
 * 先要一次录屏授权；窗口用的是 SYSTEM_ALERT_WINDOW，需要「显示在其他应用上层」。
 */
class ScreenMirrorService : Service() {

    private var projection: MediaProjection? = null
    private var display: VirtualDisplay? = null
    private var reader: ImageReader? = null
    private var thread: HandlerThread? = null
    private var windowManager: WindowManager? = null
    private var view: ImageView? = null
    private var running = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }
        val code = intent?.getIntExtra(EXTRA_CODE, 0) ?: 0
        @Suppress("DEPRECATION")
        val data = intent?.getParcelableExtra<Intent>(EXTRA_DATA)
        if (code == 0 || data == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        startForeground(NOTIFICATION_ID, notification())
        if (!running) {
            running = true
            start(code, data)
        }
        return START_STICKY
    }

    private fun start(code: Int, data: Intent) {
        val manager = getSystemService(MediaProjectionManager::class.java)
        val mediaProjection = manager.getMediaProjection(code, data) ?: run {
            stopSelf()
            return
        }
        projection = mediaProjection
        mediaProjection.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() {
                stopSelf()
            }
        }, Handler(mainLooper))

        val metrics = resources.displayMetrics
        val width = (metrics.widthPixels / 4).coerceAtLeast(180)
        val height = (metrics.heightPixels / 4).coerceAtLeast(320)

        val imageReader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2)
        reader = imageReader

        val worker = HandlerThread("screen-mirror").apply { start() }
        thread = worker
        imageReader.setOnImageAvailableListener({ source ->
            val image = runCatching { source.acquireLatestImage() }.getOrNull() ?: return@setOnImageAvailableListener
            runCatching {
                val plane = image.planes[0]
                val buffer: ByteBuffer = plane.buffer
                val pixelStride = plane.pixelStride
                val rowStride = plane.rowStride
                val rowPadding = rowStride - pixelStride * width
                val bitmap = Bitmap.createBitmap(
                    width + rowPadding / pixelStride,
                    height,
                    Bitmap.Config.ARGB_8888,
                )
                bitmap.copyPixelsFromBuffer(buffer)
                val cropped = Bitmap.createBitmap(bitmap, 0, 0, width, height)
                if (cropped !== bitmap) bitmap.recycle()
                Handler(mainLooper).post { view?.setImageBitmap(cropped) }
            }
            image.close()
        }, Handler(worker.looper))

        display = mediaProjection.createVirtualDisplay(
            "por-auto-mirror",
            width,
            height,
            metrics.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            imageReader.surface,
            null,
            Handler(worker.looper),
        )

        showWindow(metrics)
    }

    private fun showWindow(metrics: DisplayMetrics) {
        if (!android.provider.Settings.canDrawOverlays(this)) return
        val manager = getSystemService(WindowManager::class.java)
        windowManager = manager
        val density = metrics.density
        val width = (140 * density).toInt()
        val height = (width * metrics.heightPixels / metrics.widthPixels)
        val image = ImageView(this).apply {
            scaleType = ImageView.ScaleType.FIT_CENTER
            setBackgroundColor(0xCC000000.toInt())
        }
        val params = WindowManager.LayoutParams(
            width,
            height,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            } else {
                @Suppress("DEPRECATION")
                WindowManager.LayoutParams.TYPE_PHONE
            },
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.END
            x = (12 * density).toInt()
            y = (120 * density).toInt()
        }
        runCatching { manager.addView(image, params) }
        view = image
    }

    private fun notification() = NotificationCompat.Builder(this, CHANNEL_ID)
        .setSmallIcon(android.R.drawable.ic_menu_view)
        .setContentTitle("镜像小窗已开启")
        .setContentText("右上角小窗显示当前屏幕")
        .setOngoing(true)
        .build()

    override fun onCreate() {
        super.onCreate()
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "镜像小窗", NotificationManager.IMPORTANCE_LOW),
        )
    }

    override fun onDestroy() {
        running = false
        view?.let { current -> runCatching { windowManager?.removeView(current) } }
        view = null
        display?.release()
        display = null
        reader?.close()
        reader = null
        projection?.stop()
        projection = null
        thread?.quitSafely()
        thread = null
        super.onDestroy()
    }

    companion object {
        const val ACTION_STOP = "com.por.auto.agent.mirror.STOP"
        const val EXTRA_CODE = "code"
        const val EXTRA_DATA = "data"
        private const val CHANNEL_ID = "por-auto-mirror"
        private const val NOTIFICATION_ID = 2102

        fun stop(context: Context) {
            context.startService(Intent(context, ScreenMirrorService::class.java).setAction(ACTION_STOP))
        }
    }
}
