package com.kodexlink.android.core.networking

// Auto-generated from iOS: ios/KodexLink/Core/Networking/RelayConnection.swift
// URLSession WebSocket → OkHttp WebSocket；Combine → StateFlow + Coroutines

import android.content.Context
import com.kodexlink.android.R
import com.kodexlink.android.core.diagnostics.DiagnosticsLogger
import com.kodexlink.android.core.protocol.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

sealed class RelayConnectionError(message: String) : Exception(message) {
    class NotConnected : RelayConnectionError("中继未连接")
    class ConnectionClosed : RelayConnectionError("连接已断开")
    class BindingUnavailable : RelayConnectionError("当前绑定不可用")
    class SessionRecoveryRequired : RelayConnectionError("Session recovery required")
    class RePairingRequired : RelayConnectionError("Re-pairing required")
    class Unauthorized : RelayConnectionError("Unauthorized")
    class Server(message: String) : RelayConnectionError(message)
    class TurnInterrupted : RelayConnectionError("Turn interrupted by user")
}

sealed class ConnectionState {
    object Disconnected : ConnectionState()
    object Connecting : ConnectionState()
    object Connected : ConnectionState()
    data class Failed(val reason: String) : ConnectionState()
}

enum class AgentStatus { UNKNOWN, ONLINE, OFFLINE, DEGRADED }

data class TurnEventHandlers(
    val onStatus: (TurnStatusPayload) -> Unit,
    val onDelta: (TurnDeltaPayload) -> Unit,
    val onCommandOutput: (CommandOutputDeltaPayload) -> Unit,
    val onApprovalRequested: (ApprovalRequestedPayload) -> Unit,
    val completion: (Result<TurnCompletedPayload>) -> Unit
)

class RelayConnection(
    context: Context,
    private val client: OkHttpClient = OkHttpClient(),
    private val reconnectPolicy: ReconnectPolicy = ReconnectPolicy.default
) {
    private val context: Context = context.applicationContext
    companion object {
        private const val CLIENT_VERSION = "android/0.1.0"
        private const val PRESENCE_SYNC_THROTTLE_MS = 3_000L
        private const val WEBSOCKET_PING_INTERVAL_SECONDS = 0L

        fun makeRelayWebSocketUrl(baseUrl: String): String {
            return baseUrl.replace("https://", "wss://")
                .replace("http://", "ws://")
                .trimEnd('/') + "/v1/connect"
        }

        private fun credentialFingerprint(deviceId: String, deviceToken: String): String =
            "$deviceId|$deviceToken"
    }

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private val json = Json { ignoreUnknownKeys = true; coerceInputValues = true }
    private val webSocketClient = client.newBuilder()
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .apply {
            if (WEBSOCKET_PING_INTERVAL_SECONDS > 0) {
                pingInterval(WEBSOCKET_PING_INTERVAL_SECONDS, TimeUnit.SECONDS)
            }
        }
        .build()

    private val _state = MutableStateFlow<ConnectionState>(ConnectionState.Disconnected)
    val state: StateFlow<ConnectionState> = _state.asStateFlow()

    private val _agentStatus = MutableStateFlow(AgentStatus.UNKNOWN)
    val agentStatus: StateFlow<AgentStatus> = _agentStatus.asStateFlow()

    private val _agentDegradedReason = MutableStateFlow<AgentDegradedReason?>(null)
    val agentDegradedReason: StateFlow<AgentDegradedReason?> = _agentDegradedReason.asStateFlow()

    private val _agentDegradedDetail = MutableStateFlow<String?>(null)
    val agentDegradedDetail: StateFlow<String?> = _agentDegradedDetail.asStateFlow()

    private val _requiresRePairing = MutableStateFlow(false)
    val requiresRePairing: StateFlow<Boolean> = _requiresRePairing.asStateFlow()

    private val _needsSessionRecovery = MutableStateFlow(false)
    val needsSessionRecovery: StateFlow<Boolean> = _needsSessionRecovery.asStateFlow()

    private val _currentControlRevokedMessage = MutableStateFlow<String?>(null)
    val currentControlRevokedMessage: StateFlow<String?> = _currentControlRevokedMessage.asStateFlow()

    private val _isAcquiringCurrentBindingControl = MutableStateFlow(false)
    val isAcquiringCurrentBindingControl: StateFlow<Boolean> = _isAcquiringCurrentBindingControl.asStateFlow()

    private val _connectionEpoch = MutableStateFlow(0L)
    val connectionEpoch: StateFlow<Long> = _connectionEpoch.asStateFlow()

    private var relayUrl: String? = null
    private var deviceId: String? = null
    private var deviceToken: String? = null
    private var bindingId: String? = null
    private var pairTraceId: String? = null
    private var webSocket: WebSocket? = null
    private var shouldMaintainConnection = false
    private var blockedCredentialFingerprint: String? = null
    private var sessionRecoveryFailureCount = 0
    private var reconnectAttempt = 0
    private var reconnectJob: Job? = null
    private var presenceSyncJob: Job? = null
    private var lastPresenceSyncAt: Long? = null
    private var controlTakeoverJob: Job? = null
    private var supportedFeatures: Set<String> = emptySet()
    private var authAttemptStartedAt: Long? = null
    private var controlledBindingId: String? = null
    private var controlRequestBindingId: String? = null
    private var revokedBindingId: String? = null
    private var pendingAuth: CompletableDeferred<Unit>? = null

    private val pendingRequests = ConcurrentHashMap<String, CompletableDeferred<String>>()
    private val pendingTurns = ConcurrentHashMap<String, PendingTurnContext>()

    private val heartbeatManager = HeartbeatManager()

    private val currentCredentialFingerprint: String?
        get() {
            val id = deviceId ?: return null
            val token = deviceToken ?: return null
            return credentialFingerprint(id, token)
        }

    private val isCurrentCredentialBlocked: Boolean
        get() = blockedCredentialFingerprint != null &&
            blockedCredentialFingerprint == currentCredentialFingerprint

    private val supportsControlTakeover: Boolean
        get() = supportedFeatures.contains("control_takeover")

    private val supportsPresenceSync: Boolean
        get() = supportedFeatures.contains("presence_sync")

    val isMissingCodexRuntimeDetail: Boolean
        get() = _agentDegradedReason.value == AgentDegradedReason.RUNTIME_UNAVAILABLE &&
            (_agentDegradedDetail.value?.startsWith("未找到运行时命令：") == true)

    val canWriteToAgent: Boolean
        get() {
            if (_requiresRePairing.value || _needsSessionRecovery.value) return false
            if (_state.value !is ConnectionState.Connected) return false
            if (_agentStatus.value != AgentStatus.ONLINE) return false
            if (!supportsControlTakeover) return true

            val currentBindingId = bindingId ?: return false
            if (_isAcquiringCurrentBindingControl.value && controlRequestBindingId == currentBindingId) return false
            if (revokedBindingId == currentBindingId) return false
            return controlledBindingId == currentBindingId
        }

    val writeUnavailableMessage: String
        get() {
            if (_requiresRePairing.value) return context.getString(R.string.write_unavail_needs_repairing)
            if (_needsSessionRecovery.value) return context.getString(R.string.write_unavail_needs_recovery)

            val currentBindingId = bindingId
            if (supportsControlTakeover && currentBindingId != null) {
                if (_isAcquiringCurrentBindingControl.value && controlRequestBindingId == currentBindingId) {
                    return context.getString(R.string.write_unavail_acquiring_control)
                }
                if (revokedBindingId == currentBindingId) {
                    return _currentControlRevokedMessage.value
                        ?: context.getString(R.string.write_unavail_not_acquired)
                }
            }

            return when (val currentState = _state.value) {
                ConnectionState.Disconnected -> context.getString(R.string.write_unavail_disconnected)
                ConnectionState.Connecting -> context.getString(R.string.write_unavail_connecting)
                is ConnectionState.Failed -> context.getString(R.string.write_unavail_failed, currentState.reason)
                ConnectionState.Connected -> when (_agentStatus.value) {
                    AgentStatus.ONLINE -> {
                        if (supportsControlTakeover && currentBindingId != null && controlledBindingId != currentBindingId) {
                            context.getString(R.string.write_unavail_not_acquired)
                        } else {
                            context.getString(R.string.status_desktop_online)
                        }
                    }
                    AgentStatus.OFFLINE -> context.getString(R.string.status_desktop_offline)
                    AgentStatus.DEGRADED -> {
                        when (_agentDegradedReason.value) {
                            AgentDegradedReason.RUNTIME_UNAVAILABLE ->
                                if (isMissingCodexRuntimeDetail) context.getString(R.string.write_unavail_runtime_missing)
                                else context.getString(R.string.write_unavail_runtime_error)
                            AgentDegradedReason.REQUEST_FAILURES ->
                                context.getString(R.string.write_unavail_request_failures)
                            null -> context.getString(R.string.write_unavail_status_error)
                        }
                    }
                    AgentStatus.UNKNOWN -> context.getString(R.string.write_unavail_syncing)
                }
            }
        }

    val shouldShowControlTakeoverBanner: Boolean
        get() {
            val currentBindingId = bindingId ?: return false
            if (!supportsControlTakeover) return false
            return (_isAcquiringCurrentBindingControl.value && controlRequestBindingId == currentBindingId) ||
                revokedBindingId == currentBindingId
        }

    val controlTakeoverBannerText: String
        get() {
            val currentBindingId = bindingId
            if (currentBindingId != null &&
                _isAcquiringCurrentBindingControl.value &&
                controlRequestBindingId == currentBindingId
            ) {
                return context.getString(R.string.takeover_acquiring)
            }

            return _currentControlRevokedMessage.value
                ?: context.getString(R.string.takeover_not_acquired)
        }

    val canManuallyTakeoverCurrentBinding: Boolean
        get() = supportsControlTakeover && bindingId != null && !_isAcquiringCurrentBindingControl.value

    fun updateSession(
        relayBaseURL: String,
        deviceId: String,
        deviceToken: String,
        bindingId: String?,
        pairTraceId: String? = null,
        resetRePairingState: Boolean = false
    ) {
        val nextUrl = makeRelayWebSocketUrl(relayBaseURL)
        val transportChanged = relayUrl != nextUrl ||
            this.deviceId != deviceId ||
            this.deviceToken != deviceToken
        val bindingChanged = this.bindingId != bindingId
        val sessionChanged = transportChanged || bindingChanged

        relayUrl = nextUrl
        this.deviceId = deviceId
        this.deviceToken = deviceToken
        this.bindingId = bindingId
        if (pairTraceId != null) {
            this.pairTraceId = pairTraceId
        } else if (sessionChanged) {
            this.pairTraceId = null
        }
        sessionRecoveryFailureCount = 0
        _needsSessionRecovery.value = false

        val newFingerprint = credentialFingerprint(deviceId, deviceToken)
        if (resetRePairingState) {
            blockedCredentialFingerprint = null
            _requiresRePairing.value = false
            if (_state.value is ConnectionState.Failed) {
                _state.value = ConnectionState.Disconnected
            }
        }
        if (blockedCredentialFingerprint != null && blockedCredentialFingerprint != newFingerprint) {
            blockedCredentialFingerprint = null
            _requiresRePairing.value = false
            if (_state.value is ConnectionState.Failed) {
                _state.value = ConnectionState.Disconnected
            }
        }

        if (transportChanged) {
            supportedFeatures = emptySet()
            cancelPresenceSync()
            resetAgentPresence()
            resetCurrentBindingControlState()
        } else if (bindingChanged) {
            cancelPresenceSync()
            resetAgentPresence()
            resetCurrentBindingControlState()
            if (_state.value is ConnectionState.Connected) {
                schedulePresenceSync(force = true)
                scheduleControlTakeover(trigger = "binding_changed")
            }
        }

        DiagnosticsLogger.info(
            "RelayConnection",
            "update_session",
            diagnosticsMetadata(
                mapOf(
                    "relayBaseURL" to relayBaseURL,
                    "sessionChanged" to sessionChanged.toString(),
                    "transportChanged" to transportChanged.toString(),
                    "bindingChanged" to bindingChanged.toString(),
                    "tokenPresent" to if (deviceToken.isEmpty()) "false" else "true",
                    "resetRePairingState" to resetRePairingState.toString()
                )
            )
        )
    }

    fun clearSession() {
        disconnect()
        relayUrl = null
        deviceId = null
        deviceToken = null
        bindingId = null
        pairTraceId = null
        blockedCredentialFingerprint = null
        _requiresRePairing.value = false
        _needsSessionRecovery.value = false
        sessionRecoveryFailureCount = 0
        supportedFeatures = emptySet()
        cancelPresenceSync()
        resetAgentPresence()
        resetCurrentBindingControlState()
        DiagnosticsLogger.info("RelayConnection", "clear_session", diagnosticsMetadata())
    }

    fun connect() {
        shouldMaintainConnection = true
        cancelReconnect(resetAttempt = false)
        DiagnosticsLogger.info("RelayConnection", "connect_requested", diagnosticsMetadata())
        connectIfNeeded()
    }

    fun disconnect() {
        shouldMaintainConnection = false
        cancelReconnect(resetAttempt = true)
        cancelPresenceSync()
        heartbeatManager.stop()
        cleanupConnection()
        _state.value = ConnectionState.Disconnected
        sessionRecoveryFailureCount = 0
        resetAgentPresence()
        resetCurrentBindingControlState()
        DiagnosticsLogger.info("RelayConnection", "disconnect_requested", diagnosticsMetadata())
    }

    fun markRePairingRequired(message: String? = null) {
        shouldMaintainConnection = false
        blockedCredentialFingerprint = currentCredentialFingerprint
        _needsSessionRecovery.value = false
        _requiresRePairing.value = true
        _state.value = ConnectionState.Failed(message ?: RelayConnectionError.RePairingRequired().message!!)
        cleanupConnection()
        DiagnosticsLogger.warning(
            "RelayConnection",
            "repairing_required",
            diagnosticsMetadata(mapOf("message" to (message ?: RelayConnectionError.RePairingRequired().message)))
        )
    }

    fun markSessionRecoveryNeeded(message: String) {
        shouldMaintainConnection = false
        _needsSessionRecovery.value = true
        _requiresRePairing.value = false
        _state.value = ConnectionState.Failed(message)
        cleanupConnection()
        DiagnosticsLogger.warning(
            "RelayConnection",
            "session_recovery_required",
            diagnosticsMetadata(mapOf("message" to message))
        )
    }

    fun refreshBindingPresenceAfterPairing() {
        resetAgentPresence()
        if (_state.value !is ConnectionState.Connected) {
            DiagnosticsLogger.info(
                "RelayConnection",
                "refresh_binding_presence_skipped_not_connected",
                diagnosticsMetadata()
            )
            return
        }

        schedulePresenceSync(force = true)
        scheduleControlTakeover(trigger = "pairing_refresh")
        DiagnosticsLogger.info(
            "RelayConnection",
            "refresh_binding_presence_requested",
            diagnosticsMetadata()
        )
    }

    suspend fun takeoverCurrentBindingControl() {
        performControlTakeover(trigger = "manual_takeover", force = true)
    }

    suspend fun sendTurnStart(
        threadId: String,
        inputs: List<TurnInputItem>,
        handlers: TurnEventHandlers
    ): String {
        ensureConnected()
        val currentBindingId = requireBindingId()
        val requestId = UUID.randomUUID().toString()
        pendingTurns[requestId] = PendingTurnContext(requestId, threadId, handlers)

        DiagnosticsLogger.info(
            "RelayConnection",
            "turn_start_send",
            diagnosticsMetadata(
                mapOf(
                    "threadId" to threadId,
                    "requestId" to requestId,
                    "inputCount" to inputs.size.toString()
                )
            )
        )

        val payloadJson = json.encodeToString(
            TurnStartRequestPayload.serializer(),
            TurnStartRequestPayload(threadId = threadId, inputs = inputs)
        )
        val sent = sendEnvelope(
            id = requestId,
            type = "turn_start_req",
            payloadJson = payloadJson,
            requiresAck = true,
            idempotencyKey = UUID.randomUUID().toString(),
            bindingIdOverride = currentBindingId
        )
        if (!sent) {
            pendingTurns.remove(requestId)?.handlers?.completion(
                Result.failure(RelayConnectionError.ConnectionClosed())
            )
            DiagnosticsLogger.warning(
                "RelayConnection",
                "turn_start_send_failed",
                diagnosticsMetadata(
                    mapOf(
                        "threadId" to threadId,
                        "requestId" to requestId,
                        "error" to "socket send returned false"
                    )
                )
            )
        }

        return requestId
    }

    suspend fun sendApprovalResolve(payload: ApprovalResolveRequestPayload): ApprovalResolvedPayload {
        return sendRequest(
            type = "approval_resolve_req",
            payloadJson = json.encodeToString(ApprovalResolveRequestPayload.serializer(), payload),
            responseType = "approval_resolved",
            idempotencyKey = UUID.randomUUID().toString(),
            deserialize = {
                json.decodeFromString(
                    Envelope.serializer(ApprovalResolvedPayload.serializer()),
                    it
                ).payload
            }
        ).also {
            DiagnosticsLogger.info(
                "RelayConnection",
                "approval_resolve_success",
                diagnosticsMetadata(
                    mapOf(
                        "approvalId" to payload.approvalId,
                        "threadId" to payload.threadId,
                        "turnId" to payload.turnId
                    )
                )
            )
        }
    }

    suspend fun sendTurnInterrupt(payload: TurnInterruptRequestPayload): TurnInterruptedPayload {
        return sendRequest(
            type = "turn_interrupt_req",
            payloadJson = json.encodeToString(TurnInterruptRequestPayload.serializer(), payload),
            responseType = "turn_interrupted",
            idempotencyKey = UUID.randomUUID().toString(),
            deserialize = {
                json.decodeFromString(
                    Envelope.serializer(TurnInterruptedPayload.serializer()),
                    it
                ).payload
            }
        ).also {
            DiagnosticsLogger.info(
                "RelayConnection",
                "interrupt_request_success",
                diagnosticsMetadata(
                    mapOf(
                        "threadId" to payload.threadId,
                        "turnId" to payload.turnId
                    )
                )
            )
        }
    }

    suspend fun requestThreadList(
        limit: Int = 50,
        cursor: String? = null
    ): ThreadListResponsePayload {
        return sendRequest(
            type = "thread_list_req",
            payloadJson = json.encodeToString(
                ThreadListRequestPayload.serializer(),
                ThreadListRequestPayload(limit = limit, cursor = cursor)
            ),
            responseType = "thread_list_res",
            deserialize = {
                json.decodeFromString(
                    Envelope.serializer(ThreadListResponsePayload.serializer()),
                    it
                ).payload
            }
        )
    }

    suspend fun requestThreadResume(
        threadId: String,
        beforeItemId: String? = null,
        windowSize: Int? = null
    ): ThreadResumeResponsePayload {
        return sendRequest(
            type = "thread_resume_req",
            payloadJson = json.encodeToString(
                ThreadResumeRequestPayload.serializer(),
                ThreadResumeRequestPayload(
                    threadId = threadId,
                    beforeItemId = beforeItemId,
                    windowSize = windowSize
                )
            ),
            responseType = "thread_resume_res",
            extraDiagnostics = threadResumeRequestMetadata(threadId, beforeItemId, windowSize),
            deserialize = {
                json.decodeFromString(
                    Envelope.serializer(ThreadResumeResponsePayload.serializer()),
                    it
                ).payload
            }
        )
    }

    suspend fun requestThreadCreate(cwd: String? = null): ThreadCreateResponsePayload {
        return sendRequest(
            type = "thread_create_req",
            payloadJson = json.encodeToString(
                ThreadCreateRequestPayload.serializer(),
                ThreadCreateRequestPayload(cwd = cwd)
            ),
            responseType = "thread_create_res",
            idempotencyKey = UUID.randomUUID().toString(),
            deserialize = {
                json.decodeFromString(
                    Envelope.serializer(ThreadCreateResponsePayload.serializer()),
                    it
                ).payload
            }
        )
    }

    suspend fun requestThreadArchive(threadId: String): ThreadArchiveResponsePayload {
        return sendRequest(
            type = "thread_archive_req",
            payloadJson = json.encodeToString(
                ThreadArchiveRequestPayload.serializer(),
                ThreadArchiveRequestPayload(threadId = threadId)
            ),
            responseType = "thread_archive_res",
            idempotencyKey = UUID.randomUUID().toString(),
            deserialize = {
                json.decodeFromString(
                    Envelope.serializer(ThreadArchiveResponsePayload.serializer()),
                    it
                ).payload
            }
        )
    }

    private suspend fun requestPresenceSync(): PresenceSyncResponsePayload {
        DiagnosticsLogger.debug(
            "RelayConnection",
            "presence_sync_request_start",
            diagnosticsMetadata()
        )
        return sendRequest(
            type = "presence_sync_req",
            payloadJson = json.encodeToString(
                PresenceSyncRequestPayload.serializer(),
                PresenceSyncRequestPayload()
            ),
            responseType = "presence_sync_res",
            deserialize = {
                json.decodeFromString(
                    Envelope.serializer(PresenceSyncResponsePayload.serializer()),
                    it
                ).payload
            }
        )
    }

    private suspend fun requestControlTakeover(): ControlTakeoverResponsePayload {
        return sendRequest(
            type = "control_takeover_req",
            payloadJson = json.encodeToString(
                ControlTakeoverRequestPayload.serializer(),
                ControlTakeoverRequestPayload()
            ),
            responseType = "control_takeover_res",
            deserialize = {
                json.decodeFromString(
                    Envelope.serializer(ControlTakeoverResponsePayload.serializer()),
                    it
                ).payload
            }
        )
    }

    private suspend fun <R> sendRequest(
        type: String,
        payloadJson: String,
        responseType: String,
        idempotencyKey: String? = null,
        extraDiagnostics: Map<String, String?> = emptyMap(),
        deserialize: (String) -> R
    ): R {
        ensureConnected()
        val currentBindingId = requireBindingId()
        val requestId = UUID.randomUUID().toString()
        val deferred = CompletableDeferred<String>()
        pendingRequests[requestId] = deferred

        DiagnosticsLogger.debug(
            "RelayConnection",
            "send_request_start",
            diagnosticsMetadata(
                mapOf(
                    "type" to type,
                    "responseType" to responseType,
                    "requestId" to requestId,
                    "idempotencyKeyPresent" to (idempotencyKey != null).toString()
                ) + extraDiagnostics
            )
        )

        val sent = sendEnvelope(
            id = requestId,
            type = type,
            payloadJson = payloadJson,
            requiresAck = true,
            idempotencyKey = idempotencyKey,
            bindingIdOverride = currentBindingId
        )
        if (!sent) {
            pendingRequests.remove(requestId)
            throw RelayConnectionError.ConnectionClosed()
        }

        return try {
            val responseRaw = deferred.await()
            val responseHeader = runCatching {
                json.decodeFromString<EnvelopeHeader>(responseRaw)
            }.getOrNull()
            if (responseHeader?.type != responseType) {
                DiagnosticsLogger.warning(
                    "RelayConnection",
                    "send_request_unexpected_response_type",
                    diagnosticsMetadata(
                        mapOf(
                            "type" to type,
                            "responseType" to responseType,
                            "actualType" to responseHeader?.type,
                            "requestId" to requestId
                        ) + extraDiagnostics
                    )
                )
                throw RelayConnectionError.Server("unexpected response type: ${responseHeader?.type}")
            }
            val decoded = deserialize(responseRaw)
            DiagnosticsLogger.debug(
                "RelayConnection",
                "send_request_success",
                diagnosticsMetadata(
                    mapOf(
                        "type" to type,
                        "responseType" to responseType,
                        "requestId" to requestId
                    ) + extraDiagnostics
                )
            )
            decoded
        } catch (error: Exception) {
            pendingRequests.remove(requestId)
            throw error
        }
    }

    private suspend fun ensureConnected() {
        if (isCurrentCredentialBlocked) {
            throw RelayConnectionError.RePairingRequired()
        }

        if (_needsSessionRecovery.value) {
            throw RelayConnectionError.SessionRecoveryRequired()
        }

        if (webSocket == null) {
            connect()
        }

        while (true) {
            when (val currentState = _state.value) {
                ConnectionState.Connected -> return
                ConnectionState.Connecting -> {
                    val auth = pendingAuth
                    if (auth != null) {
                        auth.await()
                    } else {
                        delay(150)
                    }
                }
                is ConnectionState.Failed -> {
                    if (isCurrentCredentialBlocked) {
                        throw RelayConnectionError.RePairingRequired()
                    }
                    if (_needsSessionRecovery.value) {
                        throw RelayConnectionError.SessionRecoveryRequired()
                    }
                    throw RelayConnectionError.Server(currentState.reason)
                }
                ConnectionState.Disconnected -> throw RelayConnectionError.NotConnected()
            }
        }
    }

    private fun requireBindingId(): String =
        bindingId ?: throw RelayConnectionError.BindingUnavailable()

    private fun connectIfNeeded() {
        if (webSocket != null) {
            DiagnosticsLogger.debug(
                "RelayConnection",
                "connect_skipped_existing_socket",
                diagnosticsMetadata()
            )
            return
        }
        if (_needsSessionRecovery.value) {
            _state.value = ConnectionState.Failed(RelayConnectionError.SessionRecoveryRequired().message!!)
            DiagnosticsLogger.warning(
                "RelayConnection",
                "connect_blocked_session_recovery",
                diagnosticsMetadata()
            )
            return
        }
        if (isCurrentCredentialBlocked) {
            _requiresRePairing.value = true
            _state.value = ConnectionState.Failed(RelayConnectionError.RePairingRequired().message!!)
            DiagnosticsLogger.warning(
                "RelayConnection",
                "connect_blocked_repairing_required",
                diagnosticsMetadata()
            )
            return
        }

        val url = relayUrl ?: run {
            _state.value = ConnectionState.Disconnected
            DiagnosticsLogger.warning(
                "RelayConnection",
                "connect_missing_relay_url",
                diagnosticsMetadata()
            )
            return
        }

        _state.value = ConnectionState.Connecting
        DiagnosticsLogger.info(
            "RelayConnection",
            "websocket_connect_start",
            diagnosticsMetadata(
                mapOf(
                    "relayURL" to url,
                    "readTimeoutMs" to "0",
                    "pingIntervalSeconds" to WEBSOCKET_PING_INTERVAL_SECONDS.toString()
                )
            )
        )

        val request = Request.Builder().url(url).build()
        webSocket = webSocketClient.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                scope.launch { handleOpen() }
            }

            override fun onMessage(ws: WebSocket, text: String) {
                scope.launch { handleMessage(text) }
            }

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                scope.launch { handleFailure(t.message ?: "WebSocket failure") }
            }

            override fun onClosing(ws: WebSocket, code: Int, reason: String) {
                scope.launch { handleClose(code, reason) }
            }
        })
    }

    private fun handleOpen() {
        reconnectAttempt = 0
        authAttemptStartedAt = System.currentTimeMillis()
        pendingAuth = CompletableDeferred()
        DiagnosticsLogger.info("RelayConnection", "auth_send_start", diagnosticsMetadata())
        sendAuth()
    }

    private fun sendAuth() {
        val id = deviceId
        val token = deviceToken
        if (id.isNullOrEmpty() || token.isNullOrEmpty()) {
            handleFailure("Relay session is not configured")
            return
        }

        val payload = AuthPayload(
            deviceType = "mobile",
            deviceId = id,
            deviceToken = token,
            clientVersion = CLIENT_VERSION
        )
        val sent = sendEnvelope(
            type = "auth",
            payloadJson = json.encodeToString(AuthPayload.serializer(), payload),
            bindingIdOverride = null
        )
        if (!sent) {
            handleFailure("Auth send failed")
        }
    }

    private fun handleMessage(text: String) {
        val header = runCatching {
            json.decodeFromString<EnvelopeHeader>(text)
        }.getOrNull() ?: run {
            DiagnosticsLogger.warning(
                "RelayConnection",
                "message_decode_failed",
                diagnosticsMetadata(mapOf("rawLength" to text.length.toString()))
            )
            return
        }

        if (header.type == "error") {
            handleErrorEnvelope(text)
            return
        }

        val pending = pendingRequests.remove(header.id)
        if (header.type == "thread_resume_res") {
            val responseEnvelope = runCatching {
                json.decodeFromString(
                    Envelope.serializer(ThreadResumeResponsePayload.serializer()),
                    text
                )
            }.getOrNull()
            DiagnosticsLogger.info(
                "RelayConnection",
                "thread_resume_response_envelope_received",
                diagnosticsMetadata(
                    mapOf(
                        "requestId" to header.id,
                        "rawLength" to text.length.toString(),
                        "pendingMatched" to (pending != null).toString()
                    ) + threadResumeResponseMetadata(responseEnvelope?.payload)
                )
            )
        }
        if (pending != null) {
            pending.complete(text)
        }

        when (header.type) {
            "auth_ok" -> handleAuthOk(text)
            "ping" -> handlePing(text)
            "pong" -> heartbeatManager.receivedPong()
            "agent_presence" -> handleAgentPresence(text)
            "agent_health_report" -> handleAgentHealthReport(text)
            "presence_sync_res" -> handlePresenceSyncResponse(text)
            "control_revoked" -> handleControlRevoked(text)
            "turn_status" -> handleTurnStatus(text)
            "turn_delta" -> handleTurnDelta(text)
            "command_output_delta" -> handleCommandOutputDelta(text)
            "approval_requested" -> handleApprovalRequested(text)
            "approval_resolved" -> handleApprovalResolved(text)
            "turn_interrupted" -> handleTurnInterrupted(text)
            "turn_completed" -> handleTurnCompleted(text)
            "token_revoked" -> handleTokenRevoked(text)
            "thread_list_res", "thread_resume_res", "thread_create_res",
            "thread_archive_res", "control_takeover_res" -> Unit
            else -> DiagnosticsLogger.debug(
                "RelayConnection",
                "unhandled_message_received",
                diagnosticsMetadata(mapOf("type" to header.type, "requestId" to header.id))
            )
        }
    }

    private fun handleAuthOk(raw: String) {
        val envelope = runCatching {
            json.decodeFromString(Envelope.serializer(AuthOkPayload.serializer()), raw)
        }.getOrNull() ?: return
        supportedFeatures = envelope.payload.features.toSet()
        cancelReconnect(resetAttempt = true)
        sessionRecoveryFailureCount = 0
        _state.value = ConnectionState.Connected
        pendingAuth?.complete(Unit)
        pendingAuth = null
        heartbeatManager.start(
            scope = scope,
            sendPing = { sendPingFrame() },
            onTimeout = { handleFailure("Heartbeat timeout") }
        )
        _connectionEpoch.value += 1L
        schedulePresenceSync(force = true)
        scheduleControlTakeover(trigger = "auth_ok")
        DiagnosticsLogger.info(
            "RelayConnection",
            "auth_ok_received",
            diagnosticsMetadata(
                mapOf(
                    "connectionEpoch" to _connectionEpoch.value.toString(),
                    "features" to envelope.payload.features.joinToString(","),
                    "serverVersion" to envelope.payload.serverVersion,
                    "durationMs" to authAttemptStartedAt?.let(DiagnosticsLogger::durationMilliseconds)
                )
            )
        )
        DiagnosticsLogger.info(
            "RelayConnection",
            "auth_completed",
            diagnosticsMetadata(
                mapOf(
                    "supportedFeatures" to envelope.payload.features.sorted().joinToString(","),
                    "durationMs" to authAttemptStartedAt?.let(DiagnosticsLogger::durationMilliseconds)
                )
            )
        )
        authAttemptStartedAt = null
    }

    private fun handlePing(raw: String) {
        val envelope = runCatching {
            json.decodeFromString(Envelope.serializer(PingPayload.serializer()), raw)
        }.getOrNull() ?: return
        sendEnvelope(
            type = "pong",
            payloadJson = json.encodeToString(PongPayload.serializer(), PongPayload(ts = envelope.payload.ts))
        )
    }

    private fun sendPingFrame() {
        val ts = System.currentTimeMillis() / 1000
        sendEnvelope(
            type = "ping",
            payloadJson = json.encodeToString(PingPayload.serializer(), PingPayload(ts = ts))
        )
    }

    private fun handleAgentPresence(raw: String) {
        val envelope = runCatching {
            json.decodeFromString(Envelope.serializer(AgentPresencePayload.serializer()), raw)
        }.getOrNull() ?: return
        if (envelope.bindingId != bindingId) return

        applyAgentPresence(envelope.payload.status, envelope.payload.reason, envelope.payload.detail)
        DiagnosticsLogger.info(
            "RelayConnection",
            "agent_presence_received",
            diagnosticsMetadata(
                mapOf(
                    "agentId" to envelope.payload.agentId,
                    "status" to statusValue(envelope.payload.status),
                    "reason" to degradedReasonValue(envelope.payload.reason),
                    "detail" to envelope.payload.detail
                )
            )
        )
        if (envelope.payload.status == AgentPresenceStatus.OFFLINE) {
            schedulePresenceSync(delayMs = 1_500L)
        }
    }

    private fun handleAgentHealthReport(raw: String) {
        val envelope = runCatching {
            json.decodeFromString(Envelope.serializer(AgentHealthReportPayload.serializer()), raw)
        }.getOrNull() ?: return
        applyAgentPresence(envelope.payload.status, envelope.payload.reason, envelope.payload.detail)
        DiagnosticsLogger.info(
            "RelayConnection",
            "agent_health_report_received",
            diagnosticsMetadata(
                mapOf(
                    "status" to statusValue(envelope.payload.status),
                    "reason" to degradedReasonValue(envelope.payload.reason),
                    "detail" to envelope.payload.detail
                )
            )
        )
    }

    private fun handlePresenceSyncResponse(raw: String) {
        val envelope = runCatching {
            json.decodeFromString(Envelope.serializer(PresenceSyncResponsePayload.serializer()), raw)
        }.getOrNull() ?: return
        if (envelope.bindingId != bindingId) return

        applyAgentPresence(envelope.payload.status, envelope.payload.reason, envelope.payload.detail)
        DiagnosticsLogger.info(
            "RelayConnection",
            "presence_sync_response_received",
            diagnosticsMetadata(
                mapOf(
                    "agentId" to envelope.payload.agentId,
                    "status" to statusValue(envelope.payload.status),
                    "reason" to degradedReasonValue(envelope.payload.reason),
                    "detail" to envelope.payload.detail,
                    "updatedAt" to envelope.payload.updatedAt.toString()
                )
            )
        )
    }

    private fun handleControlRevoked(raw: String) {
        val envelope = runCatching {
            json.decodeFromString(Envelope.serializer(ControlRevokedPayload.serializer()), raw)
        }.getOrNull() ?: return
        DiagnosticsLogger.warning(
            "RelayConnection",
            "control_revoked_received",
            diagnosticsMetadata(
                mapOf(
                    "agentId" to envelope.payload.agentId,
                    "bindingId" to envelope.bindingId,
                    "takenByDeviceId" to envelope.payload.takenByDeviceId,
                    "message" to envelope.payload.message
                )
            )
        )
        if (envelope.bindingId == bindingId) {
            markControlRevoked(envelope.payload.message)
        }
    }

    private fun applyAgentPresence(
        status: AgentPresenceStatus,
        reason: AgentDegradedReason?,
        detail: String?
    ) {
        _agentStatus.value = when (status) {
            AgentPresenceStatus.ONLINE -> AgentStatus.ONLINE
            AgentPresenceStatus.OFFLINE -> AgentStatus.OFFLINE
            AgentPresenceStatus.DEGRADED -> AgentStatus.DEGRADED
        }
        _agentDegradedReason.value = reason
        _agentDegradedDetail.value = detail
        DiagnosticsLogger.info(
            "RelayConnection",
            "apply_agent_presence",
            diagnosticsMetadata(
                mapOf(
                    "status" to statusValue(status),
                    "reason" to degradedReasonValue(reason),
                    "detail" to detail
                )
            )
        )
    }

    private fun handleTurnStatus(raw: String) {
        val envelope = runCatching {
            json.decodeFromString(Envelope.serializer(TurnStatusPayload.serializer()), raw)
        }.getOrNull() ?: return
        pendingTurns[envelope.payload.requestId]?.let { ctx ->
            if (envelope.payload.turnId != null) {
                ctx.turnId = envelope.payload.turnId
            }
            ctx.handlers.onStatus(envelope.payload)
        }
    }

    private fun handleTurnDelta(raw: String) {
        val envelope = runCatching {
            json.decodeFromString(Envelope.serializer(TurnDeltaPayload.serializer()), raw)
        }.getOrNull() ?: return
        pendingTurns[envelope.payload.requestId]?.handlers?.onDelta(envelope.payload)
    }

    private fun handleCommandOutputDelta(raw: String) {
        val envelope = runCatching {
            json.decodeFromString(Envelope.serializer(CommandOutputDeltaPayload.serializer()), raw)
        }.getOrNull() ?: return
        pendingTurns[envelope.payload.requestId]?.handlers?.onCommandOutput(envelope.payload)
    }

    private fun handleApprovalRequested(raw: String) {
        val envelope = runCatching {
            json.decodeFromString(Envelope.serializer(ApprovalRequestedPayload.serializer()), raw)
        }.getOrNull() ?: return
        pendingTurns[envelope.payload.requestId]?.handlers?.onApprovalRequested(envelope.payload)
    }

    private fun handleApprovalResolved(raw: String) {
        val envelope = runCatching {
            json.decodeFromString(Envelope.serializer(ApprovalResolvedPayload.serializer()), raw)
        }.getOrNull() ?: return
        DiagnosticsLogger.info(
            "RelayConnection",
            "approval_resolved_received",
            diagnosticsMetadata(
                mapOf(
                    "approvalId" to envelope.payload.approvalId,
                    "threadId" to envelope.payload.threadId,
                    "turnId" to envelope.payload.turnId,
                    "decision" to envelope.payload.decision.name
                )
            )
        )
    }

    private fun handleTurnInterrupted(raw: String) {
        val envelope = runCatching {
            json.decodeFromString(Envelope.serializer(TurnInterruptedPayload.serializer()), raw)
        }.getOrNull() ?: return
        pendingTurns.remove(envelope.payload.requestId)?.handlers?.completion(
            Result.failure(RelayConnectionError.TurnInterrupted())
        )
    }

    private fun handleTurnCompleted(raw: String) {
        val envelope = runCatching {
            json.decodeFromString(Envelope.serializer(TurnCompletedPayload.serializer()), raw)
        }.getOrNull() ?: return
        pendingTurns.remove(envelope.payload.requestId)?.handlers?.completion(
            Result.success(envelope.payload)
        )
        DiagnosticsLogger.info(
            "RelayConnection",
            "turn_completed_received",
            diagnosticsMetadata(
                mapOf(
                    "requestId" to envelope.payload.requestId,
                    "threadId" to envelope.payload.threadId,
                    "turnId" to envelope.payload.turnId,
                    "status" to envelope.payload.status
                )
            )
        )
    }

    private fun handleTokenRevoked(raw: String) {
        val envelope = runCatching {
            json.decodeFromString(Envelope.serializer(TokenRevokedPayload.serializer()), raw)
        }.getOrNull()
        val message = envelope?.payload?.message ?: "Token revoked"
        DiagnosticsLogger.warning(
            "RelayConnection",
            "token_revoked_received",
            diagnosticsMetadata(mapOf("message" to message))
        )
        markSessionRecoveryNeeded(message)
    }

    private fun handleErrorEnvelope(raw: String) {
        val envelope = runCatching {
            json.decodeFromString(Envelope.serializer(ErrorPayload.serializer()), raw)
        }.getOrNull() ?: return
        DiagnosticsLogger.warning(
            "RelayConnection",
            "relay_error_received",
            diagnosticsMetadata(
                mapOf(
                    "requestId" to envelope.id,
                    "code" to envelope.payload.code.rawValue,
                    "message" to envelope.payload.message
                )
            )
        )
        val error = relayError(envelope.payload)

        val auth = pendingAuth
        if (auth != null) {
            pendingAuth = null
            DiagnosticsLogger.warning(
                "RelayConnection",
                "auth_failed",
                diagnosticsMetadata(
                    mapOf(
                        "error" to error.message,
                        "durationMs" to authAttemptStartedAt?.let(DiagnosticsLogger::durationMilliseconds)
                    )
                )
            )
            auth.completeExceptionally(error)
            handleCredentialStateTransition(error)
            return
        }

        val pending = pendingRequests.remove(envelope.id)
        if (pending != null) {
            pending.completeExceptionally(error)
            handleCredentialStateTransition(error)
            return
        }

        val pendingTurn = pendingTurns.remove(envelope.id)
        if (pendingTurn != null) {
            pendingTurn.handlers.completion(Result.failure(error))
            handleCredentialStateTransition(error)
        }
    }

    private fun relayError(payload: ErrorPayload): RelayConnectionError =
        when (payload.code) {
            ErrorCode.AUTH_FAILED -> markAuthFailureState(payload.message)
            ErrorCode.TOKEN_EXPIRED, ErrorCode.TOKEN_REVOKED ->
                markSessionRecoveryNeededState(payload.message)
            ErrorCode.AGENT_OFFLINE -> {
                markAgentOffline(payload.message)
                RelayConnectionError.Server(payload.message)
            }
            ErrorCode.CONTROL_NOT_HELD -> {
                markControlRevoked(payload.message)
                RelayConnectionError.Server(payload.message)
            }
            else -> RelayConnectionError.Server(payload.message)
        }

    private fun markAuthFailureState(message: String?): RelayConnectionError {
        blockedCredentialFingerprint = currentCredentialFingerprint
        _requiresRePairing.value = true
        _needsSessionRecovery.value = false
        _state.value = ConnectionState.Failed(message ?: RelayConnectionError.RePairingRequired().message!!)
        resetAgentPresence()
        DiagnosticsLogger.warning(
            "RelayConnection",
            "mark_auth_failure",
            diagnosticsMetadata(mapOf("message" to message))
        )
        return RelayConnectionError.RePairingRequired()
    }

    private fun markSessionRecoveryNeededState(message: String): RelayConnectionError {
        shouldMaintainConnection = false
        _needsSessionRecovery.value = true
        _requiresRePairing.value = false
        _state.value = ConnectionState.Failed(message)
        cancelPresenceSync()
        resetAgentPresence()
        resetCurrentBindingControlState()
        DiagnosticsLogger.warning(
            "RelayConnection",
            "session_recovery_required",
            diagnosticsMetadata(mapOf("message" to message))
        )
        return RelayConnectionError.SessionRecoveryRequired()
    }

    private fun handleCredentialStateTransition(error: RelayConnectionError) {
        when (error) {
            is RelayConnectionError.RePairingRequired,
            is RelayConnectionError.SessionRecoveryRequired ->
                handleFailure(error.message ?: "relay credential state changed")
            else -> Unit
        }
    }

    private fun handleFailure(reason: String) {
        authAttemptStartedAt = null
        DiagnosticsLogger.warning(
            "RelayConnection",
            "connection_failure",
            diagnosticsMetadata(
                mapOf(
                    "error" to reason,
                    "shouldMaintainConnection" to shouldMaintainConnection.toString(),
                    "sessionRecoveryFailureCount" to sessionRecoveryFailureCount.toString()
                )
            )
        )
        cleanupConnection()
        if (shouldMaintainConnection && !_requiresRePairing.value && !_needsSessionRecovery.value) {
            scheduleReconnect()
        } else if (_state.value !is ConnectionState.Failed) {
            _state.value = ConnectionState.Failed(reason)
        }
    }

    private fun handleClose(code: Int, reason: String) {
        DiagnosticsLogger.info(
            "RelayConnection",
            "websocket_closed",
            diagnosticsMetadata(
                mapOf(
                    "code" to code.toString(),
                    "reason" to reason
                )
            )
        )
        cleanupConnection()
        if (shouldMaintainConnection && !_requiresRePairing.value && !_needsSessionRecovery.value) {
            scheduleReconnect()
        }
    }

    private fun scheduleReconnect() {
        cancelReconnect(resetAttempt = false)
        reconnectAttempt += 1
        val delayMs = reconnectPolicy.delayMs(reconnectAttempt)
        _state.value = ConnectionState.Connecting
        reconnectJob = scope.launch {
            delay(delayMs)
            connectIfNeeded()
        }
        DiagnosticsLogger.info(
            "RelayConnection",
            "reconnect_scheduled",
            diagnosticsMetadata(
                mapOf(
                    "attempt" to reconnectAttempt.toString(),
                    "delayMs" to delayMs.toString()
                )
            )
        )
    }

    private fun cancelReconnect(resetAttempt: Boolean) {
        reconnectJob?.cancel()
        reconnectJob = null
        if (resetAttempt) {
            reconnectAttempt = 0
        }
    }

    private fun schedulePresenceSync(force: Boolean = false, delayMs: Long = 0L) {
        if (!supportsPresenceSync) {
            DiagnosticsLogger.debug(
                "RelayConnection",
                "presence_sync_skipped_feature_unsupported",
                diagnosticsMetadata()
            )
            return
        }
        if (_state.value !is ConnectionState.Connected) {
            DiagnosticsLogger.debug(
                "RelayConnection",
                "presence_sync_skipped_not_connected",
                diagnosticsMetadata()
            )
            return
        }
        if (_requiresRePairing.value || _needsSessionRecovery.value) return

        if (!force) {
            if (presenceSyncJob != null) {
                DiagnosticsLogger.debug(
                    "RelayConnection",
                    "presence_sync_skipped_existing_task",
                    diagnosticsMetadata()
                )
                return
            }
            val lastSync = lastPresenceSyncAt
            if (lastSync != null && System.currentTimeMillis() - lastSync < PRESENCE_SYNC_THROTTLE_MS) {
                DiagnosticsLogger.debug(
                    "RelayConnection",
                    "presence_sync_skipped_recent_sync",
                    diagnosticsMetadata()
                )
                return
            }
        }

        DiagnosticsLogger.info(
            "RelayConnection",
            "presence_sync_scheduled",
            diagnosticsMetadata(
                mapOf(
                    "force" to force.toString(),
                    "delayMs" to delayMs.toString()
                )
            )
        )
        presenceSyncJob?.cancel()
        presenceSyncJob = scope.launch {
            if (delayMs > 0) {
                try {
                    delay(delayMs)
                } catch (_: CancellationException) {
                    presenceSyncJob = null
                    return@launch
                }
            }

            if (!supportsPresenceSync || _state.value !is ConnectionState.Connected ||
                _requiresRePairing.value || _needsSessionRecovery.value
            ) {
                presenceSyncJob = null
                return@launch
            }

            lastPresenceSyncAt = System.currentTimeMillis()
            runCatching { requestPresenceSync() }
                .onSuccess { payload ->
                    applyAgentPresence(payload.status, payload.reason, payload.detail)
                }
                .onFailure { error ->
                    DiagnosticsLogger.warning(
                        "RelayConnection",
                        "presence_sync_failed",
                        diagnosticsMetadata(mapOf("error" to error.message))
                    )
                }
            presenceSyncJob = null
        }
    }

    private fun cancelPresenceSync() {
        presenceSyncJob?.cancel()
        presenceSyncJob = null
        lastPresenceSyncAt = null
    }

    private fun scheduleControlTakeover(trigger: String) {
        if (!supportsControlTakeover) return
        val currentBindingId = bindingId ?: return
        if (controlledBindingId == currentBindingId) return
        if (_isAcquiringCurrentBindingControl.value && controlRequestBindingId == currentBindingId) return

        controlTakeoverJob?.cancel()
        _isAcquiringCurrentBindingControl.value = true
        controlRequestBindingId = currentBindingId
        DiagnosticsLogger.info(
            "RelayConnection",
            "control_takeover_scheduled",
            diagnosticsMetadata(
                mapOf(
                    "bindingId" to currentBindingId,
                    "trigger" to trigger
                )
            )
        )
        controlTakeoverJob = scope.launch {
            try {
                performControlTakeover(trigger = trigger, force = false)
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                DiagnosticsLogger.warning(
                    "RelayConnection",
                    "control_takeover_schedule_failed",
                    diagnosticsMetadata(
                        mapOf(
                            "bindingId" to currentBindingId,
                            "trigger" to trigger,
                            "error" to error.message
                        )
                    )
                )
            }
        }
    }

    private suspend fun performControlTakeover(trigger: String, force: Boolean) {
        if (!supportsControlTakeover) return
        val currentBindingId = bindingId ?: return

        if (!force && controlledBindingId == currentBindingId) {
            _isAcquiringCurrentBindingControl.value = false
            controlRequestBindingId = null
            return
        }

        _isAcquiringCurrentBindingControl.value = true
        controlRequestBindingId = currentBindingId
        DiagnosticsLogger.info(
            "RelayConnection",
            "control_takeover_request_start",
            diagnosticsMetadata(
                mapOf(
                    "bindingId" to currentBindingId,
                    "trigger" to trigger
                )
            )
        )

        try {
            val payload = requestControlTakeover()
            if (bindingId != currentBindingId) return

            controlledBindingId = currentBindingId
            revokedBindingId = null
            _currentControlRevokedMessage.value = null
            _isAcquiringCurrentBindingControl.value = false
            controlRequestBindingId = null
            controlTakeoverJob = null
            DiagnosticsLogger.info(
                "RelayConnection",
                "control_takeover_request_success",
                diagnosticsMetadata(
                    mapOf(
                        "bindingId" to currentBindingId,
                        "trigger" to trigger,
                        "agentId" to payload.agentId,
                        "controllerDeviceId" to payload.controllerDeviceId
                    )
                )
            )
        } catch (error: Exception) {
            if (bindingId == currentBindingId) {
                _isAcquiringCurrentBindingControl.value = false
                controlRequestBindingId = null
            }
            controlTakeoverJob = null
            throw error
        }
    }

    private fun cleanupConnection() {
        DiagnosticsLogger.info(
            "RelayConnection",
            "cleanup_connection",
            diagnosticsMetadata(
                mapOf(
                    "pendingRequestCount" to pendingRequests.size.toString(),
                    "pendingTurnCount" to pendingTurns.size.toString()
                )
            )
        )
        heartbeatManager.stop()
        cancelPresenceSync()
        resetCurrentBindingControlState()

        val socket = webSocket
        webSocket = null
        authAttemptStartedAt = null
        supportedFeatures = emptySet()

        socket?.close(1000, "cleanup")

        val authLost = RelayConnectionError.ConnectionClosed()
        pendingAuth?.completeExceptionally(authLost)
        pendingAuth = null

        val connLost = RelayConnectionError.ConnectionClosed()
        pendingRequests.values.forEach { it.completeExceptionally(connLost) }
        pendingRequests.clear()

        val turnFailed = RelayConnectionError.ConnectionClosed()
        pendingTurns.values.forEach { it.handlers.completion(Result.failure(turnFailed)) }
        pendingTurns.clear()

        resetAgentPresence()
    }

    private fun resetAgentPresence() {
        _agentStatus.value = AgentStatus.UNKNOWN
        _agentDegradedReason.value = null
        _agentDegradedDetail.value = null
    }

    private fun resetCurrentBindingControlState() {
        controlTakeoverJob?.cancel()
        controlTakeoverJob = null
        controlledBindingId = null
        controlRequestBindingId = null
        revokedBindingId = null
        _isAcquiringCurrentBindingControl.value = false
        _currentControlRevokedMessage.value = null
    }

    private fun markControlRevoked(message: String) {
        val currentBindingId = bindingId ?: return
        controlTakeoverJob?.cancel()
        controlTakeoverJob = null
        controlledBindingId = null
        controlRequestBindingId = null
        revokedBindingId = currentBindingId
        _isAcquiringCurrentBindingControl.value = false
        _currentControlRevokedMessage.value = message
        DiagnosticsLogger.warning(
            "RelayConnection",
            "control_revoked_applied",
            diagnosticsMetadata(
                mapOf(
                    "bindingId" to currentBindingId,
                    "message" to message
                )
            )
        )
    }

    private fun markAgentOffline(detail: String) {
        applyAgentPresence(AgentPresenceStatus.OFFLINE, null, detail)
        DiagnosticsLogger.warning(
            "RelayConnection",
            "mark_agent_offline",
            diagnosticsMetadata(mapOf("detail" to detail))
        )
        schedulePresenceSync(force = true, delayMs = 1_500L)
    }

    private fun sendEnvelope(
        id: String = UUID.randomUUID().toString(),
        type: String,
        payloadJson: String,
        requiresAck: Boolean = false,
        idempotencyKey: String? = null,
        bindingIdOverride: String? = bindingId
    ): Boolean {
        val ws = webSocket ?: return false
        return try {
            val ts = System.currentTimeMillis() / 1000
            val bindingField = bindingIdOverride?.let { ""","bindingId":"$it"""" } ?: ""
            val idempotencyField = idempotencyKey?.let { ""","idempotencyKey":"$it"""" } ?: ""
            val envelope =
                """{"id":"$id","type":"$type"$bindingField,"createdAt":$ts,"requiresAck":$requiresAck,"protocolVersion":1$idempotencyField,"payload":$payloadJson}"""
            ws.send(envelope)
        } catch (error: Exception) {
            DiagnosticsLogger.warning(
                "RelayConnection",
                "send_envelope_failed",
                diagnosticsMetadata(
                    mapOf(
                        "type" to type,
                        "id" to id,
                        "error" to error.message
                    )
                )
            )
            false
        }
    }

    private fun diagnosticsMetadata(extra: Map<String, String?> = emptyMap()): Map<String, String> {
        val metadata = extra.toMutableMap()
        metadata["relayURL"] = relayUrl
        metadata["deviceId"] = deviceId
        metadata["bindingId"] = bindingId
        metadata["connectionState"] = describeState(_state.value)
        metadata["agentStatus"] = describeAgentStatus(_agentStatus.value)
        metadata["degradedReason"] = degradedReasonValue(_agentDegradedReason.value)
        metadata["degradedDetail"] = _agentDegradedDetail.value
        return DiagnosticsLogger.pairTraceMetadata(pairTraceId, metadata)
    }

    private fun threadResumeRequestMetadata(
        threadId: String,
        beforeItemId: String?,
        windowSize: Int?
    ): Map<String, String?> = mapOf(
        "threadId" to threadId,
        "beforeItemId" to beforeItemId,
        "windowSize" to windowSize?.toString()
    )

    private fun threadResumeResponseMetadata(
        payload: ThreadResumeResponsePayload?
    ): Map<String, String?> {
        val timelineItems = payload?.timelineItems.orEmpty()
        val messages = payload?.messages.orEmpty()
        return mapOf(
            "threadId" to payload?.threadId,
            "messageCount" to messages.size.toString(),
            "timelineItemCount" to timelineItems.size.toString(),
            "hasMoreBefore" to payload?.hasMoreBefore?.toString(),
            "responseWindowKind" to if (timelineItems.isNotEmpty()) "timeline" else "messages",
            "firstMessageId" to messages.firstOrNull()?.id,
            "lastMessageId" to messages.lastOrNull()?.id,
            "firstTimelineItemId" to timelineItems.firstOrNull()?.id,
            "lastTimelineItemId" to timelineItems.lastOrNull()?.id
        )
    }

    private fun describeState(state: ConnectionState): String =
        when (state) {
            ConnectionState.Disconnected -> "disconnected"
            ConnectionState.Connecting -> "connecting"
            ConnectionState.Connected -> "connected"
            is ConnectionState.Failed -> "failed(${state.reason})"
        }

    private fun describeAgentStatus(status: AgentStatus): String =
        when (status) {
            AgentStatus.UNKNOWN -> "unknown"
            AgentStatus.ONLINE -> "online"
            AgentStatus.OFFLINE -> "offline"
            AgentStatus.DEGRADED -> "degraded"
        }

    private fun degradedReasonValue(reason: AgentDegradedReason?): String? =
        when (reason) {
            AgentDegradedReason.RUNTIME_UNAVAILABLE -> "runtime_unavailable"
            AgentDegradedReason.REQUEST_FAILURES -> "request_failures"
            null -> null
        }

    private fun statusValue(status: AgentPresenceStatus): String =
        when (status) {
            AgentPresenceStatus.ONLINE -> "online"
            AgentPresenceStatus.OFFLINE -> "offline"
            AgentPresenceStatus.DEGRADED -> "degraded"
        }

    private class PendingTurnContext(
        val requestId: String,
        val threadId: String,
        val handlers: TurnEventHandlers
    ) {
        var turnId: String? = null
    }
}
