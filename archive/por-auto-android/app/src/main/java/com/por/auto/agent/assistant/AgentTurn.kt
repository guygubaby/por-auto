package com.por.auto.agent.assistant

/** 助手的一轮对话：一句目标、执行过的步骤和最后结果。 */
data class AgentTurn(
    val goal: String,
    val steps: List<String> = emptyList(),
    val result: String? = null,
    val running: Boolean = false,
    val failed: Boolean = false,
)
