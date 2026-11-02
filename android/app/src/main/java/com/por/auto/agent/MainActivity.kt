package com.por.auto.agent

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import com.por.auto.agent.capture.CaptureNotifier
import com.por.auto.agent.ui.MainScreen
import com.por.auto.agent.ui.PorAutoTheme

class MainActivity : ComponentActivity() {

    private val viewModel: MainViewModel by viewModels()

    private val notificationPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) {
            viewModel.showCaptureNotification()
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            PorAutoTheme {
                MainScreen(viewModel, onNotify = ::showCaptureNotification)
            }
        }
        CaptureNotifier(this).ensureChannel()
    }

    private fun showCaptureNotification() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            viewModel.showCaptureNotification()
        }
    }

    override fun onResume() {
        super.onResume()
        viewModel.refresh()
    }
}
