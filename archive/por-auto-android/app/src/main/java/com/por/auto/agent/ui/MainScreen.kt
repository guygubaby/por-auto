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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.por.auto.agent.MainViewModel
import com.por.auto.agent.task.TaskKind

private data class Tab(
    val label: String,
    val subtitle: String,
    val icon: ImageVector,
)

private val TABS = listOf(
    Tab("助手", "一句话交给 AI 操作手机", Icons.Filled.Face),
    Tab("任务", "AI 操作与企业微信群发", Icons.AutoMirrored.Filled.Send),
    Tab("定时", "按时间自动执行任务", Icons.Filled.DateRange),
    Tab("日志", "每次运行的结果", Icons.AutoMirrored.Filled.List),
    Tab("设置", "权限、AI 与调试", Icons.Filled.Settings),
)

@Composable
fun MainScreen(viewModel: MainViewModel, onOpenNotificationSettings: () -> Unit) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    var tab by rememberSaveable { mutableIntStateOf(0) }
    val tabState = rememberSaveableStateHolder()

    LaunchedEffect(Unit) { viewModel.refresh() }
    LaunchedEffect(tab) { if (tab == 3) viewModel.refresh() }

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
                    0 -> AssistantTab(
                        state = state,
                        onStart = viewModel::startAgent,
                        onStop = viewModel::stopAgent,
                        onNewSession = viewModel::newAgentSession,
                        onOpenAccessibility = {
                            context.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
                        },
                    )
                    1 -> TasksTab(
                        state = state,
                        onAdd = viewModel::addTask,
                        onTrial = { task ->
                            viewModel.trialTask(task)
                            // AI 任务的执行过程在助手里，跟过去看。
                            if (task.kind == TaskKind.Agent &&
                                state.aiConfig.ready && state.accessibilityEnabled
                            ) {
                                tab = 0
                            }
                        },
                        onSend = viewModel::sendTask,
                        onDelete = viewModel::deleteTask,
                    )
                    2 -> ScheduleTab(
                        state = state,
                        onAdd = viewModel::addSchedule,
                        onToggle = viewModel::toggleSchedule,
                        onDelete = viewModel::deleteSchedule,
                        onRunNow = viewModel::runScheduleNow,
                        onUpdate = viewModel::updateSchedule,
                    )
                    3 -> LogsTab(state, viewModel::refresh)
                    else -> SettingsTab(
                        state = state,
                        onOpenNotificationSettings = onOpenNotificationSettings,
                        onCheckUpdate = viewModel::checkUpdate,
                        onDownloadUpdate = viewModel::downloadUpdate,
                        onDismissUpdate = viewModel::dismissUpdate,
                        onTheme = viewModel::setTheme,
                        onFetchAiModels = viewModel::fetchAiModels,
                        onSaveAi = viewModel::saveAi,
                    )
                }
            }
        }
    }
}
