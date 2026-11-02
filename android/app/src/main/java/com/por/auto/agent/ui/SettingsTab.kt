package com.por.auto.agent.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.sp
import com.por.auto.agent.MainUiState

@Composable
fun SettingsTab(
    state: MainUiState,
    onOpenNotificationSettings: () -> Unit,
    onCheckUpdate: () -> Unit,
    onDownloadUpdate: () -> Unit,
    onDismissUpdate: () -> Unit,
    onTheme: (ThemeMode) -> Unit,
) {
    val context = LocalContext.current
    var showJson by remember { mutableStateOf(false) }
    val divider = @Composable { HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(start = Space.lg, end = Space.lg, top = Space.sm, bottom = Space.xl),
        verticalArrangement = Arrangement.spacedBy(Space.lg),
    ) {
        Section(title = "权限") {
            SettingRow(
                title = "无障碍服务",
                subtitle = if (state.accessibilityEnabled) "已开启，可以读取和操作屏幕" else "未开启，群发和助手都无法运行",
                status = state.accessibilityEnabled,
                trailing = {
                    TextAction(if (state.accessibilityEnabled) "设置" else "去开启") {
                        context.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
                    }
                },
            )
            divider()
            divider()
            SettingRow(
                title = "通知",
                subtitle = if (state.notificationsEnabled) {
                    "已开启，跑完和定时会提醒"
                } else {
                    "未开启，跑完不会提醒"
                },
                status = state.notificationsEnabled,
                trailing = {
                    if (!state.notificationsEnabled) {
                        TextAction("去开启") { onOpenNotificationSettings() }
                    }
                },
            )
            divider()
            SettingRow(
                title = "精确闹钟",
                subtitle = if (state.exactAlarmAllowed) "已允许，定时按点执行" else "未允许，后台任务可能延迟或跳过",
                status = state.exactAlarmAllowed,
                trailing = {
                    if (!state.exactAlarmAllowed && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                        TextAction("去允许") {
                            context.startActivity(
                                Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM)
                                    .setData(Uri.parse("package:${context.packageName}")),
                            )
                        }
                    }
                },
            )
        }

        Section(title = "外观") {
            SettingRow(title = "主题", subtitle = "当前：${state.theme.label}")
            Row(horizontalArrangement = Arrangement.spacedBy(Space.sm)) {
                ThemeMode.entries.forEach { mode ->
                    ChoicePill(
                        label = mode.label,
                        selected = state.theme == mode,
                        onClick = { onTheme(mode) },
                    )
                }
            }
        }

        Section(title = "智能") {
            SettingRow(
                title = "AI 配置",
                subtitle = if (state.aiConfig.ready) {
                    "已配置 · ${state.aiConfig.provider.label}"
                } else {
                    "还没配置，群发和助手用不了 AI"
                },
                status = state.aiConfig.ready,
            )
        }


        Section(title = "关于") {
            SettingRow(title = "PorAuto", subtitle = "版本 ${appVersion(context)}")
            divider()
            SettingRow(
                title = "检查更新",
                subtitle = state.update.message ?: "从 por-auto.guygubaby.top 获取新版本",
                status = state.update.release != null,
                trailing = {
                    if (!state.update.busy) TextAction("检查") { onCheckUpdate() }
                },
            )
            Text(
                "已知版本按资源 ID 定位，未收录的企微版本按界面结构定位。发送成功只代表界面出现新消息，不代表对方已收到。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }

    state.update.release?.let { release ->
        AlertDialog(
            onDismissRequest = onDismissUpdate,
            title = { Text("发现新版本 ${release.versionName}") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(Space.xs)) {
                    if (release.notes.isNotBlank()) {
                        Text(release.notes, style = MaterialTheme.typography.bodyMedium)
                    }
                    Text(
                        "安装包 ${"%.1f".format(release.size / 1024.0 / 1024.0)} MB，下载后交给系统安装",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            },
            confirmButton = {
                TextButton(onClick = onDownloadUpdate, enabled = !state.update.busy) {
                    Text(if (state.update.busy) "请稍候" else "下载并安装")
                }
            },
            dismissButton = {
                TextButton(onClick = onDismissUpdate) { Text("以后再说") }
            },
        )
    }
}

private fun appVersion(context: Context): String = runCatching {
    context.packageManager.getPackageInfo(context.packageName, 0).versionName
}.getOrNull() ?: "未知"

private fun copy(context: Context, text: String) {
    val clipboard = context.getSystemService(ClipboardManager::class.java)
    clipboard?.setPrimaryClip(ClipData.newPlainText("PorAuto dump", text))
    Toast.makeText(context, "已复制", Toast.LENGTH_SHORT).show()
}

private fun share(context: Context, text: String) {
    val intent = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, text)
    }
    context.startActivity(Intent.createChooser(intent, "分享节点 JSON"))
}
