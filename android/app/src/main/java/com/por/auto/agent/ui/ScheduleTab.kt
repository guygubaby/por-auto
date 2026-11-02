package com.por.auto.agent.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.por.auto.agent.MainUiState
import com.por.auto.agent.schedule.Schedule
import com.por.auto.agent.wecom.WecomScope

@Composable
fun ScheduleTab(
    state: MainUiState,
    onAdd: (String, Int, Int, WecomScope) -> Unit,
    onToggle: (String, Boolean) -> Unit,
    onDelete: (String) -> Unit,
    onRunNow: (String) -> Unit,
) {
    var text by rememberSaveable { mutableStateOf("1") }
    var time by rememberSaveable { mutableStateOf("09:00") }
    var scope by rememberSaveable { mutableStateOf(WecomScope.Groups) }
    var error by rememberSaveable { mutableStateOf<String?>(null) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(start = Space.lg, end = Space.lg, top = Space.sm, bottom = Space.xl),
        verticalArrangement = Arrangement.spacedBy(Space.lg),
    ) {
        Section(title = "新建任务") {
            OutlinedTextField(
                value = text,
                onValueChange = { text = it },
                placeholder = { Text("要发送的内容") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                textStyle = MaterialTheme.typography.bodyLarge,
            )
            ScopePicker(scope = scope, onScope = { scope = it })
            Row(
                horizontalArrangement = Arrangement.spacedBy(Space.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                OutlinedTextField(
                    value = time,
                    onValueChange = {
                        time = it
                        error = null
                    },
                    placeholder = { Text("HH:mm") },
                    singleLine = true,
                    modifier = Modifier.width(120.dp),
                    textStyle = MaterialTheme.typography.bodyLarge,
                )
                CompactButton(
                    text = "每天发送",
                    onClick = {
                        val parsed = parseTime(time)
                        if (parsed == null) {
                            error = "时间格式应为 HH:mm"
                        } else {
                            onAdd(text, parsed.first, parsed.second, scope)
                        }
                    },
                    modifier = Modifier.weight(1f),
                )
            }
            error?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
            }
            if (!state.exactAlarmAllowed) {
                Text(
                    "系统未允许精确闹钟，后台任务可能延迟或跳过。可在设置页允许。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }
        }

        Section(title = "任务") {
            if (state.schedules.isEmpty()) {
                EmptyState("还没有定时任务", "在上面填好内容、范围和时间，点「每天发送」。")
            }
            state.schedules.forEachIndexed { index, schedule ->
                if (index > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                ScheduleRow(schedule, onToggle, onDelete, onRunNow)
            }
        }
    }
}

@Composable
private fun ScheduleRow(
    schedule: Schedule,
    onToggle: (String, Boolean) -> Unit,
    onDelete: (String) -> Unit,
    onRunNow: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Space.xs)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Space.md),
        ) {
            Text(schedule.timeLabel, style = MaterialTheme.typography.titleLarge)
            ScopeTag(schedule.scope)
            Text(
                schedule.text,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Switch(checked = schedule.enabled, onCheckedChange = { onToggle(schedule.id, it) })
        }
        Text(
            scheduleStatus(schedule),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(Space.xs)) {
            TextAction("立即运行") { onRunNow(schedule.id) }
            TextAction("删除") { onDelete(schedule.id) }
        }
    }
}

@Composable
private fun ScopeTag(scope: WecomScope) {
    Surface(
        shape = CircleShape,
        color = MaterialTheme.colorScheme.surfaceVariant,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Text(
            scope.label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = Space.sm, vertical = 2.dp),
        )
    }
}

private fun parseTime(value: String): Pair<Int, Int>? {
    val match = Regex("^\\s*(\\d{1,2})\\s*[:：]\\s*(\\d{1,2})\\s*$").find(value) ?: return null
    val hour = match.groupValues[1].toIntOrNull() ?: return null
    val minute = match.groupValues[2].toIntOrNull() ?: return null
    if (hour !in 0..23 || minute !in 0..59) return null
    return hour to minute
}

private fun scheduleStatus(schedule: Schedule): String {
    val last = schedule.lastStatus?.let { status ->
        val error = schedule.lastError?.let { " · $it" }.orEmpty()
        "上次${statusLabel(status)}$error"
    }.orEmpty()
    return if (schedule.enabled) "下次 ${formatTime(schedule.nextAtMs)} · $last" else "已暂停 · $last"
}
