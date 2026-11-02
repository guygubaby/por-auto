package com.por.auto.agent.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.por.auto.agent.MainUiState
import com.por.auto.agent.ai.AiProvider

@Composable
fun AiSection(
    state: MainUiState,
    onFetchModels: (AiProvider, String, String) -> Unit,
    onSave: (AiProvider, String, String, String, Boolean) -> Unit,
) {
    var provider by rememberSaveable(state.aiConfig.provider) { mutableStateOf(state.aiConfig.provider) }
    var baseUrl by rememberSaveable(state.aiConfig.baseUrl) { mutableStateOf(state.aiConfig.baseUrl) }
    var apiKey by remember { mutableStateOf("") }
    var model by rememberSaveable(state.aiConfig.model) { mutableStateOf(state.aiConfig.model) }

    Section(
        title = "AI",
        trailing = {
            Text(
                if (state.aiConfig.ready) "已配置" else "未配置",
                style = MaterialTheme.typography.labelSmall,
                color = if (state.aiConfig.ready) {
                    MaterialTheme.colorScheme.primary
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                },
            )
        },
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            AiProvider.entries.forEach { item ->
                FilterChip(
                    selected = provider == item,
                    onClick = { provider = item },
                    label = { Text(item.label, style = MaterialTheme.typography.labelLarge) },
                )
            }
        }
        OutlinedTextField(
            value = baseUrl,
            onValueChange = { baseUrl = it },
            label = { Text("Base URL") },
            placeholder = { Text("https://api.example.com/v1") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
            textStyle = MaterialTheme.typography.bodyMedium,
        )
        OutlinedTextField(
            value = apiKey,
            onValueChange = { apiKey = it },
            label = { Text(if (state.aiConfig.hasKey) "API Key（留空则不修改）" else "API Key") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            modifier = Modifier.fillMaxWidth(),
            textStyle = MaterialTheme.typography.bodyMedium,
        )
        OutlinedTextField(
            value = model,
            onValueChange = { model = it },
            label = { Text("模型") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
            textStyle = MaterialTheme.typography.bodyMedium,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            CompactButton(
                text = "获取模型",
                onClick = { onFetchModels(provider, baseUrl, apiKey) },
                enabled = !state.aiBusy,
                filled = false,
                modifier = Modifier.weight(1f),
            )
            CompactButton(
                text = "保存并测试",
                onClick = {
                    onSave(provider, baseUrl, apiKey, model, true)
                    apiKey = ""
                },
                enabled = !state.aiBusy,
                modifier = Modifier.weight(1f),
            )
        }
        if (state.aiModels.isNotEmpty()) {
            Text(
                "共 ${state.aiModels.size} 个模型，点选设为当前模型",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            state.aiModels.take(8).forEach { name ->
                TextAction(
                    if (name == model) "✓ $name" else name,
                ) { model = name }
            }
        }
        state.aiStatus?.let {
            Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
        }
    }
}
