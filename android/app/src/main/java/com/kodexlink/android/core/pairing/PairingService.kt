package com.kodexlink.android.core.pairing

// Auto-generated from iOS: ios/KodexLink/Core/Pairing/PairingService.swift
// URLSession → OkHttp；async/await → suspend fun + Coroutines

import android.os.Build
import com.kodexlink.android.core.auth.AuthService
import com.kodexlink.android.core.auth.AuthServiceError
import com.kodexlink.android.core.auth.DeviceTokenBundle
import com.kodexlink.android.core.auth.TokenManager
import com.kodexlink.android.core.auth.isCredentialRejected
import com.kodexlink.android.core.diagnostics.DiagnosticsLogger
import com.kodexlink.android.core.storage.BindingRecord
import com.kodexlink.android.core.storage.BindingStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.time.Instant

// ── Payload models ─────────────────────────────────────────────────────────

@Serializable
data class PairingPayload(
    val v: Int,
    val relayUrl: String,
    val pairingId: String,
    val pairingSecret: String,
    val agentLabel: String,
    val expiresAt: Long
)

@Serializable
data class MobileBootstrapResponse(
    val deviceId: String,
    val accessToken: String,
    val refreshToken: String,
    val accessExpiresAt: Long,
    val refreshExpiresAt: Long,
    val relayUrl: String,
    val defaultBindingId: String? = null,
    val bindings: List<BindingSummary>
) {
    @Serializable
    data class BindingSummary(
        val bindingId: String,
        val agentId: String,
        val displayName: String,
        val isDefault: Boolean
    )
}

@Serializable
data class ClaimPairingResponse(
    val bindingId: String,
    val agentId: String,
    val agentLabel: String,
    val relayUrl: String,
    val bindings: List<MobileBootstrapResponse.BindingSummary>,
    val defaultBindingId: String? = null
)

// ── Errors ─────────────────────────────────────────────────────────────────

sealed class PairingError(message: String) : Exception(message) {
    class InvalidResponse : PairingError("Invalid HTTP response")
    class BindingUnavailable : PairingError("Binding unavailable after pairing")
    class LocalNetworkPermissionDenied : PairingError("Local network permission denied")
    class RelayEnvironmentMismatch(expected: String, actual: String) :
        PairingError("Relay mismatch: expected $expected but got $actual")
    class Server(override val message: String) : PairingError(message)
}

// ── PairingService ─────────────────────────────────────────────────────────

class PairingService(
    private val client: OkHttpClient = OkHttpClient(),
    private val authService: AuthService = AuthService(client)
) {
    private val json = Json { ignoreUnknownKeys = true }
    private val jsonContentType = "application/json".toMediaType()

    fun parsePairingPayload(rawValue: String, pairTraceId: String? = null): PairingPayload {
        val payload = json.decodeFromString<PairingPayload>(rawValue)
        DiagnosticsLogger.info("PairingService", "parse_pairing_payload",
            DiagnosticsLogger.pairTraceMetadata(pairTraceId, mapOf(
                "pairingId" to payload.pairingId,
                "relayUrl" to payload.relayUrl,
                "expiresAt" to payload.expiresAt.toString()
            )))
        return payload
    }

    suspend fun claimPairingSession(
        rawPayload: String,
        tokenManager: TokenManager,
        bindingStore: BindingStore,
        expectedRelayBaseURL: String? = null,
        pairTraceId: String? = null
    ): BindingRecord {
        val pairingPayload = parsePairingPayload(rawPayload, pairTraceId)

        if (expectedRelayBaseURL != null) {
            val expected = normalizeUrl(expectedRelayBaseURL)
            val actual = normalizeUrl(pairingPayload.relayUrl)
            if (expected != actual) throw PairingError.RelayEnvironmentMismatch(expectedRelayBaseURL, pairingPayload.relayUrl)
        }

        DiagnosticsLogger.info("PairingService", "claim_pairing_session_start",
            DiagnosticsLogger.pairTraceMetadata(pairTraceId, mapOf(
                "pairingId" to pairingPayload.pairingId,
                "relayUrl" to pairingPayload.relayUrl
            )))

        return try {
            val bundle = ensureMobileCredentials(pairingPayload.relayUrl, tokenManager, pairTraceId)
            val response = claimPairing(pairingPayload, bundle.deviceId, bundle.accessToken, pairTraceId)

            val records = response.bindings.map { summary ->
                BindingRecord(
                    id = summary.bindingId,
                    agentId = summary.agentId,
                    agentName = summary.displayName,
                    relayBaseURL = response.relayUrl,
                    isDefault = summary.bindingId == (response.defaultBindingId ?: summary.bindingId)
                )
            }
            bindingStore.replaceBindings(records)
            bindingStore.setPreferredBinding(response.bindingId)

            val claimed = bindingStore.binding(response.bindingId) ?: bindingStore.defaultBinding
                ?: throw PairingError.BindingUnavailable()

            DiagnosticsLogger.info("PairingService", "claim_pairing_session_success",
                DiagnosticsLogger.pairTraceMetadata(pairTraceId, mapOf(
                    "bindingId" to claimed.id,
                    "agentId" to claimed.agentId
                )))
            claimed
        } catch (e: Exception) {
            DiagnosticsLogger.warning("PairingService", "claim_pairing_session_failed",
                DiagnosticsLogger.pairTraceMetadata(pairTraceId, mapOf(
                    "pairingId" to pairingPayload.pairingId,
                    "error" to (e.message ?: "")
                )))
            throw e
        }
    }

    private suspend fun ensureMobileCredentials(
        relayBaseURL: String,
        tokenManager: TokenManager,
        pairTraceId: String?
    ): DeviceTokenBundle {
        val nowSeconds = Instant.now().epochSecond
        val current = tokenManager.currentBundle()

        if (current != null) {
            if (current.accessExpiresAt > nowSeconds && !tokenManager.shouldRefresh()) {
                return current
            }
            if (current.accessExpiresAt > nowSeconds || tokenManager.canRefresh()) {
                return try {
                    val refreshed = authService.refreshSession(relayBaseURL, current.deviceId, current.refreshToken)
                    tokenManager.update(refreshed)
                    refreshed
                } catch (e: AuthServiceError) {
                    if (!e.isCredentialRejected) {
                        DiagnosticsLogger.warning("PairingService", "refresh_credentials_deferred",
                            DiagnosticsLogger.pairTraceMetadata(pairTraceId, mapOf("error" to (e.message ?: ""))))
                        if (current.accessExpiresAt > nowSeconds) return current
                    }
                    tokenManager.clear()
                    bootstrapAndStore(relayBaseURL, tokenManager, pairTraceId)
                }
            } else {
                tokenManager.clear()
            }
        }

        return bootstrapAndStore(relayBaseURL, tokenManager, pairTraceId)
    }

    private suspend fun bootstrapAndStore(
        relayBaseURL: String,
        tokenManager: TokenManager,
        pairTraceId: String?
    ): DeviceTokenBundle {
        val bootstrap = bootstrapMobileDevice(relayBaseURL, pairTraceId)
        val bundle = DeviceTokenBundle(
            deviceId = bootstrap.deviceId,
            accessToken = bootstrap.accessToken,
            refreshToken = bootstrap.refreshToken,
            accessExpiresAt = bootstrap.accessExpiresAt,
            refreshExpiresAt = bootstrap.refreshExpiresAt
        )
        tokenManager.update(bundle)
        return bundle
    }

    private suspend fun bootstrapMobileDevice(
        relayBaseURL: String,
        pairTraceId: String?
    ): MobileBootstrapResponse =
        withContext(Dispatchers.IO) {
            DiagnosticsLogger.info("PairingService", "bootstrap_mobile_start",
                DiagnosticsLogger.pairTraceMetadata(pairTraceId, mapOf("relayBaseURL" to relayBaseURL)))

            val deviceName = "KodexLink-Android"
            val body = json.encodeToString(mapOf<String, String?>("deviceId" to null, "deviceName" to deviceName))
            val request = Request.Builder()
                .url("$relayBaseURL/v1/mobile-devices/bootstrap")
                .post(body.toRequestBody(jsonContentType))
                .addHeader("Content-Type", "application/json")
                .build()

            val response = client.newCall(request).execute()
            val bodyStr = response.body?.string() ?: ""
            if (!response.isSuccessful) throw PairingError.Server(bodyStr)

            json.decodeFromString<MobileBootstrapResponse>(bodyStr).also {
                DiagnosticsLogger.info("PairingService", "bootstrap_mobile_success",
                    DiagnosticsLogger.pairTraceMetadata(pairTraceId, mapOf(
                        "deviceId" to it.deviceId,
                        "bindingCount" to it.bindings.size.toString()
                    )))
            }
        }

    private suspend fun claimPairing(
        pairingPayload: PairingPayload,
        mobileDeviceId: String,
        accessToken: String,
        pairTraceId: String?
    ): ClaimPairingResponse = withContext(Dispatchers.IO) {
        @Serializable
        data class ClaimRequest(val pairingId: String, val pairingSecret: String, val displayName: String)

        val bodyStr = json.encodeToString(ClaimRequest(
            pairingId = pairingPayload.pairingId,
            pairingSecret = pairingPayload.pairingSecret,
            displayName = pairingPayload.agentLabel
        ))
        val request = Request.Builder()
            .url("${pairingPayload.relayUrl}/v1/pairings/claim")
            .post(bodyStr.toRequestBody(jsonContentType))
            .addHeader("Content-Type", "application/json")
            .addHeader("x-device-id", mobileDeviceId)
            .addHeader("x-device-token", accessToken)
            .build()

        val response = client.newCall(request).execute()
        val respBody = response.body?.string() ?: ""
        if (!response.isSuccessful) throw PairingError.Server(respBody)

        json.decodeFromString<ClaimPairingResponse>(respBody).also {
            DiagnosticsLogger.info("PairingService", "claim_pairing_http_success",
                DiagnosticsLogger.pairTraceMetadata(pairTraceId, mapOf(
                    "bindingId" to it.bindingId,
                    "agentId" to it.agentId
                )))
        }
    }

    private fun normalizeUrl(url: String) = url.trimEnd('/')
}
