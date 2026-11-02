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
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
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
    onOpenAi: () -> Unit,
    onToggleOverlay: () -> Unit,
    onNotify: () -> Unit,
    onCapture: () -> Unit,
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
            SettingRow(
                title = "悬浮读屏按钮",
                subtitle = "在企微页面上点一下读取当前界面",
                trailing = {
                    Switch(checked = state.overlayVisible, onCheckedChange = { onToggleOverlay() })
                },
            )
            divider()
            SettingRow(
                title = "通知按钮",
                subtitle = "下拉通知栏也能触发读屏",
                trailing = { TextAction("显示") { onNotify() } },
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

        Section(title = "智能") {
            SettingRow(
                title = "AI 配置",
                subtitle = if (state.aiConfig.ready) {
                    "${state.aiConfig.provider.label} · ${state.aiConfig.model}"
                } else {
                    "还没配置，群发和助手用不了 AI"
                },
                status = state.aiConfig.ready,
                chevron = true,
                onClick = onOpenAi,
            )
        }

        Section(
            title = "调试",
            trailing = { TextAction(if (showJson) "收起" else "查看") { showJson = !showJson } },
        ) {
            SettingRow(
                title = "读取当前屏幕",
                subtitle = state.latestSummary ?: "还没有记录",
                trailing = { TextAction("读取") { onCapture() } },
            )
            state.message?.let {
                Text(
                    it,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
            if (showJson && state.latestJson != null) {
                Row(horizontalArrangement = Arrangement.spacedBy(Space.xs)) {
                    TextAction("复制") { copy(context, state.latestJson) }
                    TextAction("分享") { share(context, state.latestJson) }
                }
                SelectionContainer {
                    Text(
                        state.latestJson.take(4_000),
                        fontFamily = FontFamily.Monospace,
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }

        Section(title = "关于") {
            SettingRow(title = "PorAuto Agent", subtitle = "版本 ${appVersion(context)}")
            Text(
                "已知版本按资源 ID 定位，未收录的企微版本按界面结构定位。发送成功只代表界面出现新消息，不代表对方已收到。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
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
