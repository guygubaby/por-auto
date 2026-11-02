package com.por.auto.agent.ai

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.InetAddress
import java.net.ServerSocket
import java.net.SocketException
import java.util.concurrent.atomic.AtomicInteger
import kotlin.concurrent.thread

class AiClientTest {
    @Test
    fun redirectsCannotForwardProviderKeys() = runTest {
        val forwarded = AtomicInteger()
        val gateway = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
        val server = thread(name = "ai-redirect-test", isDaemon = true) {
            try {
                while (!gateway.isClosed) {
                    gateway.accept().use { socket ->
                        socket.soTimeout = 5_000
                        val input = socket.getInputStream().bufferedReader()
                        val request = input.readLine()
                        while (!input.readLine().isNullOrEmpty()) Unit
                        val response = if (request.contains("/redirected")) {
                            forwarded.incrementAndGet()
                            "HTTP/1.1 200 OK\r\nContent-Length: 11\r\nConnection: close\r\n\r\n{\"data\":[]}"
                        } else {
                            "HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:${gateway.localPort}/redirected\r\n" +
                                "Content-Length: 0\r\nConnection: close\r\n\r\n"
                        }
                        socket.getOutputStream().write(response.toByteArray(Charsets.UTF_8))
                    }
                }
            } catch (e: SocketException) {
                if (!gateway.isClosed) throw e
            }
        }
        try {
            for (provider in AiProvider.entries) {
                val config = AiConfig(provider, "http://127.0.0.1:${gateway.localPort}", "model")
                val failure = runCatching { AiClient().fetchModels(config, "test-key") }.exceptionOrNull()
                assertTrue(failure is AiException && failure.message.orEmpty().contains("302"))
            }
            assertEquals(0, forwarded.get())
        } finally {
            gateway.close()
            server.join(5_000)
        }
    }
}
