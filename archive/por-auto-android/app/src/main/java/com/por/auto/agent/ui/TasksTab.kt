package com.por.auto.agent.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.por.auto.agent.MainUiState
import com.por.auto.agent.task.Task
import com.por.auto.agent.task.TaskKind
import com.por.auto.agent.wecom.WecomScope

@Composable
fun TasksTab(
    state: MainUiState,
    onAdd: (String, TaskKind, String, String, WecomScope) -> Unit,
    onTrial: (Task) -> Unit,
    onSend: (Task) -> Unit,
    onDelete: (String) -> Unit,
) {
    var adding by rememberSaveable { mutableStateOf(false) }
    var title by rememberSaveable { mutableStateOf("") }
    var kind by rememberSaveable { mutableStateOf(TaskKind.Agent) }
    var prompt by rememberSaveable { mutableStateOf("") }
    var message by rememberSaveable { mutableStateOf("") }
    var scope by rememberSaveable { mutableStateOf(WecomScope.Groups) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(start = Space.lg, end = Space.lg, top = Space.sm, bottom = Space.xl),
        verticalArrangement = Arrangement.spacedBy(Space.lg),
    ) {
        if (state.message != null) {
            Text(
                state.message,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = Space.xs),
            )
        }

        Section(title = "任务") {
            if (state.tasks.isEmpty()) {
                EmptyState(
                    "还没有任务",
                    "任务可以是一句交给 AI 的指令，也可以是一段企业微信群发；建好后能试运行，也能被定时任务选中。",
                )
            }
            state.tasks.forEachIndexed { index, task ->
                if (index > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                TaskRow(
                    task = task,
                    busy = state.p1Running,
                    onTrial = { onTrial(task) },
                    onSend = { onSend(task) },
                    onDelete = { onDelete(task.id) },
                )
            }
            if (state.p1Running) {
                Text(
                    state.p1Log.lastOrNull() ?: "正在执行…",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        Section(title = "新建任务") {
            if (!adding) {
                CompactButton(
                    text = "添加任务",
                    onClick = { adding = true },
                    modifier = Modifier.fillMaxWidth(),
                )
            } else {
                OutlinedTextField(
                    value = title,
                    onValueChange = { title = it },
                    singleLine = true,
                    label = { Text("名称") },
                    placeholder = { Text("例如：早会提醒") },
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(Space.sm)) {
                    TaskKind.entries.forEach { option ->
                        ChoicePill(
                            label = option.label,
                            selected = kind == option,
                            onClick = { kind = option },
                        )
                    }
                }
                when (kind) {
                    TaskKind.Agent -> {
                        OutlinedTextField(
                            value = prompt,
                            onValueChange = { prompt = it },
                            placeholder = { Text("例如：打开企业微信，看看今天有哪些群消息") },
                            modifier = Modifier
                                .fillMaxWidth()
                                .heightIn(min = 96.dp),
                            textStyle = MaterialTheme.typography.bodyMedium,
                        )
                        Text(
                            "助手会照着这句话在当前屏幕上一步步操作。",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    TaskKind.Wecom -> {
                        OutlinedTextField(
                            value = message,
                            onValueChange = { message = it },
                            placeholder = { Text("要发送的消息正文") },
                            modifier = Modifier
                                .fillMaxWidth()
                                .heightIn(min = 96.dp),
                            textStyle = MaterialTheme.typography.bodyMedium,
                        )
                        ScopePicker(scope = scope, onScope = { scope = it })
                        Text(
                            "群发任务需要先试运行写草稿，成功后才能正式发送。",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(Space.sm)) {
                    CompactButton(
                        text = "添加",
                        onClick = {
                            if (kind == TaskKind.Agent && prompt.isBlank()) return@CompactButton
                            if (kind == TaskKind.Wecom && message.isBlank()) return@CompactButton
                            onAdd(title, kind, prompt, message, scope)
                            title = ""
                            prompt = ""
                            message = ""
                            adding = false
                        },
                        modifier = Modifier.weight(1f),
                    )
                    CompactButton(
                        text = "取消",
                        onClick = { adding = false },
                        filled = false,
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }
    }
}

@Composable
private fun TaskRow(
    task: Task,
    busy: Boolean,
    onTrial: () -> Unit,
    onSend: () -> Unit,
    onDelete: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Space.xs)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Space.sm)) {
            Text(task.title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
            KindTag(task.kind)
        }
        Text(
            task.summary,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 3,
        )
        Text(
            taskStatus(task),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(Space.xs)) {
            TextAction("试运行") {
                if (!busy) onTrial()
            }
            if (task.kind == TaskKind.Wecom) {
                TextAction("发送") {
                    if (!busy) onSend()
                }
            }
            TextAction("删除") { onDelete() }
        }
    }
}

@Composable
private fun KindTag(kind: TaskKind) {
    Surface(
        shape = CircleShape,
        color = MaterialTheme.colorScheme.surfaceVariant,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Text(
            kind.label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = Space.sm, vertical = 2.dp),
        )
    }
}

private fun taskStatus(task: Task): String {
    val last = task.lastRunAt?.let { formatTime(it) }
    val status = when (task.lastStatus) {
        "rehearsed" -> "试运行通过"
        "sent" -> "发送完成"
        "started" -> "已交给助手执行"
        "failed" -> "上次失败" + (task.lastError?.let { " · $it" } ?: "")
        else -> "还没运行过"
    }
    return if (last != null) "$status · $last" else status
}
