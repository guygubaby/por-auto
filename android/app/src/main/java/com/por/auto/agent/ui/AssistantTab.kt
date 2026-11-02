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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.por.auto.agent.MainUiState

@Composable
fun AssistantTab(
    state: MainUiState,
    onStart: (String) -> Unit,
    onStop: () -> Unit,
    onOpenAccessibility: () -> Unit,
) {
    var goal by rememberSaveable { mutableStateOf("") }

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
                    subtitle = "开启后才能读取和操作屏幕",
                    status = false,
                    trailing = { TextAction("去开启", onOpenAccessibility) },
                )
            }
        }

        Section(title = "目标") {
            OutlinedTextField(
                value = goal,
                onValueChange = { goal = it },
                placeholder = { Text("例如：打开企业微信，看看今天有哪些群消息") },
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 96.dp),
                enabled = !state.agentRunning,
                textStyle = MaterialTheme.typography.bodyMedium,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(Space.sm)) {
                CompactButton(
                    text = if (state.agentRunning) "执行中" else "开始",
                    onClick = { onStart(goal) },
                    enabled = !state.agentRunning && goal.isNotBlank() && state.aiConfig.ready,
                    modifier = Modifier.weight(1f),
                )
                CompactButton(
                    text = "停止",
                    onClick = onStop,
                    enabled = state.agentRunning,
                    filled = false,
                    modifier = Modifier.weight(1f),
                )
            }
            Text(
                if (state.aiConfig.ready) {
                    "AI 会直接操作当前屏幕，随时可以点停止；删除、退出、支付这类操作会被拦下。"
                } else {
                    "还没配置 AI，去设置 → AI 配置 填好接口和模型后才能用。"
                },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        state.agentStatus?.let {
            Text(
                it,
                style = MaterialTheme.typography.bodyMedium,
                color = if (it.startsWith("停止")) {
                    MaterialTheme.colorScheme.error
                } else {
                    MaterialTheme.colorScheme.primary
                },
                modifier = Modifier.padding(horizontal = Space.xs),
            )
        }

        if (state.agentSteps.isNotEmpty()) {
            Section(title = "执行过程") {
                state.agentSteps.forEach { line ->
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
