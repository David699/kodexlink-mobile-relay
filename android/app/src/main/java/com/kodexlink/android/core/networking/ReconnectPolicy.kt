package com.kodexlink.android.core.networking

// Auto-generated from iOS: ios/KodexLink/Core/Networking/ReconnectPolicy.swift

import kotlin.math.min
import kotlin.math.pow

data class ReconnectPolicy(
    val initialDelayMs: Long = 1_000L,
    val maxDelayMs: Long = 30_000L,
    val multiplier: Double = 2.0
) {
    companion object {
        val default = ReconnectPolicy()
    }

    /** Returns delay in milliseconds for the given attempt (1-based). */
    fun delayMs(attempt: Int): Long {
        if (attempt <= 1) return initialDelayMs
        val exponent = (attempt - 1).toDouble()
        val candidate = initialDelayMs.toDouble() * multiplier.pow(exponent)
        return min(maxDelayMs.toDouble(), candidate).toLong()
    }
}
