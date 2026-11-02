package com.por.auto.agent.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.por.auto.agent.MainUiState

@Composable
fun BroadcastTab(
    state: MainUiState,
    onRun: (Boolean, String) -> Unit,
    onOpenAccessibility: () -> Unit,
    onAiGenerate: (String) -> Unit,
    onConsumeAiDraft: () -> Unit,
) {
    var text by rememberSaveable { mutableStateOf("1") }
    var instruction by rememberSaveable { mutableStateOf("") }
    var confirm by remember { mutableStateOf(false) }
    var showLog by remember { mutableStateOf(false) }
    val canSend = !state.p1Running && state.p1DryRunText == text && text.isNotBlank()

    androidx.compose.runtime.LaunchedEffect(state.aiDraft) {
        state.aiDraft?.let {
            text = it
            onConsumeAiDraft()
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        if (!state.accessibilityEnabled) {
            Section {
                SettingRow(
                    title = "无障碍未开启",
                    subtitle = "开启后才能读取和操作企业微信",
                    status = false,
                    trailing = { TextAction("去开启", onOpenAccessibility) },
                )
            }
        }

        Section(
            title = "消息",
            trailing = if (state.aiConfig.ready) {
                { Text("AI 已配置", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary) }
            } else {
                null
            },
        ) {
            OutlinedTextField(
                value = text,
                onValueChange = { text = it },
                placeholder = { Text("要发送的内容") },
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 64.dp),
                enabled = !state.p1Running,
                textStyle = MaterialTheme.typography.bodyLarge,
            )
            Text(
                "范围：全部群聊。正式发送前必须先试运行。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                CompactButton(
                    text = "试运行",
                    onClick = { onRun(true, text) },
                    enabled = !state.p1Running && text.isNotBlank(),
                    filled = false,
                    modifier = Modifier.weight(1f),
                )
                CompactButton(
                    text = "正式发送",
                    onClick = { confirm = true },
                    enabled = canSend,
                    modifier = Modifier.weight(1f),
                )
            }
            if (state.aiConfig.ready) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                ) {
                    OutlinedTextField(
                        value = instruction,
                        onValueChange = { instruction = it },
                        placeholder = { Text("让 AI 写：例如 提醒大家下午三点开会") },
                        singleLine = true,
                        modifier = Modifier.weight(1f),
                        textStyle = MaterialTheme.typography.bodyMedium,
                    )
                    CompactButton(
                        text = if (state.aiBusy) "生成中" else "AI 生成",
                        onClick = { onAiGenerate(instruction) },
                        enabled = !state.aiBusy && instruction.isNotBlank(),
                        filled = false,
                    )
                }
            }
        }

        state.message?.let {
            Text(
                it,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.padding(horizontal = 4.dp),
            )
        }

        if (state.p1Results.isNotEmpty()) {
            Section(
                title = "本次结果",
                trailing = if (state.p1Log.isNotEmpty()) {
                    { TextAction(if (showLog) "收起过程" else "执行过程") { showLog = !showLog } }
                } else {
                    null
                },
            ) {
                state.p1Results.forEach { result ->
                    val suffix = result.error?.let { " · $it" }.orEmpty()
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(
                            statusLabel(result.status),
                            style = MaterialTheme.typography.bodyMedium,
                            color = if (result.status == "sent" || result.status == "rehearsed") {
                                MaterialTheme.colorScheme.primary
                            } else {
                                MaterialTheme.colorScheme.error
                            },
                        )
                        Text(
                            "${result.title}$suffix",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                if (showLog) {
                    state.p1Log.takeLast(12).forEach { line ->
                        Text(
                            line,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 11.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }

    if (confirm) {
        AlertDialog(
            onDismissRequest = { confirm = false },
            title = { Text("确认发送") },
            text = { Text("将向全部群聊发送「$text」，确定？") },
            confirmButton = {
                TextButton(onClick = {
                    confirm = false
                    onRun(false, text)
                }) { Text("发送") }
            },
            dismissButton = {
                TextButton(onClick = { confirm = false }) { Text("取消") }
            },
        )
    }
}

fun statusLabel(status: String): String = when (status) {
    "sent" -> "已发送"
    "rehearsed" -> "试运行通过"
    "failed" -> "失败"
    "uncertain" -> "结果不明"
    "skipped" -> "已跳过"
    else -> status
}
