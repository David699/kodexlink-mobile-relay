package com.kodexlink.android.core.storage

// Auto-generated from iOS: ios/KodexLink/Core/Storage/MessageCache.swift

data class CachedMessage(
    val id: String,
    val payload: ByteArray
)

class MessageCache {
    private val _messages = mutableListOf<CachedMessage>()
    val messages: List<CachedMessage> get() = _messages.toList()

    fun append(message: CachedMessage) {
        _messages.add(message)
    }

    fun clear() {
        _messages.clear()
    }
}
