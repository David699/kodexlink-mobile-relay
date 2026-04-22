package com.kodexlink.android.core.protocol

// Auto-generated from iOS: ios/KodexLink/Core/Protocol/ErrorCodes.swift
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder

@Serializable(with = ErrorCodeSerializer::class)
enum class ErrorCode(val rawValue: String) {
    UNAUTHORIZED("UNAUTHORIZED"),
    AUTH_FAILED("AUTH_FAILED"),
    DEVICE_ALREADY_INITIALIZED("DEVICE_ALREADY_INITIALIZED"),
    FORBIDDEN("FORBIDDEN"),
    INVALID_PAYLOAD("INVALID_PAYLOAD"),
    UNSUPPORTED_VERSION("UNSUPPORTED_VERSION"),
    BINDING_NOT_FOUND("BINDING_NOT_FOUND"),
    BINDING_DISABLED("BINDING_DISABLED"),
    AGENT_OFFLINE("AGENT_OFFLINE"),
    CONTROL_NOT_HELD("CONTROL_NOT_HELD"),
    IDEMPOTENCY_CONFLICT("IDEMPOTENCY_CONFLICT"),
    TOKEN_EXPIRED("TOKEN_EXPIRED"),
    TOKEN_REVOKED("TOKEN_REVOKED"),
    INTERNAL_ERROR("INTERNAL_ERROR"),

    /** 兜底：服务端返回未知错误码时不会导致解码失败 */
    UNKNOWN("UNKNOWN");

    companion object {
        fun fromRawValue(raw: String): ErrorCode =
            entries.firstOrNull { it.rawValue == raw } ?: UNKNOWN
    }
}

object ErrorCodeSerializer : KSerializer<ErrorCode> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor("ErrorCode", PrimitiveKind.STRING)

    override fun serialize(encoder: Encoder, value: ErrorCode) {
        encoder.encodeString(value.rawValue)
    }

    override fun deserialize(decoder: Decoder): ErrorCode {
        return ErrorCode.fromRawValue(decoder.decodeString())
    }
}
