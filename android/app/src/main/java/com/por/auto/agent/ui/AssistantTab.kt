package com.por.auto.agent.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.por.auto.agent.AgentTurn
import com.por.auto.agent.MainUiState

private val EXAMPLES = listOf(
    "打开设置，把屏幕亮度调到最高",
    "打开微信，给文件传输助手发一条「测试」",
    "打开美团，搜附近的咖啡店",
    "打开企业微信，看看今天有哪些群消息",
)

@Composable
fun AssistantTab(
    state: MainUiState,
    onStart: (String) -> Unit,
    onStop: () -> Unit,
    onOpenAccessibility: () -> Unit,
) {
    var goal by rememberSaveable { mutableStateOf("") }
    val listState = rememberLazyListState()
    val stepCount = state.agentTurns.lastOrNull()?.steps?.size ?: 0

    // 有新步骤就跟着滚到底，和聊天窗口一样。
    LaunchedEffect(state.agentTurns.size, stepCount) {
        if (state.agentTurns.isNotEmpty()) {
            runCatching { listState.animateScrollToItem(state.agentTurns.lastIndex) }
        }
    }

    Column(Modifier.fillMaxSize()) {
        if (!state.accessibilityEnabled) {
            Column(Modifier.padding(start = Space.lg, end = Space.lg, top = Space.sm)) {
                Section {
                    SettingRow(
                        title = "无障碍未开启",
                        subtitle = "开启后才能读取和操作屏幕",
                        status = false,
                        trailing = { TextAction("去开启", onOpenAccessibility) },
                    )
                }
            }
        }

        LazyColumn(
            state = listState,
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
            contentPadding = PaddingValues(
                start = Space.lg,
                end = Space.lg,
                top = Space.md,
                bottom = Space.md,
            ),
            verticalArrangement = Arrangement.spacedBy(Space.lg),
        ) {
            if (state.agentTurns.isEmpty()) {
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(Space.md)) {
                        EmptyState(
                            title = "想让手机做什么？",
                            subtitle = "用一句话说清楚目标，AI 会看着屏幕一步步操作；随时可以停。",
                        )
                        EXAMPLES.forEach { example ->
                            ChoicePill(label = example, selected = false, onClick = { goal = example })
                        }
                    }
                }
            }
            items(state.agentTurns) { turn -> AgentTurnView(turn) }
        }

        Surface(color = MaterialTheme.colorScheme.background) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = Space.lg, end = Space.lg, top = Space.sm, bottom = Space.md),
                verticalArrangement = Arrangement.spacedBy(Space.sm),
            ) {
                OutlinedTextField(
                    value = goal,
                    onValueChange = { goal = it },
                    placeholder = { Text("例如：打开微信，给文件传输助手发一条「测试」") },
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 72.dp),
                    enabled = !state.agentRunning,
                    maxLines = 4,
                    textStyle = MaterialTheme.typography.bodyMedium,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(Space.sm)) {
                    if (state.agentRunning) {
                        CompactButton(
                            text = "停止",
                            onClick = onStop,
                            filled = false,
                            modifier = Modifier.weight(1f),
                        )
                    } else {
                        CompactButton(
                            text = "发送",
                            onClick = {
                                onStart(goal)
                                goal = ""
                            },
                            enabled = goal.isNotBlank() && state.aiConfig.ready,
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
                Text(
                    if (state.aiConfig.ready) {
                        "删除、注销、付款这类不可撤销的操作，只有目标里明确提到才会执行。"
                    } else {
                        "还没配置 AI，去设置 → AI 配置 填好接口和模型后才能用。"
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun AgentTurnView(turn: AgentTurn) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Space.sm),
    ) {
        Surface(
            shape = MaterialTheme.shapes.medium,
            color = MaterialTheme.colorScheme.tertiaryContainer,
            modifier = Modifier
                .align(Alignment.End)
                .widthIn(max = 320.dp),
        ) {
            Text(
                turn.goal,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onTertiaryContainer,
                modifier = Modifier.padding(horizontal = Space.md, vertical = Space.sm),
            )
        }
        Surface(
            shape = MaterialTheme.shapes.medium,
            color = MaterialTheme.colorScheme.surface,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(
                modifier = Modifier.padding(horizontal = Space.md, vertical = Space.sm),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                if (turn.steps.isEmpty()) {
                    Text(
                        if (turn.running) "正在看屏幕…" else "没有执行任何步骤",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                turn.steps.forEach { line ->
                    Text(
                        line,
                        fontFamily = FontFamily.Monospace,
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                turn.result?.let { result ->
                    Text(
                        result,
                        style = MaterialTheme.typography.bodyMedium,
                        color = if (turn.failed) {
                            MaterialTheme.colorScheme.error
                        } else {
                            MaterialTheme.colorScheme.primary
                        },
                        modifier = Modifier.padding(top = Space.xs),
                    )
                }
            }
        }
    }
}
