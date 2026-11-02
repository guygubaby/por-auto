package com.por.auto.agent.wecom

import kotlinx.coroutines.sync.Mutex

internal object BroadcastGate {
    private val mutex = Mutex()

    suspend fun <T> withRun(block: suspend () -> T): T {
        if (!mutex.tryLock()) throw WecomException("已有群发任务正在执行，本次未运行")
        return try {
            block()
        } finally {
            mutex.unlock()
        }
    }
}
