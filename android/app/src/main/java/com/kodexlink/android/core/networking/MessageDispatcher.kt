// Auto-generated from iOS: ios/KodexLink/Core/Networking/MessageDispatcher.swift，生成时间：2026-03-26T00:00:00Z
package com.kodexlink.android.core.networking

/**
 * Dispatches raw incoming message data to appropriate handlers.
 *
 * On iOS this class is a thin stub; the actual routing is handled upstream
 * by RelayConnection / MessageTypes. Same design is preserved here.
 */
class MessageDispatcher {

    /**
     * Handle raw incoming data received from the relay WebSocket.
     * Extend this method to route to typed message handlers as the protocol layer evolves.
     */
    fun handle(data: ByteArray) {
        // No-op stub – wire up typed routing here when ready.
        @Suppress("UNUSED_VARIABLE")
        val ignored = data
    }
}
