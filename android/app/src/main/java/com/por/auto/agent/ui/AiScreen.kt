package com.por.auto.agent.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.por.auto.agent.MainUiState
import com.por.auto.agent.ai.AiProvider

/** 独立的 AI 配置页：服务商、连接、模型，保存并测试。 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun AiScreen(
    state: MainUiState,
    onBack: () -> Unit,
    onFetchModels: (AiProvider, String, String) -> Unit,
    onSaveAi: (AiProvider, String, String, String, Boolean) -> Unit,
) {
    var provider by rememberSaveable(state.aiConfig.provider) { mutableStateOf(state.aiConfig.provider) }
    var baseUrl by rememberSaveable(state.aiConfig.baseUrl) { mutableStateOf(state.aiConfig.baseUrl) }
    var apiKey by remember { mutableStateOf("") }
    var model by rememberSaveable(state.aiConfig.model) { mutableStateOf(state.aiConfig.model) }
    var expanded by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("AI 配置", style = MaterialTheme.typography.titleLarge) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                ),
            )
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .consumeWindowInsets(padding)
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = Space.lg, vertical = Space.sm),
            verticalArrangement = Arrangement.spacedBy(Space.lg),
        ) {
            Section(title = if (state.aiConfig.ready) "已配置" else "未配置") {
                Text(
                    "配置一般由服务端下发，装好后自动同步；这里可以手动覆盖，保存后本机优先用它。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(Space.sm),
                    verticalArrangement = Arrangement.spacedBy(Space.sm),
                ) {
                    AiProvider.entries.forEach { item ->
                        ProviderPill(
                            label = item.label,
                            selected = provider == item,
                            onClick = {
                                // 切到自带默认地址的服务商时顺手填好，省得手打。
                                if (item.defaultBaseUrl.isNotBlank() &&
                                    (baseUrl.isBlank() ||
                                        AiProvider.entries.any { it.defaultBaseUrl == baseUrl.trim() })
                                ) {
                                    baseUrl = item.defaultBaseUrl
                                }
                                provider = item
                            },
                        )
                    }
                }
            }

            Section(title = "连接") {
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
                if (provider == AiProvider.OpenCodeGo) {
                    Text(
                        "OpenCode Go 填到 /v1 这一层；请求会带应用自己的 User-Agent 和固定的 x-opencode-session 会话头。",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            Section(title = "模型") {
                CompactButton(
                    text = if (state.aiBusy) "请稍候" else "获取模型",
                    onClick = { onFetchModels(provider, baseUrl, apiKey) },
                    enabled = !state.aiBusy,
                    filled = false,
                    modifier = Modifier.fillMaxWidth(),
                )
                val options = state.aiModels
                ExposedDropdownMenuBox(
                    expanded = expanded && options.isNotEmpty(),
                    onExpandedChange = { if (options.isNotEmpty()) expanded = it },
                ) {
                    OutlinedTextField(
                        value = model,
                        onValueChange = {},
                        readOnly = true,
                        label = { Text("模型") },
                        placeholder = { Text(if (options.isEmpty()) "先获取模型" else "选一个") },
                        trailingIcon = {
                            ExposedDropdownMenuDefaults.TrailingIcon(expanded && options.isNotEmpty())
                        },
                        modifier = Modifier
                            .menuAnchor(MenuAnchorType.PrimaryNotEditable)
                            .fillMaxWidth(),
                        textStyle = MaterialTheme.typography.bodyMedium,
                    )
                    ExposedDropdownMenu(
                        expanded = expanded && options.isNotEmpty(),
                        onDismissRequest = { expanded = false },
                        shape = MaterialTheme.shapes.medium,
                        containerColor = MaterialTheme.colorScheme.surface,
                    ) {
                        options.forEach { name ->
                            DropdownMenuItem(
                                text = { Text(name, style = MaterialTheme.typography.bodyMedium) },
                                onClick = {
                                    model = name
                                    expanded = false
                                },
                                trailingIcon = if (name == model) {
                                    { Icon(Icons.Filled.Check, contentDescription = "当前模型") }
                                } else {
                                    null
                                },
                            )
                        }
                    }
                }
                if (options.isNotEmpty()) {
                    Text(
                        "共 ${options.size} 个，选中后才能保存并测试",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            Column(verticalArrangement = Arrangement.spacedBy(Space.sm)) {
                CompactButton(
                    text = if (state.aiBusy) "正在保存…" else "保存并测试",
                    onClick = {
                        onSaveAi(provider, baseUrl, apiKey, model, true)
                        apiKey = ""
                    },
                    enabled = !state.aiBusy && model.isNotBlank() && baseUrl.isNotBlank(),
                    modifier = Modifier.fillMaxWidth(),
                )
                state.aiStatus?.let {
                    Text(
                        it,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
                Text(
                    "留空复用 Key 只对相同协议和 Base URL 生效；改接口要重新填 Key。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun ProviderPill(label: String, selected: Boolean, onClick: () -> Unit) {
    Surface(
        shape = CircleShape,
        color = if (selected) MaterialTheme.colorScheme.tertiaryContainer else MaterialTheme.colorScheme.surface,
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
