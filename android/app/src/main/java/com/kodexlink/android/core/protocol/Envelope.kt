package com.kodexlink.android.core.protocol

// Auto-generated from iOS: ios/KodexLink/Core/Protocol/Envelope.swift
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class EnvelopeHeader(
    val id: String,
    val type: String,
    @SerialName("bindingId") val bindingId: String? = null,
    val createdAt: Long,
    val requiresAck: Boolean,
    val protocolVersion: Int,
    @SerialName("idempotencyKey") val idempotencyKey: String? = null,
    @SerialName("traceId") val traceId: String? = null
)

@Serializable
data class Envelope<Payload>(
    val id: String,
    val type: String,
    @SerialName("bindingId") val bindingId: String? = null,
    val createdAt: Long,
    val requiresAck: Boolean,
    val protocolVersion: Int,
    @SerialName("idempotencyKey") val idempotencyKey: String? = null,
    @SerialName("traceId") val traceId: String? = null,
    val payload: Payload
)
