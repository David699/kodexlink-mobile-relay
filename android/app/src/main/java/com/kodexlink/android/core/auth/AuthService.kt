package com.kodexlink.android.core.auth

// Auto-generated from iOS: ios/KodexLink/Core/Auth/AuthService.swift
// URLSession → OkHttp；async/await → suspend fun + Coroutines

import com.kodexlink.android.core.diagnostics.DiagnosticsLogger
import com.kodexlink.android.core.protocol.ErrorCode
import com.kodexlink.android.core.protocol.ErrorPayload
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request

@Serializable
private data class TokenRefreshResponse(
    val deviceId: String,
    val accessToken: String,
    val refreshToken: String,
    val accessExpiresAt: Long,
    val refreshExpiresAt: Long,
    val relayUrl: String
)

sealed class AuthServiceError(message: String) : Exception(message) {
    class InvalidResponse : AuthServiceError("Invalid HTTP response")
    class ServerError(val code: ErrorCode, override val message: String) : AuthServiceError(message)
    class ServerMessage(override val message: String) : AuthServiceError(message)
}

val AuthServiceError.isCredentialRejected: Boolean
    get() = when (this) {
        is AuthServiceError.ServerError -> code in listOf(
            ErrorCode.UNAUTHORIZED,
            ErrorCode.AUTH_FAILED,
            ErrorCode.TOKEN_EXPIRED,
            ErrorCode.TOKEN_REVOKED
        )
        else -> false
    }

class AuthService(private val client: OkHttpClient = OkHttpClient()) {

    private val json = Json { ignoreUnknownKeys = true }

    suspend fun refreshSession(
        relayBaseURL: String,
        deviceId: String,
        refreshToken: String
    ): DeviceTokenBundle = withContext(Dispatchers.IO) {
        DiagnosticsLogger.info(
            "AuthService", "refresh_session_start",
            mapOf(
                "relayBaseURL" to relayBaseURL,
                "deviceId" to deviceId,
                "refreshTokenPresent" to if (refreshToken.isEmpty()) "false" else "true"
            )
        )

        val request = Request.Builder()
            .url("$relayBaseURL/v1/token/refresh")
            .post(okhttp3.RequestBody.create("application/json".toMediaType(), "{}"))
            .addHeader("x-device-id", deviceId)
            .addHeader("x-refresh-token", refreshToken)
            .build()

        val response = client.newCall(request).execute()
        val body = response.body?.string() ?: ""

        if (!response.isSuccessful) {
            val errorPayload = runCatching { json.decodeFromString<ErrorPayload>(body) }.getOrNull()
            if (errorPayload != null) {
                DiagnosticsLogger.warning(
                    "AuthService", "refresh_session_server_error",
                    mapOf(
                        "statusCode" to response.code.toString(),
                        "code" to errorPayload.code.rawValue,
                        "message" to errorPayload.message
                    )
                )
                throw AuthServiceError.ServerError(errorPayload.code, errorPayload.message)
            }
            DiagnosticsLogger.warning(
                "AuthService", "refresh_session_http_error",
                mapOf("statusCode" to response.code.toString(), "message" to body)
            )
            throw AuthServiceError.ServerMessage(body.ifBlank { "Unknown auth server error" })
        }

        val decoded = json.decodeFromString<TokenRefreshResponse>(body)
        DiagnosticsLogger.info(
            "AuthService", "refresh_session_success",
            mapOf(
                "relayBaseURL" to relayBaseURL,
                "deviceId" to decoded.deviceId,
                "accessExpiresAt" to decoded.accessExpiresAt.toString(),
                "refreshExpiresAt" to decoded.refreshExpiresAt.toString()
            )
        )

        DeviceTokenBundle(
            deviceId = decoded.deviceId,
            accessToken = decoded.accessToken,
            refreshToken = decoded.refreshToken,
            accessExpiresAt = decoded.accessExpiresAt,
            refreshExpiresAt = decoded.refreshExpiresAt
        )
    }
}
