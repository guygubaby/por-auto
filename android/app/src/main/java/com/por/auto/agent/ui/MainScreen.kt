package com.por.auto.agent.ui

import android.content.Intent
import android.provider.Settings
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Face
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.por.auto.agent.MainViewModel

private data class Tab(
    val label: String,
    val subtitle: String,
    val icon: ImageVector,
)

private val TABS = listOf(
    Tab("群发", "给企业微信会话发送消息", Icons.AutoMirrored.Filled.Send),
    Tab("定时", "每天按点自动发送", Icons.Filled.DateRange),
    Tab("助手", "一句话交给 AI 操作屏幕", Icons.Filled.Face),
    Tab("日志", "每次运行的结果", Icons.AutoMirrored.Filled.List),
    Tab("设置", "权限、AI 与调试", Icons.Filled.Settings),
)

@Composable
fun MainScreen(viewModel: MainViewModel, onNotify: () -> Unit) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    var tab by rememberSaveable { mutableIntStateOf(0) }
    val tabState = rememberSaveableStateHolder()

    LaunchedEffect(Unit) { viewModel.refresh() }
    LaunchedEffect(tab) { if (tab == 3) viewModel.refresh() }

    if (state.passcode.required) {
        PasscodeScreen(state = state.passcode, onSubmit = viewModel::submitPasscode)
        return
    }

    Scaffold(
        topBar = { AppHeader(TABS[tab].label, TABS[tab].subtitle) },
        bottomBar = {
            NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
                TABS.forEachIndexed { index, item ->
                    NavigationBarItem(
                        selected = tab == index,
                        onClick = { tab = index },
                        icon = { Icon(item.icon, contentDescription = item.label) },
                        label = { Text(item.label, style = MaterialTheme.typography.labelSmall) },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = MaterialTheme.colorScheme.onTertiaryContainer,
                            selectedTextColor = MaterialTheme.colorScheme.onSurface,
                            indicatorColor = MaterialTheme.colorScheme.tertiaryContainer,
                            unselectedIconColor = MaterialTheme.colorScheme.onSurfaceVariant,
                            unselectedTextColor = MaterialTheme.colorScheme.onSurfaceVariant,
                        ),
                    )
                }
            }
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        val content = Modifier
            .padding(padding)
            .consumeWindowInsets(padding)
            .imePadding()
        tabState.SaveableStateProvider(tab) {
            Box(content) {
                when (tab) {
                    0 -> BroadcastTab(
                        state = state,
                        onRun = viewModel::runBroadcast,
                        onResume = viewModel::resumeBroadcast,
                        onOpenAccessibility = {
                            context.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
                        },
                        onAiGenerate = viewModel::aiGenerate,
                        onConsumeAiDraft = viewModel::consumeAiDraft,
                    )
                    1 -> ScheduleTab(
                        state = state,
                        onAdd = viewModel::addSchedule,
                        onToggle = viewModel::toggleSchedule,
                        onDelete = viewModel::deleteSchedule,
                        onRunNow = viewModel::runScheduleNow,
                    )
                    2 -> AssistantTab(
                        state = state,
                        onStart = viewModel::startAgent,
                        onStop = viewModel::stopAgent,
                        onOpenAccessibility = {
                            context.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
                        },
                    )
                    3 -> LogsTab(state, viewModel::refresh)
                    else -> SettingsTab(
                        state = state,
                        onNotify = onNotify,
                        onCapture = viewModel::captureNow,
                        onCheckUpdate = viewModel::checkUpdate,
                        onDownloadUpdate = viewModel::downloadUpdate,
                        onDismissUpdate = viewModel::dismissUpdate,
                        onTheme = viewModel::setTheme,
                    )
                }
            }
        }
    }
}
