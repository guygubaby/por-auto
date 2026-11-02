package com.por.auto.agent.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.por.auto.agent.MainUiState
import com.por.auto.agent.schedule.RepeatKind
import com.por.auto.agent.schedule.Schedule
import com.por.auto.agent.wecom.WecomScope
import kotlin.math.roundToInt

@Composable
fun ScheduleTab(
    state: MainUiState,
    onAdd: (String, RepeatKind, Int, Int, Int, WecomScope) -> Unit,
    onToggle: (String, Boolean) -> Unit,
    onDelete: (String) -> Unit,
    onRunNow: (String) -> Unit,
) {
    var text by rememberSaveable { mutableStateOf("OK") }
    var repeat by rememberSaveable { mutableStateOf(RepeatKind.Daily) }
    var hour by rememberSaveable { mutableIntStateOf(9) }
    var minute by rememberSaveable { mutableIntStateOf(0) }
    var interval by rememberSaveable { mutableIntStateOf(60) }
    var scope by rememberSaveable { mutableStateOf(WecomScope.Groups) }
    var error by rememberSaveable { mutableStateOf<String?>(null) }
    var showTime by remember { mutableStateOf(false) }

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
            Row(horizontalArrangement = Arrangement.spacedBy(Space.sm)) {
                RepeatKind.entries.forEach { option ->
                    RepeatPill(
                        label = option.label,
                        selected = repeat == option,
                        onClick = { repeat = option },
                    )
                }
            }
            when (repeat) {
                RepeatKind.Daily -> CompactButton(
                    text = "每天 %02d:%02d 发送".format(hour, minute),
                    onClick = { showTime = true },
                    filled = false,
                    modifier = Modifier.fillMaxWidth(),
                )
                RepeatKind.Hourly -> {
                    Text(
                        "每小时的第 $minute 分钟发送",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Slider(
                        colors = SliderDefaults.colors(
                            thumbColor = MaterialTheme.colorScheme.tertiary,
                            activeTrackColor = MaterialTheme.colorScheme.tertiary,
                        ),
                        value = minute.toFloat(),
                        onValueChange = { minute = it.roundToInt() },
                        valueRange = 0f..59f,
                    )
                }
                RepeatKind.Interval -> {
                    Text("每 $interval 分钟发送一次", style = MaterialTheme.typography.bodyMedium)
                    Slider(
                        colors = SliderDefaults.colors(
                            thumbColor = MaterialTheme.colorScheme.tertiary,
                            activeTrackColor = MaterialTheme.colorScheme.tertiary,
                        ),
                        value = interval.toFloat(),
                        onValueChange = { interval = ((it / 5).roundToInt() * 5).coerceIn(5, 240) },
                        valueRange = 5f..240f,
                    )
                }
            }
            CompactButton(
                text = "创建任务",
                onClick = { onAdd(text, repeat, hour, minute, interval, scope) },
                modifier = Modifier.fillMaxWidth(),
            )
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

    if (showTime) {
        TimePickerDialog(
            initialHour = hour,
            initialMinute = minute,
            onDismiss = { showTime = false },
            onConfirm = { h, m ->
                hour = h
                minute = m
                showTime = false
            },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TimePickerDialog(
    initialHour: Int,
    initialMinute: Int,
    onDismiss: () -> Unit,
    onConfirm: (Int, Int) -> Unit,
) {
    val picker = rememberTimePickerState(
        initialHour = initialHour,
        initialMinute = initialMinute,
        is24Hour = true,
    )
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("选择每天发送时间") },
        text = { TimePicker(state = picker) },
        confirmButton = {
            TextButton(onClick = { onConfirm(picker.hour, picker.minute) }) { Text("确定") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}

@Composable
private fun RepeatPill(label: String, selected: Boolean, onClick: () -> Unit) {
    Surface(
        shape = CircleShape,
        color = if (selected) MaterialTheme.colorScheme.tertiaryContainer else Color.Transparent,
        border = BorderStroke(
            1.dp,
            if (selected) MaterialTheme.colorScheme.tertiary else MaterialTheme.colorScheme.outlineVariant,
        ),
        modifier = Modifier
            .clip(CircleShape)
            .clickable(onClick = onClick),
    ) {
        Text(
            label,
            style = MaterialTheme.typography.labelLarge,
            color = if (selected) {
                MaterialTheme.colorScheme.onTertiaryContainer
            } else {
                MaterialTheme.colorScheme.onSurfaceVariant
            },
            modifier = Modifier.padding(horizontal = Space.lg, vertical = Space.sm),
        )
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
