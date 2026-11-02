package com.por.auto.agent.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.por.auto.agent.MainUiState

@Composable
fun LogsTab(
    state: MainUiState,
    onRefresh: () -> Unit,
) {
    var expanded by rememberSaveable { mutableStateOf<String?>(null) }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(
            start = 16.dp,
            end = 16.dp,
            top = 12.dp,
            bottom = 12.dp,
        ),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    "${state.runs.size} 条记录",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                TextAction("刷新", onRefresh)
            }
        }
        if (state.runs.isEmpty()) {
            item {
                Text(
                    "还没有运行记录",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        items(state.runs, key = { it.id }) { run ->
            val isOpen = expanded == run.id
            Section {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(
                        formatTime(run.finishedAt),
                        style = MaterialTheme.typography.titleSmall,
                    )
                    Text(
                        if (run.dryRun) "试运行" else "正式发送",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary,
                    )
                    androidx.compose.foundation.layout.Spacer(Modifier.weight(1f))
                    TextAction(if (isOpen) "收起" else "详情") {
                        expanded = if (isOpen) null else run.id
                    }
                }
                Text(
                    run.error?.let { "停止：$it" } ?: "成功 ${run.completed} · 失败 ${run.failed}",
                    style = MaterialTheme.typography.bodySmall,
                    color = if (run.error != null) {
                        MaterialTheme.colorScheme.error
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    },
                )
                if (isOpen) {
                    if (run.targets.isEmpty()) {
                        Text("没有对象记录", style = MaterialTheme.typography.bodySmall)
                    }
                    run.targets.forEachIndexed { index, target ->
                        if (index > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        TargetRow(target.status, target.title, target.error)
                    }
                }
            }
        }
    }
}

@Composable
private fun TargetRow(status: String, title: String, error: String?) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            statusLabel(status),
            style = MaterialTheme.typography.bodySmall,
            color = if (status == "sent" || status == "rehearsed") {
                MaterialTheme.colorScheme.primary
            } else {
                MaterialTheme.colorScheme.error
            },
        )
        Text(
            title + (error?.let { " · $it" }.orEmpty()),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
