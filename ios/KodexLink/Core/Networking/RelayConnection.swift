import Foundation
import Combine

@MainActor
final class RelayConnection: ObservableObject {
    private static let sessionRecoveryRePairingThreshold = 3

    private final class PendingTurnContext {
        let requestId: String
        let threadId: String
        var turnId: String?
        let handlers: TurnEventHandlers

        init(requestId: String, threadId: String, handlers: TurnEventHandlers) {
            self.requestId = requestId
            self.threadId = threadId
            self.handlers = handlers
        }
    }

    enum ConnectionState: Equatable {
        case disconnected
        case connecting
        case connected
        case failed(String)
    }

    enum AgentStatus: Equatable {
        case unknown
        case online
        case offline
        case degraded
    }

    struct TurnEventHandlers {
        let onStatus: (TurnStatusPayload) -> Void
        let onDelta: (TurnDeltaPayload) -> Void
        let onCommandOutput: (CommandOutputDeltaPayload) -> Void
        let onApprovalRequested: (ApprovalRequestedPayload) -> Void
        let completion: (Result<TurnCompletedPayload, Error>) -> Void
    }

    @Published private(set) var state: ConnectionState = .disconnected
    @Published private(set) var lastMessageText: String?
    @Published private(set) var currentAgentStatus: AgentStatus = .unknown
    @Published private(set) var currentAgentDegradedReason: AgentDegradedReason?
    @Published private(set) var currentAgentDegradedDetail: String?
    @Published private(set) var requiresRePairing = false
    @Published private(set) var needsSessionRecovery = false
    @Published private(set) var isAcquiringCurrentBindingControl = false
    @Published private(set) var currentControlRevokedMessage: String?

    private let session: URLSession
    private var relayURL: URL?
    private var deviceId: String?
    private var deviceToken: String?
    private var bindingId: String?
    private var pairTraceId: String?
    private var webSocketTask: URLSessionWebSocketTask?
    private var receiveTask: Task<Void, Never>?
    private var pendingRequests: [String: (Result<Data, Error>) -> Void] = [:]
    private var pendingTurns: [String: PendingTurnContext] = [:]
    private var pendingAuth: CheckedContinuation<Void, Error>?
    private var blockedCredentialFingerprint: String?
    private let heartbeatManager = HeartbeatManager()
    private let reconnectPolicy: ReconnectPolicy
    private var reconnectTask: Task<Void, Never>?
    private var reconnectAttempt = 0
    private var sessionRecoveryFailureCount = 0
    private var shouldMaintainConnection = false
    private var supportedFeatures: Set<String> = []
    private var authAttemptStartedAt: Date?
    private var presenceSyncTask: Task<Void, Never>?
    private var lastPresenceSyncAt: Date?
    private var controlledBindingId: String?
    private var controlRequestBindingId: String?
    private var revokedBindingId: String?
    private var controlTakeoverTask: Task<Void, Never>?

    var isMissingCodexRuntimeDetail: Bool {
        currentAgentDegradedReason == .runtimeUnavailable &&
        (currentAgentDegradedDetail?.hasPrefix("未找到运行时命令：") ?? false)
    }

    private func diagnosticsMetadata(_ extra: [String: String?] = [:]) -> [String: String] {
        var metadata = extra
        metadata["relayURL"] = relayURL?.absoluteString
        metadata["deviceId"] = deviceId
        metadata["bindingId"] = bindingId
        metadata["traceTag"] = pairTraceId == nil ? nil : "PAIR_TRACE"
        metadata["pairTraceId"] = pairTraceId
        metadata["connectionState"] = Self.describe(state: state)
        metadata["agentStatus"] = Self.describe(agentStatus: currentAgentStatus)
        metadata["degradedReason"] = currentAgentDegradedReason?.rawValue
        metadata["degradedDetail"] = currentAgentDegradedDetail
        return DiagnosticsLogger.metadata(metadata)
    }

    private static func describe(state: ConnectionState) -> String {
        switch state {
        case .disconnected:
            return "disconnected"
        case .connecting:
            return "connecting"
        case .connected:
            return "connected"
        case .failed(let message):
            return "failed(\(message))"
        }
    }

    private static func describe(agentStatus: AgentStatus) -> String {
        switch agentStatus {
        case .unknown:
            return "unknown"
        case .online:
            return "online"
        case .offline:
            return "offline"
        case .degraded:
            return "degraded"
        }
    }

    init(
        session: URLSession = .shared,
        reconnectPolicy: ReconnectPolicy = .default
    ) {
        self.session = session
        self.reconnectPolicy = reconnectPolicy
    }

    func updateSession(
        relayBaseURL: String,
        deviceId: String,
        deviceToken: String,
        bindingId: String?,
        pairTraceId: String? = nil,
        resetRePairingState: Bool = false
    ) {
        let nextRelayURL = RelayConnection.makeRelayWebSocketURL(from: relayBaseURL)
        let transportChanged =
            relayURL != nextRelayURL ||
            self.deviceId != deviceId ||
            self.deviceToken != deviceToken
        let bindingChanged = self.bindingId != bindingId
        let sessionChanged = transportChanged || bindingChanged

        relayURL = nextRelayURL
        self.deviceId = deviceId
        self.deviceToken = deviceToken
        self.bindingId = bindingId
        if let pairTraceId {
            self.pairTraceId = pairTraceId
        } else if sessionChanged {
            self.pairTraceId = nil
        }
        sessionRecoveryFailureCount = 0
        needsSessionRecovery = false
        let newFingerprint = Self.credentialFingerprint(deviceId: deviceId, deviceToken: deviceToken)
        if resetRePairingState {
            blockedCredentialFingerprint = nil
            requiresRePairing = false
            if case .failed = state {
                state = .disconnected
            }
        }
        if blockedCredentialFingerprint != nil && blockedCredentialFingerprint != newFingerprint {
            blockedCredentialFingerprint = nil
            requiresRePairing = false
            if case .failed = state {
                state = .disconnected
            }
        }

        if transportChanged {
            supportedFeatures = []
            cancelPresenceSync()
            resetAgentPresence()
            resetCurrentBindingControlState()
        } else if bindingChanged {
            cancelPresenceSync()
            resetAgentPresence()
            resetCurrentBindingControlState()
            if case .connected = state {
                schedulePresenceSync(force: true)
                scheduleControlTakeover(trigger: "binding_changed")
            }
        }

        DiagnosticsLogger.info(
            "RelayConnection",
            "update_session",
            metadata: diagnosticsMetadata([
                "relayBaseURL": relayBaseURL,
                "tokenPresent": deviceToken.isEmpty ? "false" : "true",
                "sessionChanged": sessionChanged ? "true" : "false",
                "transportChanged": transportChanged ? "true" : "false",
                "bindingChanged": bindingChanged ? "true" : "false",
                "resetRePairingState": resetRePairingState ? "true" : "false"
            ])
        )
    }

    func clearSession() {
        disconnect()
        relayURL = nil
        deviceId = nil
        deviceToken = nil
        bindingId = nil
        pairTraceId = nil
        blockedCredentialFingerprint = nil
        requiresRePairing = false
        needsSessionRecovery = false
        sessionRecoveryFailureCount = 0
        supportedFeatures = []
        cancelPresenceSync()
        resetAgentPresence()
        resetCurrentBindingControlState()
        DiagnosticsLogger.info("RelayConnection", "clear_session")
    }

    func markSessionRecoveryNeeded(message: String) {
        shouldMaintainConnection = false
        needsSessionRecovery = true
        requiresRePairing = false
        state = .failed(message)
        cancelPresenceSync()
        resetAgentPresence()
        resetCurrentBindingControlState()
        DiagnosticsLogger.warning(
            "RelayConnection",
            "session_recovery_required",
            metadata: diagnosticsMetadata([
                "message": message
            ])
        )
    }

    func markRePairingRequired(message: String? = nil) {
        shouldMaintainConnection = false
        blockedCredentialFingerprint = currentCredentialFingerprint
        needsSessionRecovery = false
        requiresRePairing = true
        state = .failed(message ?? RelayConnectionError.rePairingRequired.localizedDescription)
        cancelPresenceSync()
        cleanupConnection()
        resetCurrentBindingControlState()
        DiagnosticsLogger.warning(
            "RelayConnection",
            "repairing_required",
            metadata: diagnosticsMetadata([
                "message": message ?? RelayConnectionError.rePairingRequired.localizedDescription
            ])
        )
    }

    func connect() {
        shouldMaintainConnection = true
        cancelReconnect(resetAttempt: false)
        DiagnosticsLogger.info("RelayConnection", "connect_requested", metadata: diagnosticsMetadata())
        connectIfNeeded()
    }

    func refreshBindingPresenceAfterPairing() {
        resetAgentPresence()
        guard case .connected = state else {
            DiagnosticsLogger.info(
                "RelayConnection",
                "refresh_binding_presence_skipped_not_connected",
                metadata: diagnosticsMetadata()
            )
            return
        }

        schedulePresenceSync(force: true)
        scheduleControlTakeover(trigger: "pairing_refresh")
        DiagnosticsLogger.info(
            "RelayConnection",
            "refresh_binding_presence_requested",
            metadata: diagnosticsMetadata()
        )
    }

    private func connectIfNeeded() {
        guard webSocketTask == nil else {
            DiagnosticsLogger.debug("RelayConnection", "connect_skipped_existing_socket", metadata: diagnosticsMetadata())
            return
        }

        guard !needsSessionRecovery else {
            state = .failed(RelayConnectionError.sessionRecoveryRequired.localizedDescription)
            DiagnosticsLogger.warning("RelayConnection", "connect_blocked_session_recovery", metadata: diagnosticsMetadata())
            return
        }

        guard !isCurrentCredentialBlocked else {
            requiresRePairing = true
            state = .failed(RelayConnectionError.rePairingRequired.localizedDescription)
            DiagnosticsLogger.warning("RelayConnection", "connect_blocked_repairing_required", metadata: diagnosticsMetadata())
            return
        }

        guard let relayURL else {
            state = .disconnected
            DiagnosticsLogger.warning("RelayConnection", "connect_missing_relay_url", metadata: diagnosticsMetadata())
            return
        }

        state = .connecting
        DiagnosticsLogger.info(
            "RelayConnection",
            "websocket_connect_start",
            metadata: diagnosticsMetadata([
                "relayURL": relayURL.absoluteString
            ])
        )

        let task = session.webSocketTask(with: relayURL)
        webSocketTask = task
        task.resume()

        receiveTask = Task { [weak self] in
            await self?.receiveLoop(using: task)
        }

        Task { [weak self] in
            await self?.authenticate(using: task)
        }
    }

    func disconnect() {
        shouldMaintainConnection = false
        cancelReconnect(resetAttempt: true)
        cancelPresenceSync()
        heartbeatManager.stop()
        receiveTask?.cancel()
        receiveTask = nil
        webSocketTask?.cancel(with: .goingAway, reason: nil)
        webSocketTask = nil
        pendingAuth?.resume(throwing: RelayConnectionError.connectionClosed)
        pendingAuth = nil
        state = .disconnected
        sessionRecoveryFailureCount = 0
        resetAgentPresence()
        resetCurrentBindingControlState()
        DiagnosticsLogger.info("RelayConnection", "disconnect_requested", metadata: diagnosticsMetadata())
    }

    deinit {
        receiveTask?.cancel()
        webSocketTask?.cancel(with: .goingAway, reason: nil)
    }

    func requestThreadList(limit: Int, cursor: String? = nil) async throws -> ThreadListResponsePayload {
        try await sendRequest(
            type: "thread_list_req",
            payload: ThreadListRequestPayload(limit: limit, cursor: cursor),
            responseType: "thread_list_res"
        )
    }

    func requestThreadResume(
        threadId: String,
        beforeItemId: String? = nil,
        windowSize: Int? = nil
    ) async throws -> ThreadResumeResponsePayload {
        try await sendRequest(
            type: "thread_resume_req",
            payload: ThreadResumeRequestPayload(
                threadId: threadId,
                beforeItemId: beforeItemId,
                windowSize: windowSize
            ),
            responseType: "thread_resume_res",
            extraMetadata: threadResumeRequestMetadata(
                threadId: threadId,
                beforeItemId: beforeItemId,
                windowSize: windowSize
            )
        )
    }

    func requestThreadCreate(cwd: String? = nil) async throws -> ThreadCreateResponsePayload {
        try await sendRequest(
            type: "thread_create_req",
            payload: ThreadCreateRequestPayload(cwd: cwd),
            responseType: "thread_create_res",
            idempotencyKey: UUID().uuidString
        )
    }

    func requestThreadArchive(threadId: String) async throws -> ThreadArchiveResponsePayload {
        try await sendRequest(
            type: "thread_archive_req",
            payload: ThreadArchiveRequestPayload(threadId: threadId),
            responseType: "thread_archive_res",
            idempotencyKey: UUID().uuidString
        )
    }

    func takeoverCurrentBindingControl() async throws {
        try await performControlTakeover(trigger: "manual_takeover", force: true)
    }

    func startTurn(
        threadId: String,
        inputs: [TurnInputItem],
        handlers: TurnEventHandlers
    ) async throws -> TurnCompletedPayload {
        try await ensureConnected()

        guard let task = webSocketTask else {
            throw RelayConnectionError.notConnected
        }

        let requestId = UUID().uuidString
        DiagnosticsLogger.info(
            "RelayConnection",
            "turn_start_send",
            metadata: diagnosticsMetadata([
                "threadId": threadId,
                "requestId": requestId,
                "inputCount": String(inputs.count)
            ])
        )
        let envelope = Envelope(
            id: requestId,
            type: "turn_start_req",
            bindingId: try requireBindingId(),
            createdAt: Int(Date().timeIntervalSince1970),
            requiresAck: true,
            protocolVersion: 1,
            idempotencyKey: UUID().uuidString,
            traceId: nil,
            payload: TurnStartRequestPayload(threadId: threadId, inputs: inputs)
        )

        let requestData = try JSONEncoder().encode(envelope)

        return try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<TurnCompletedPayload, Error>) in
            pendingTurns[requestId] = PendingTurnContext(
                requestId: requestId,
                threadId: threadId,
                handlers: TurnEventHandlers(
                    onStatus: handlers.onStatus,
                    onDelta: handlers.onDelta,
                    onCommandOutput: handlers.onCommandOutput,
                    onApprovalRequested: handlers.onApprovalRequested,
                    completion: { result in
                        continuation.resume(with: result)
                    }
                )
            )

            Task {
                do {
                    try await task.send(.data(requestData))
                } catch {
                    DiagnosticsLogger.warning(
                        "RelayConnection",
                        "turn_start_send_failed",
                        metadata: self.diagnosticsMetadata([
                            "threadId": threadId,
                            "requestId": requestId,
                            "error": error.localizedDescription
                        ])
                    )
                    let pendingTurn = self.pendingTurns.removeValue(forKey: requestId)
                    pendingTurn?.handlers.completion(.failure(error))
                }
            }
        }
    }

    func interruptTurn(threadId: String, turnId: String) async throws -> TurnInterruptedPayload {
        try await sendRequest(
            type: "turn_interrupt_req",
            payload: TurnInterruptRequestPayload(threadId: threadId, turnId: turnId),
            responseType: "turn_interrupted",
            idempotencyKey: UUID().uuidString
        )
    }

    var canWriteToAgent: Bool {
        if requiresRePairing {
            return false
        }

        if needsSessionRecovery {
            return false
        }

        guard case .connected = state else {
            return false
        }

        guard currentAgentStatus == .online else {
            return false
        }

        guard supportsControlTakeover else {
            return true
        }

        guard let bindingId else {
            return false
        }

        if isAcquiringCurrentBindingControl && controlRequestBindingId == bindingId {
            return false
        }

        if revokedBindingId == bindingId {
            return false
        }

        return controlledBindingId == bindingId
    }

    var writeUnavailableMessage: String {
        if requiresRePairing {
            return RelayConnectionError.rePairingRequired.localizedDescription
        }

        if needsSessionRecovery {
            return RelayConnectionError.sessionRecoveryRequired.localizedDescription
        }

        if let bindingId, supportsControlTakeover {
            if isAcquiringCurrentBindingControl && controlRequestBindingId == bindingId {
                return NSLocalizedString("relay.acquiringControl", comment: "")
            }

            if revokedBindingId == bindingId {
                return currentControlRevokedMessage ?? NSLocalizedString("relay.controlRevoked", comment: "")
            }
        }

        switch state {
        case .disconnected:
            return NSLocalizedString("relay.disconnected", comment: "")
        case .connecting:
            return NSLocalizedString("relay.connecting", comment: "")
        case .failed(let message):
            return String(format: NSLocalizedString("relay.failedDetail", comment: ""), message)
        case .connected:
            switch currentAgentStatus {
            case .online:
                if supportsControlTakeover, let bindingId, controlledBindingId != bindingId {
                    return NSLocalizedString("relay.notControlled", comment: "")
                }
                return NSLocalizedString("relay.macOnline", comment: "")
            case .offline:
                return NSLocalizedString("relay.macOffline", comment: "")
            case .degraded:
                switch currentAgentDegradedReason {
                case .runtimeUnavailable:
                    return NSLocalizedString(
                        isMissingCodexRuntimeDetail ? "relay.codexMissing" : "relay.runtimeUnavailable",
                        comment: ""
                    )
                case .requestFailures:
                    return NSLocalizedString("relay.requestFailures", comment: "")
                case nil:
                    return NSLocalizedString("relay.statusError", comment: "")
                }
            case .unknown:
                return String(localized: "relay.syncing")
            }
        }
    }

    func resolveApproval(
        approvalId: String,
        threadId: String,
        turnId: String,
        decision: ApprovalDecision
    ) async throws -> ApprovalResolvedPayload {
        try await sendRequest(
            type: "approval_resolve_req",
            payload: ApprovalResolveRequestPayload(
                approvalId: approvalId,
                threadId: threadId,
                turnId: turnId,
                decision: decision
            ),
            responseType: "approval_resolved",
            idempotencyKey: UUID().uuidString
        )
    }

    func isTrackingTurn(threadId: String, turnId: String?) -> Bool {
        for context in pendingTurns.values where context.threadId == threadId {
            if let turnId {
                if context.turnId == nil || context.turnId == turnId {
                    return true
                }
            } else {
                return true
            }
        }

        return false
    }

    private func authenticate(using task: URLSessionWebSocketTask) async {
        do {
            authAttemptStartedAt = Date()
            DiagnosticsLogger.info("RelayConnection", "auth_send_start", metadata: diagnosticsMetadata())
            let authEnvelope = Envelope(
                id: UUID().uuidString,
                type: "auth",
                bindingId: nil as String?,
                createdAt: Int(Date().timeIntervalSince1970),
                requiresAck: false,
                protocolVersion: 1,
                idempotencyKey: nil,
                traceId: nil,
                payload: try makeAuthPayload()
            )

            let data = try JSONEncoder().encode(authEnvelope)
            try await task.send(.data(data))

            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                pendingAuth = continuation
            }

            if case .connecting = state {
                state = .connected
            }
            DiagnosticsLogger.info(
                "RelayConnection",
                "auth_completed",
                metadata: diagnosticsMetadata([
                    "supportedFeatures": supportedFeatures.sorted().joined(separator: ","),
                    "durationMs": authAttemptStartedAt.map(DiagnosticsLogger.durationMilliseconds(since:))
                ])
            )
            authAttemptStartedAt = nil
        } catch {
            DiagnosticsLogger.warning(
                "RelayConnection",
                "auth_failed",
                metadata: diagnosticsMetadata([
                    "error": error.localizedDescription,
                    "durationMs": authAttemptStartedAt.map(DiagnosticsLogger.durationMilliseconds(since:))
                ])
            )
            authAttemptStartedAt = nil
            handleConnectionFailure(error)
        }
    }

    private func makeAuthPayload() throws -> AuthPayload {
        guard let deviceId, let deviceToken else {
            throw RelayConnectionError.notConfigured
        }

        return AuthPayload(
            deviceType: "mobile",
            deviceId: deviceId,
            deviceToken: deviceToken,
            clientVersion: "ios/0.1.0",
            lastCursor: nil
        )
    }

    private func ensureConnected() async throws {
        if isCurrentCredentialBlocked {
            throw RelayConnectionError.rePairingRequired
        }

        if needsSessionRecovery {
            throw RelayConnectionError.sessionRecoveryRequired
        }

        if webSocketTask == nil {
            connect()
        }

        switch state {
        case .connected:
            return
        case .connecting:
            try await Task.sleep(for: .milliseconds(150))
            try await ensureConnected()
        case .failed(let message):
            if isCurrentCredentialBlocked {
                throw RelayConnectionError.rePairingRequired
            }
            throw RelayConnectionError.server(message)
        case .disconnected:
            throw RelayConnectionError.notConnected
        }
    }

    private func requireBindingId() throws -> String {
        guard let bindingId else {
            throw RelayConnectionError.bindingUnavailable
        }

        return bindingId
    }

    private func sendRequest<RequestPayload: Codable, ResponsePayload: Codable>(
        type: String,
        payload: RequestPayload,
        responseType: String,
        idempotencyKey: String? = nil,
        extraMetadata: [String: String?] = [:]
    ) async throws -> ResponsePayload {
        try await ensureConnected()

        guard let task = webSocketTask else {
            throw RelayConnectionError.notConnected
        }

        let requestId = UUID().uuidString
        DiagnosticsLogger.debug(
            "RelayConnection",
            "send_request_start",
            metadata: diagnosticsMetadata([
                "type": type,
                "responseType": responseType,
                "requestId": requestId,
                "idempotencyKeyPresent": idempotencyKey == nil ? "false" : "true"
            ].merging(extraMetadata) { _, new in new })
        )
        let envelope = Envelope(
            id: requestId,
            type: type,
            bindingId: try requireBindingId(),
            createdAt: Int(Date().timeIntervalSince1970),
            requiresAck: true,
            protocolVersion: 1,
            idempotencyKey: idempotencyKey,
            traceId: nil,
            payload: payload
        )

        let requestData = try JSONEncoder().encode(envelope)

        let responseData = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Data, Error>) in
            pendingRequests[requestId] = { result in
                continuation.resume(with: result)
            }

            Task {
                do {
                    try await task.send(.data(requestData))
                } catch {
                    DiagnosticsLogger.warning(
                        "RelayConnection",
                        "send_request_transport_failed",
                        metadata: self.diagnosticsMetadata([
                            "type": type,
                            "requestId": requestId,
                            "error": error.localizedDescription
                        ].merging(extraMetadata) { _, new in new })
                    )
                    let callback = self.pendingRequests.removeValue(forKey: requestId)
                    callback?(.failure(error))
                }
            }
        }

        let decodedEnvelope = try JSONDecoder().decode(Envelope<ResponsePayload>.self, from: responseData)
        guard decodedEnvelope.type == responseType else {
            throw RelayConnectionError.unexpectedResponseType(decodedEnvelope.type)
        }

        DiagnosticsLogger.debug(
            "RelayConnection",
            "send_request_success",
            metadata: diagnosticsMetadata([
                "type": type,
                "responseType": responseType,
                "requestId": requestId
            ].merging(extraMetadata) { _, new in new })
        )

        return decodedEnvelope.payload
    }

    private func receiveLoop(using task: URLSessionWebSocketTask) async {
        while !Task.isCancelled {
            do {
                let message = try await task.receive()

                switch message {
                case .data(let data):
                    lastMessageText = String(data: data, encoding: .utf8)
                    handleIncomingData(data)
                case .string(let text):
                    lastMessageText = text
                    if let data = text.data(using: .utf8) {
                        handleIncomingData(data)
                    }
                @unknown default:
                    break
                }
            } catch {
                if Task.isCancelled {
                    return
                }

                handleConnectionFailure(error)
                return
            }
        }
    }

    private func cleanupConnection() {
        DiagnosticsLogger.info(
            "RelayConnection",
            "cleanup_connection",
            metadata: diagnosticsMetadata([
                "pendingRequestCount": String(pendingRequests.count),
                "pendingTurnCount": String(pendingTurns.count)
            ])
        )
        heartbeatManager.stop()
        cancelPresenceSync()
        resetCurrentBindingControlState()
        let task = webSocketTask
        let callbacks = pendingRequests.values
        pendingRequests.removeAll()
        for callback in callbacks {
            callback(.failure(RelayConnectionError.connectionClosed))
        }

        let turnCallbacks = pendingTurns.values
        pendingTurns.removeAll()
        for pendingTurn in turnCallbacks {
            pendingTurn.handlers.completion(.failure(RelayConnectionError.connectionClosed))
        }

        pendingAuth?.resume(throwing: RelayConnectionError.connectionClosed)
        pendingAuth = nil
        authAttemptStartedAt = nil
        receiveTask?.cancel()
        receiveTask = nil
        webSocketTask = nil
        supportedFeatures = []
        task?.cancel(with: .goingAway, reason: nil)
        resetAgentPresence()
    }

    private func handleIncomingData(_ data: Data) {
        let decoder = JSONDecoder()

        guard let header = try? decoder.decode(EnvelopeHeader.self, from: data) else {
            return
        }

        if header.type == "auth_ok",
           let authEnvelope = try? decoder.decode(Envelope<AuthOkPayload>.self, from: data) {
            supportedFeatures = Set(authEnvelope.payload.features)
            cancelReconnect(resetAttempt: true)
            sessionRecoveryFailureCount = 0
            pendingAuth?.resume()
            pendingAuth = nil
            state = .connected
            startHeartbeat()
            schedulePresenceSync(force: true)
            scheduleControlTakeover(trigger: "auth_ok")
            DiagnosticsLogger.info(
                "RelayConnection",
                "auth_ok_received",
                metadata: diagnosticsMetadata([
                    "features": authEnvelope.payload.features.joined(separator: ","),
                    "serverVersion": authEnvelope.payload.serverVersion,
                    "durationMs": authAttemptStartedAt.map(DiagnosticsLogger.durationMilliseconds(since:))
                ])
            )
            return
        }

        if header.type == "control_revoked",
           let envelope = try? decoder.decode(Envelope<ControlRevokedPayload>.self, from: data) {
            DiagnosticsLogger.warning(
                "RelayConnection",
                "control_revoked_received",
                metadata: diagnosticsMetadata([
                    "agentId": envelope.payload.agentId,
                    "bindingId": envelope.bindingId,
                    "takenByDeviceId": envelope.payload.takenByDeviceId,
                    "message": envelope.payload.message
                ])
            )
            if envelope.bindingId == bindingId {
                markControlRevoked(message: envelope.payload.message)
            }
            return
        }

        if header.type == "pong" {
            heartbeatManager.receivedPong()
            return
        }

        if header.type == "thread_resume_res" {
            let pendingMatched = pendingRequests[header.id] != nil
            let envelope = try? decoder.decode(Envelope<ThreadResumeResponsePayload>.self, from: data)
            DiagnosticsLogger.info(
                "RelayConnection",
                "thread_resume_response_envelope_received",
                metadata: diagnosticsMetadata([
                    "requestId": header.id,
                    "rawLength": String(data.count),
                    "pendingMatched": pendingMatched ? "true" : "false"
                ].merging(threadResumeResponseMetadata(envelope?.payload)) { _, new in new })
            )
        }

        if header.type == "error",
           let errorEnvelope = try? decoder.decode(Envelope<ErrorPayload>.self, from: data) {
            DiagnosticsLogger.warning(
                "RelayConnection",
                "relay_error_received",
                metadata: diagnosticsMetadata([
                    "requestId": errorEnvelope.id,
                    "code": errorEnvelope.payload.code.rawValue,
                    "message": errorEnvelope.payload.message
                ])
            )
            if let pendingAuth {
                self.pendingAuth = nil
                pendingAuth.resume(throwing: relayError(for: errorEnvelope.payload))
                return
            }

            if let callback = pendingRequests.removeValue(forKey: errorEnvelope.id) {
                let error = relayError(for: errorEnvelope.payload)
                callback(.failure(error))
                handleCredentialStateTransition(for: error)
                return
            }

            if let pendingTurn = pendingTurns.removeValue(forKey: errorEnvelope.id) {
                let error = relayError(for: errorEnvelope.payload)
                pendingTurn.handlers.completion(.failure(error))
                handleCredentialStateTransition(for: error)
                return
            }
        }

        if header.type == "token_revoked",
           let envelope = try? decoder.decode(Envelope<TokenRevokedPayload>.self, from: data) {
            DiagnosticsLogger.warning(
                "RelayConnection",
                "token_revoked_received",
                metadata: diagnosticsMetadata([
                    "code": envelope.payload.code.rawValue,
                    "message": envelope.payload.message
                ])
            )
            let authError = markSessionRecoveryNeededError(message: envelope.payload.message)
            handleConnectionFailure(authError)
            return
        }

        if header.type == "turn_status",
           let envelope = try? decoder.decode(Envelope<TurnStatusPayload>.self, from: data),
           let pendingTurn = pendingTurns[envelope.payload.requestId] {
            if let turnId = envelope.payload.turnId {
                pendingTurn.turnId = turnId
            }
            DiagnosticsLogger.debug(
                "RelayConnection",
                "turn_status_received",
                metadata: diagnosticsMetadata([
                    "requestId": envelope.payload.requestId,
                    "threadId": envelope.payload.threadId,
                    "turnId": envelope.payload.turnId,
                    "status": envelope.payload.status.rawValue,
                    "itemId": envelope.payload.itemId,
                    "detail": envelope.payload.detail
                ])
            )
            pendingTurn.handlers.onStatus(envelope.payload)
            return
        }

        if header.type == "turn_delta",
           let envelope = try? decoder.decode(Envelope<TurnDeltaPayload>.self, from: data),
           let pendingTurn = pendingTurns[envelope.payload.requestId] {
            pendingTurn.turnId = envelope.payload.turnId
            pendingTurn.handlers.onDelta(envelope.payload)
            return
        }

        if header.type == "command_output_delta",
           let envelope = try? decoder.decode(Envelope<CommandOutputDeltaPayload>.self, from: data),
           let pendingTurn = pendingTurns[envelope.payload.requestId] {
            pendingTurn.turnId = envelope.payload.turnId
            pendingTurn.handlers.onCommandOutput(envelope.payload)
            return
        }

        if header.type == "approval_requested",
           let envelope = try? decoder.decode(Envelope<ApprovalRequestedPayload>.self, from: data),
           let pendingTurn = pendingTurns[envelope.payload.requestId] {
            pendingTurn.turnId = envelope.payload.turnId
            pendingTurn.handlers.onApprovalRequested(envelope.payload)
            return
        }

        if header.type == "turn_completed",
           let envelope = try? decoder.decode(Envelope<TurnCompletedPayload>.self, from: data),
           let pendingTurn = pendingTurns.removeValue(forKey: envelope.payload.requestId) {
            DiagnosticsLogger.info(
                "RelayConnection",
                "turn_completed_received",
                metadata: diagnosticsMetadata([
                    "requestId": envelope.payload.requestId,
                    "threadId": pendingTurn.threadId,
                    "turnId": envelope.payload.turnId,
                    "status": envelope.payload.status
                ])
            )
            pendingTurn.handlers.completion(.success(envelope.payload))
            return
        }

        if header.type == "turn_interrupted",
           let envelope = try? decoder.decode(Envelope<TurnInterruptedPayload>.self, from: data) {
            completePendingTurnForInterruption(envelope.payload)

            if let callback = pendingRequests.removeValue(forKey: envelope.id) {
                callback(.success(data))
            }
            return
        }

        if header.type == "agent_presence",
           let presenceEnvelope = try? decoder.decode(Envelope<AgentPresencePayload>.self, from: data) {
            if presenceEnvelope.bindingId == bindingId {
                applyAgentPresence(
                    status: presenceEnvelope.payload.status,
                    reason: presenceEnvelope.payload.reason,
                    detail: presenceEnvelope.payload.detail
                )
                DiagnosticsLogger.info(
                    "RelayConnection",
                    "agent_presence_received",
                    metadata: diagnosticsMetadata([
                        "agentId": presenceEnvelope.payload.agentId,
                        "status": presenceEnvelope.payload.status.rawValue,
                        "reason": presenceEnvelope.payload.reason?.rawValue,
                        "detail": presenceEnvelope.payload.detail
                    ])
                )
                if presenceEnvelope.payload.status == .offline {
                    schedulePresenceSync(delay: 1.5)
                }
            }
            return
        }

        if header.type == "presence_sync_res",
           let syncEnvelope = try? decoder.decode(Envelope<PresenceSyncResponsePayload>.self, from: data) {
            if syncEnvelope.bindingId == bindingId {
                applyAgentPresence(
                    status: syncEnvelope.payload.status,
                    reason: syncEnvelope.payload.reason,
                    detail: syncEnvelope.payload.detail
                )
                DiagnosticsLogger.info(
                    "RelayConnection",
                    "presence_sync_response_received",
                    metadata: diagnosticsMetadata([
                        "agentId": syncEnvelope.payload.agentId,
                        "status": syncEnvelope.payload.status.rawValue,
                        "reason": syncEnvelope.payload.reason?.rawValue,
                        "detail": syncEnvelope.payload.detail,
                        "updatedAt": String(syncEnvelope.payload.updatedAt)
                    ])
                )
            }

            if let callback = pendingRequests.removeValue(forKey: syncEnvelope.id) {
                callback(.success(data))
            }
            return
        }

        guard let callback = pendingRequests.removeValue(forKey: header.id) else {
            return
        }

        callback(.success(data))
    }

    private func threadResumeRequestMetadata(
        threadId: String,
        beforeItemId: String?,
        windowSize: Int?
    ) -> [String: String?] {
        [
            "threadId": threadId,
            "beforeItemId": beforeItemId,
            "windowSize": windowSize.map(String.init)
        ]
    }

    private func threadResumeResponseMetadata(
        _ payload: ThreadResumeResponsePayload?
    ) -> [String: String?] {
        let timelineItems = payload?.timelineItems ?? []
        let messages = payload?.messages ?? []
        return [
            "threadId": payload?.threadId,
            "messageCount": String(messages.count),
            "timelineItemCount": String(timelineItems.count),
            "hasMoreBefore": payload?.hasMoreBefore.map { String($0) },
            "responseWindowKind": timelineItems.isEmpty ? "messages" : "timeline",
            "firstMessageId": messages.first?.id,
            "lastMessageId": messages.last?.id,
            "firstTimelineItemId": timelineItems.first?.id,
            "lastTimelineItemId": timelineItems.last?.id
        ]
    }

    private static func makeRelayWebSocketURL(from relayBaseURL: String) -> URL {
        let url = URL(string: relayBaseURL)!
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        components.scheme = components.scheme == "https" ? "wss" : "ws"
        components.path = "/v1/connect"
        return components.url!
    }

    private static func credentialFingerprint(deviceId: String, deviceToken: String) -> String {
        "\(deviceId)|\(deviceToken)"
    }

    private var currentCredentialFingerprint: String? {
        guard let deviceId, let deviceToken else {
            return nil
        }

        return Self.credentialFingerprint(deviceId: deviceId, deviceToken: deviceToken)
    }

    private var isCurrentCredentialBlocked: Bool {
        guard let blockedCredentialFingerprint, let currentCredentialFingerprint else {
            return false
        }

        return blockedCredentialFingerprint == currentCredentialFingerprint
    }

    private func markAuthFailure() -> RelayConnectionError {
        blockedCredentialFingerprint = currentCredentialFingerprint
        requiresRePairing = true
        needsSessionRecovery = false
        state = .failed(RelayConnectionError.rePairingRequired.localizedDescription)
        resetAgentPresence()
        DiagnosticsLogger.warning("RelayConnection", "mark_auth_failure", metadata: diagnosticsMetadata())
        return .rePairingRequired
    }

    private func markSessionRecoveryNeededError(message: String) -> RelayConnectionError {
        markSessionRecoveryNeeded(message: message)
        return .sessionRecoveryRequired
    }

    private func markAgentOffline(detail: String) {
        applyAgentPresence(
            status: .offline,
            reason: nil,
            detail: detail
        )
        DiagnosticsLogger.warning(
            "RelayConnection",
            "mark_agent_offline",
            metadata: diagnosticsMetadata([
                "detail": detail
            ])
        )
        schedulePresenceSync(force: true, delay: 1.5)
    }

    private func relayError(for payload: ErrorPayload) -> RelayConnectionError {
        switch payload.code {
        case .authFailed:
            return markAuthFailure()
        case .agentOffline:
            markAgentOffline(detail: payload.message)
            return .server(payload.message)
        case .controlNotHeld:
            markControlRevoked(message: payload.message)
            return .server(payload.message)
        case .tokenExpired, .tokenRevoked:
            return markSessionRecoveryNeededError(message: payload.message)
        default:
            return .server(payload.message)
        }
    }

    private func handleCredentialStateTransition(for error: RelayConnectionError) {
        switch error {
        case .sessionRecoveryRequired, .rePairingRequired:
            handleConnectionFailure(error)
        default:
            break
        }
    }

    private func resetAgentPresence() {
        currentAgentStatus = .unknown
        currentAgentDegradedReason = nil
        currentAgentDegradedDetail = nil
    }

    private var supportsControlTakeover: Bool {
        supportedFeatures.contains("control_takeover")
    }

    var isCurrentBindingControlRevoked: Bool {
        guard let bindingId, supportsControlTakeover else {
            return false
        }

        return revokedBindingId == bindingId
    }

    var shouldShowControlTakeoverBanner: Bool {
        guard let bindingId, supportsControlTakeover else {
            return false
        }

        return (isAcquiringCurrentBindingControl && controlRequestBindingId == bindingId) || revokedBindingId == bindingId
    }

    var controlTakeoverBannerText: String {
        if let bindingId, isAcquiringCurrentBindingControl && controlRequestBindingId == bindingId {
            return String(localized: "relay.acquiringControlBanner")
        }

        return currentControlRevokedMessage ?? String(localized: "relay.controlRevokedBanner")
    }

    var canManuallyTakeoverCurrentBinding: Bool {
        guard supportsControlTakeover, bindingId != nil else {
            return false
        }

        return !isAcquiringCurrentBindingControl
    }

    private func resetCurrentBindingControlState() {
        controlTakeoverTask?.cancel()
        controlTakeoverTask = nil
        controlledBindingId = nil
        controlRequestBindingId = nil
        revokedBindingId = nil
        isAcquiringCurrentBindingControl = false
        currentControlRevokedMessage = nil
    }

    private func markControlRevoked(message: String) {
        guard let bindingId else {
            return
        }

        controlTakeoverTask?.cancel()
        controlTakeoverTask = nil
        controlledBindingId = nil
        controlRequestBindingId = nil
        revokedBindingId = bindingId
        isAcquiringCurrentBindingControl = false
        currentControlRevokedMessage = message
        DiagnosticsLogger.warning(
            "RelayConnection",
            "control_revoked_applied",
            metadata: diagnosticsMetadata([
                "bindingId": bindingId,
                "message": message
            ])
        )
    }

    private func scheduleControlTakeover(trigger: String) {
        guard supportsControlTakeover else {
            return
        }

        guard let bindingId else {
            return
        }

        if controlledBindingId == bindingId {
            return
        }

        if isAcquiringCurrentBindingControl && controlRequestBindingId == bindingId {
            return
        }

        controlTakeoverTask?.cancel()
        isAcquiringCurrentBindingControl = true
        controlRequestBindingId = bindingId
        DiagnosticsLogger.info(
            "RelayConnection",
            "control_takeover_scheduled",
            metadata: diagnosticsMetadata([
                "bindingId": bindingId,
                "trigger": trigger
            ])
        )
        controlTakeoverTask = Task { [weak self] in
            do {
                try await self?.performControlTakeover(trigger: trigger, force: false)
            } catch {
                guard let self else { return }
                guard !Task.isCancelled else { return }
                DiagnosticsLogger.warning(
                    "RelayConnection",
                    "control_takeover_schedule_failed",
                    metadata: self.diagnosticsMetadata([
                        "bindingId": bindingId,
                        "trigger": trigger,
                        "error": error.localizedDescription
                    ])
                )
            }
        }
    }

    private func performControlTakeover(trigger: String, force: Bool) async throws {
        guard supportsControlTakeover else {
            return
        }

        guard let bindingId else {
            return
        }

        if !force, controlledBindingId == bindingId {
            isAcquiringCurrentBindingControl = false
            controlRequestBindingId = nil
            return
        }

        isAcquiringCurrentBindingControl = true
        controlRequestBindingId = bindingId
        DiagnosticsLogger.info(
            "RelayConnection",
            "control_takeover_request_start",
            metadata: diagnosticsMetadata([
                "bindingId": bindingId,
                "trigger": trigger
            ])
        )

        do {
            let payload: ControlTakeoverResponsePayload = try await sendRequest(
                type: "control_takeover_req",
                payload: ControlTakeoverRequestPayload(),
                responseType: "control_takeover_res"
            )

            guard self.bindingId == bindingId else {
                return
            }

            controlledBindingId = bindingId
            revokedBindingId = nil
            currentControlRevokedMessage = nil
            isAcquiringCurrentBindingControl = false
            controlRequestBindingId = nil
            controlTakeoverTask = nil
            DiagnosticsLogger.info(
                "RelayConnection",
                "control_takeover_request_success",
                metadata: diagnosticsMetadata([
                    "bindingId": bindingId,
                    "trigger": trigger,
                    "agentId": payload.agentId,
                    "controllerDeviceId": payload.controllerDeviceId
                ])
            )
        } catch {
            if self.bindingId == bindingId {
                isAcquiringCurrentBindingControl = false
                controlRequestBindingId = nil
            }
            controlTakeoverTask = nil
            throw error
        }
    }

    private func applyAgentPresence(
        status: AgentPresenceStatus,
        reason: AgentDegradedReason?,
        detail: String?
    ) {
        currentAgentStatus = mapAgentStatus(status)
        currentAgentDegradedReason = reason
        currentAgentDegradedDetail = detail
        DiagnosticsLogger.info(
            "RelayConnection",
            "apply_agent_presence",
            metadata: diagnosticsMetadata([
                "status": status.rawValue,
                "reason": reason?.rawValue,
                "detail": detail
            ])
        )
    }

    private func mapAgentStatus(_ status: AgentPresenceStatus) -> AgentStatus {
        switch status {
        case .online:
            return .online
        case .offline:
            return .offline
        case .degraded:
            return .degraded
        }
    }

    private func startHeartbeat() {
        heartbeatManager.start(
            sendPing: { [weak self] in
                Task { @MainActor [weak self] in
                    self?.sendPing()
                }
            },
            onTimeout: { [weak self] in
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    self.handleConnectionFailure(
                        RelayConnectionError.server(String(localized: "relay.heartbeatTimeout"))
                    )
                }
            }
        )
    }

    private func requestPresenceSync() async throws -> PresenceSyncResponsePayload {
        DiagnosticsLogger.debug("RelayConnection", "presence_sync_request_start", metadata: diagnosticsMetadata())
        return try await sendRequest(
            type: "presence_sync_req",
            payload: PresenceSyncRequestPayload(),
            responseType: "presence_sync_res"
        )
    }

    private func schedulePresenceSync(force: Bool = false, delay: TimeInterval = 0) {
        guard supportedFeatures.contains("presence_sync") else {
            DiagnosticsLogger.debug("RelayConnection", "presence_sync_skipped_feature_unsupported", metadata: diagnosticsMetadata())
            return
        }

        guard case .connected = state else {
            DiagnosticsLogger.debug("RelayConnection", "presence_sync_skipped_not_connected", metadata: diagnosticsMetadata())
            return
        }

        guard !requiresRePairing, !needsSessionRecovery else {
            return
        }

        if !force {
            if presenceSyncTask != nil {
                DiagnosticsLogger.debug("RelayConnection", "presence_sync_skipped_existing_task", metadata: diagnosticsMetadata())
                return
            }

            if let lastPresenceSyncAt,
               Date().timeIntervalSince(lastPresenceSyncAt) < 3 {
                DiagnosticsLogger.debug("RelayConnection", "presence_sync_skipped_recent_sync", metadata: diagnosticsMetadata())
                return
            }
        }

        DiagnosticsLogger.info(
            "RelayConnection",
            "presence_sync_scheduled",
            metadata: diagnosticsMetadata([
                "force": force ? "true" : "false",
                "delaySeconds": String(delay)
            ])
        )
        presenceSyncTask?.cancel()
        presenceSyncTask = Task { @MainActor [weak self] in
            guard let self else { return }

            if delay > 0 {
                let delayNs = UInt64(delay * 1_000_000_000)
                do {
                    try await Task.sleep(nanoseconds: delayNs)
                } catch {
                    self.presenceSyncTask = nil
                    return
                }
            }

            guard self.supportedFeatures.contains("presence_sync"),
                  case .connected = self.state,
                  !self.requiresRePairing,
                  !self.needsSessionRecovery else {
                self.presenceSyncTask = nil
                return
            }

            self.lastPresenceSyncAt = Date()

            do {
                let payload = try await self.requestPresenceSync()
                self.applyAgentPresence(
                    status: payload.status,
                    reason: payload.reason,
                    detail: payload.detail
                )
            } catch {
                DiagnosticsLogger.warning(
                    "RelayConnection",
                    "presence_sync_failed",
                    metadata: self.diagnosticsMetadata([
                        "error": error.localizedDescription
                    ])
                )
                // 主动同步失败时保留现有连接状态，交给既有重连/错误流处理。
            }

            self.presenceSyncTask = nil
        }
    }

    private func cancelPresenceSync() {
        presenceSyncTask?.cancel()
        presenceSyncTask = nil
        lastPresenceSyncAt = nil
    }

    private func handleConnectionFailure(_ error: Error) {
        if let relayError = error as? RelayConnectionError,
           case .sessionRecoveryRequired = relayError {
            sessionRecoveryFailureCount += 1
        } else {
            sessionRecoveryFailureCount = 0
        }

        DiagnosticsLogger.warning(
            "RelayConnection",
            "connection_failure",
            metadata: diagnosticsMetadata([
                "error": error.localizedDescription,
                "shouldMaintainConnection": shouldMaintainConnection ? "true" : "false",
                "sessionRecoveryFailureCount": String(sessionRecoveryFailureCount)
            ])
        )
        if !requiresRePairing && !needsSessionRecovery {
            state = .failed(error.localizedDescription)
        }
        cleanupConnection()

        let nextReconnectAttempt = reconnectAttempt + 1
        if shouldMaintainConnection,
           !requiresRePairing,
           !needsSessionRecovery,
           shouldEscalateToRePairing(nextReconnectAttempt: nextReconnectAttempt) {
            DiagnosticsLogger.warning(
                "RelayConnection",
                "connection_failure_escalated_to_repairing",
                metadata: diagnosticsMetadata([
                    "attempt": String(nextReconnectAttempt),
                    "error": error.localizedDescription,
                    "sessionRecoveryFailureCount": String(sessionRecoveryFailureCount)
                ])
            )
            markRePairingRequired()
            return
        }

        guard shouldMaintainConnection, !requiresRePairing, !needsSessionRecovery else {
            return
        }

        scheduleReconnect(after: error.localizedDescription)
    }

    private func shouldEscalateToRePairing(nextReconnectAttempt: Int) -> Bool {
        if sessionRecoveryFailureCount >= Self.sessionRecoveryRePairingThreshold {
            return true
        }

        return false
    }

    private func scheduleReconnect(after message: String) {
        guard relayURL != nil, webSocketTask == nil, reconnectTask == nil else {
            DiagnosticsLogger.debug("RelayConnection", "reconnect_skipped", metadata: diagnosticsMetadata())
            return
        }

        reconnectAttempt += 1
        let delay = reconnectPolicy.delay(forAttempt: reconnectAttempt)
        let roundedDelay = Int(delay.rounded())
        state = .failed(String(format: String(localized: "relay.reconnectDelay"), message, roundedDelay))
        DiagnosticsLogger.warning(
            "RelayConnection",
            "reconnect_scheduled",
            metadata: diagnosticsMetadata([
                "attempt": String(reconnectAttempt),
                "delaySeconds": String(roundedDelay),
                "message": message
            ])
        )

        reconnectTask = Task { [weak self] in
            let delayNs = UInt64(delay * 1_000_000_000)
            do {
                try await Task.sleep(nanoseconds: delayNs)
            } catch {
                return
            }

            await MainActor.run {
                guard let self else { return }
                self.reconnectTask = nil

                guard self.shouldMaintainConnection, !self.requiresRePairing else {
                    return
                }

                DiagnosticsLogger.info(
                    "RelayConnection",
                    "reconnect_attempt_start",
                    metadata: self.diagnosticsMetadata([
                        "attempt": String(self.reconnectAttempt)
                    ])
                )
                self.connectIfNeeded()
            }
        }
    }

    private func cancelReconnect(resetAttempt: Bool) {
        reconnectTask?.cancel()
        reconnectTask = nil
        if resetAttempt {
            reconnectAttempt = 0
        }
    }

    private func sendPing() {
        guard let task = webSocketTask else { return }
        let envelope = Envelope(
            id: UUID().uuidString,
            type: "ping",
            bindingId: nil as String?,
            createdAt: Int(Date().timeIntervalSince1970),
            requiresAck: false,
            protocolVersion: 1,
            idempotencyKey: nil,
            traceId: nil,
            payload: PingPayload(ts: Int(Date().timeIntervalSince1970))
        )
        guard let data = try? JSONEncoder().encode(envelope) else { return }
        Task {
            try? await task.send(.data(data))
        }
    }

    private func completePendingTurnForInterruption(_ payload: TurnInterruptedPayload) {
        guard let pendingEntry = pendingTurns.first(where: { _, context in
            if let turnId = context.turnId {
                return turnId == payload.turnId
            }

            return context.threadId == payload.threadId
        }) else {
            return
        }

        let pendingTurn = pendingEntry.value
        pendingTurn.turnId = payload.turnId
        pendingTurn.handlers.onStatus(
            TurnStatusPayload(
                requestId: pendingTurn.requestId,
                threadId: payload.threadId,
                turnId: payload.turnId,
                status: .interrupted,
                detail: String(localized: "relay.executionStopped"),
                itemId: nil
            )
        )

        pendingTurns.removeValue(forKey: pendingEntry.key)
        pendingTurn.handlers.completion(
            .success(
                TurnCompletedPayload(
                    requestId: pendingTurn.requestId,
                    threadId: payload.threadId,
                    turnId: payload.turnId,
                    status: "interrupted",
                    text: "",
                    segments: nil,
                    errorMessage: nil
                )
            )
        )
    }
}

enum RelayConnectionError: LocalizedError {
    case notConnected
    case notConfigured
    case bindingUnavailable
    case connectionClosed
    case unexpectedResponseType(String)
    case rePairingRequired
    case sessionRecoveryRequired
    case server(String)

    var errorDescription: String? {
        switch self {
        case .notConnected:
            return String(localized: "relayError.notConnected")
        case .notConfigured:
            return String(localized: "relayError.notConfigured")
        case .bindingUnavailable:
            return String(localized: "relayError.bindingUnavailable")
        case .connectionClosed:
            return String(localized: "relayError.connectionClosed")
        case .unexpectedResponseType(let type):
            return String(format: String(localized: "relayError.unexpectedResponse"), type)
        case .rePairingRequired:
            return String(localized: "relayError.rePairingRequired")
        case .sessionRecoveryRequired:
            return String(localized: "relayError.sessionRecovery")
        case .server(let message):
            return message
        }
    }
}
