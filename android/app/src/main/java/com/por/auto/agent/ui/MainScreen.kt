package com.por.auto.agent.ui

import android.content.Intent
import android.provider.Settings
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.por.auto.agent.MainViewModel

private data class Tab(val label: String, val icon: ImageVector)

private val TABS = listOf(
    Tab("群发", Icons.AutoMirrored.Filled.Send),
    Tab("定时", Icons.Filled.DateRange),
    Tab("日志", Icons.AutoMirrored.Filled.List),
    Tab("设置", Icons.Filled.Settings),
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainScreen(viewModel: MainViewModel, onNotify: () -> Unit) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    var tab by rememberSaveable { mutableIntStateOf(0) }
    val tabState = rememberSaveableStateHolder()

    LaunchedEffect(Unit) { viewModel.refresh() }
    LaunchedEffect(tab) { if (tab == 2) viewModel.refresh() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(TABS[tab].label, style = androidx.compose.material3.MaterialTheme.typography.titleLarge) },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = androidx.compose.material3.MaterialTheme.colorScheme.background,
                ),
            )
        },
        bottomBar = {
            NavigationBar(containerColor = androidx.compose.material3.MaterialTheme.colorScheme.surface) {
                TABS.forEachIndexed { index, item ->
                    NavigationBarItem(
                        selected = tab == index,
                        onClick = { tab = index },
                        icon = { Icon(item.icon, contentDescription = item.label) },
                        label = { Text(item.label) },
                    )
                }
            }
        },
        containerColor = androidx.compose.material3.MaterialTheme.colorScheme.background,
    ) { padding ->
        val content = Modifier.padding(padding).consumeWindowInsets(padding).imePadding()
        tabState.SaveableStateProvider(tab) {
            Box(content) {
                when (tab) {
                    0 -> BroadcastTab(
                        state = state,
                        onRun = viewModel::runBroadcast,
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
                    2 -> LogsTab(state, viewModel::refresh)
                    else -> SettingsTab(
                        state = state,
                        onToggleOverlay = viewModel::toggleOverlay,
                        onNotify = onNotify,
                        onCapture = viewModel::captureNow,
                        onFetchModels = viewModel::fetchAiModels,
                        onSaveAi = viewModel::saveAi,
                    )
                }
            }
        }
    }
}
