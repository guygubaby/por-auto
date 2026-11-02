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
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.por.auto.agent.MainUiState
import com.por.auto.agent.wecom.WecomScope

@Composable
fun BroadcastTab(
    state: MainUiState,
    onRun: (Boolean, String, WecomScope) -> Unit,
    onResume: () -> Unit,
    onOpenAccessibility: () -> Unit,
    onAiGenerate: (String) -> Unit,
    onConsumeAiDraft: () -> Unit,
) {
    var text by rememberSaveable { mutableStateOf("OK") }
    var instruction by rememberSaveable { mutableStateOf("") }
    var scope by rememberSaveable { mutableStateOf(WecomScope.Groups) }
    var confirm by remember { mutableStateOf(false) }
    var confirmResume by remember { mutableStateOf(false) }
    var showLog by remember { mutableStateOf(false) }
    val canSend = !state.p1Running && state.rehearsed(text, scope) && text.isNotBlank()

    androidx.compose.runtime.LaunchedEffect(state.aiDraft) {
        state.aiDraft?.let {
            text = it
            state.aiDraftScope?.let { generated -> scope = generated }
            onConsumeAiDraft()
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(start = Space.lg, end = Space.lg, top = Space.sm, bottom = Space.xl),
        verticalArrangement = Arrangement.spacedBy(Space.lg),
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

        Section(title = "消息") {
            OutlinedTextField(
                value = text,
                onValueChange = { text = it },
                placeholder = { Text("要发送的内容") },
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 72.dp),
                enabled = !state.p1Running,
                textStyle = MaterialTheme.typography.bodyLarge,
            )
            if (state.aiConfig.ready) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(Space.sm),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    OutlinedTextField(
                        value = instruction,
                        onValueChange = { instruction = it },
                        placeholder = { Text("让 AI 写：提醒大家下午三点开会") },
                        singleLine = true,
                        enabled = !state.p1Running && !state.aiBusy,
                        modifier = Modifier.weight(1f),
                        textStyle = MaterialTheme.typography.bodyMedium,
                    )
                    CompactButton(
                        text = if (state.aiBusy) "生成中" else "生成",
                        onClick = { onAiGenerate(instruction) },
                        enabled = !state.aiBusy && instruction.isNotBlank(),
                        filled = false,
                    )
                }
            }
            ScopePicker(scope = scope, onScope = { scope = it }, enabled = !state.p1Running)
            Text(
                "范围：${scope.label}。正式发送前必须先试运行。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(Space.sm)) {
                CompactButton(
                    text = "试运行",
                    onClick = { onRun(true, text, scope) },
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
            state.p1Resume?.let { job ->
                CompactButton(
                    text = "继续${if (job.dryRun) "试运行" else "发送"}剩余 ${job.remaining.size} 个",
                    onClick = { if (job.dryRun) onResume() else confirmResume = true },
                    enabled = !state.p1Running,
                    filled = false,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }

        state.message?.let {
            Text(
                it,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.padding(horizontal = Space.xs),
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
                    val ok = result.status == "sent" || result.status == "rehearsed"
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(Space.sm),
                    ) {
                        StatusDot(ok)
                        Column(Modifier.weight(1f)) {
                            Text(result.title, style = MaterialTheme.typography.bodyMedium)
                            result.error?.let {
                                Text(
                                    it,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                        Text(
                            statusLabel(result.status),
                            style = MaterialTheme.typography.labelSmall,
                            color = if (ok) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.error,
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
            text = { Text("将向${scope.label}发送「$text」，确定？") },
            confirmButton = {
                TextButton(onClick = {
                    confirm = false
                    onRun(false, text, scope)
                }) { Text("发送") }
            },
            dismissButton = {
                TextButton(onClick = { confirm = false }) { Text("取消") }
            },
        )
    }

    state.p1Resume?.takeIf { confirmResume }?.let { job ->
        AlertDialog(
            onDismissRequest = { confirmResume = false },
            title = { Text("继续发送") },
            text = {
                Text("将向剩余 ${job.remaining.size} 个${job.scope.label}发送「${job.text}」，确定？")
            },
            confirmButton = {
                TextButton(onClick = {
                    confirmResume = false
                    onResume()
                }) { Text("继续") }
            },
            dismissButton = {
                TextButton(onClick = { confirmResume = false }) { Text("取消") }
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
