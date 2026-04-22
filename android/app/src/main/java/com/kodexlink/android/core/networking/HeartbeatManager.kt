package com.kodexlink.android.core.networking

// Auto-generated from iOS: ios/KodexLink/Core/Networking/HeartbeatManager.swift
// DispatchSourceTimer → coroutine-based timer

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class HeartbeatManager(
    private val intervalMs: Long = 30_000L,
    private val maxMisses: Int = 3
) {
    private var job: Job? = null
    private var missedPongs: Int = 0

    fun start(
        scope: CoroutineScope,
        sendPing: () -> Unit,
        onTimeout: () -> Unit
    ) {
        stop()
        missedPongs = 0
        job = scope.launch {
            while (true) {
                delay(intervalMs)
                missedPongs++
                if (missedPongs >= maxMisses) {
                    onTimeout()
                    stop()
                    return@launch
                }
                sendPing()
            }
        }
    }

    fun receivedPong() {
        missedPongs = 0
    }

    fun stop() {
        job?.cancel()
        job = null
        missedPongs = 0
    }
}
