import Foundation

struct PairingPayload: Codable {
    let v: Int
    let relayUrl: String
    let pairingId: String
    let pairingSecret: String
    let agentLabel: String
    let expiresAt: Int
}

struct MobileBootstrapResponse: Codable {
    struct BindingSummary: Codable {
        let bindingId: String
        let agentId: String
        let displayName: String
        let isDefault: Bool
    }

    let deviceId: String
    let accessToken: String
    let refreshToken: String
    let accessExpiresAt: Int
    let refreshExpiresAt: Int
    let relayUrl: String
    let defaultBindingId: String?
    let bindings: [BindingSummary]
}

struct ClaimPairingResponse: Codable {
    let bindingId: String
    let agentId: String
    let agentLabel: String
    let relayUrl: String
    let bindings: [MobileBootstrapResponse.BindingSummary]
    let defaultBindingId: String?
}

@MainActor
final class PairingService {
    private struct MobileBootstrapRequest: Codable {
        let deviceId: String?
        let deviceName: String
    }

    private struct ClaimPairingRequest: Codable {
        let pairingId: String
        let pairingSecret: String
        let displayName: String
    }

    private let session: URLSession
    private let authService: AuthService

    init(session: URLSession = .shared, authService: AuthService? = nil) {
        self.session = session
        self.authService = authService ?? AuthService(session: session)
    }

    func parsePairingPayload(from rawValue: String) throws -> PairingPayload {
        let data = Data(rawValue.utf8)
        let payload = try JSONDecoder().decode(PairingPayload.self, from: data)
        DiagnosticsLogger.info(
            "PairingService",
            "parse_pairing_payload",
            metadata: DiagnosticsLogger.metadata([
                "pairingId": payload.pairingId,
                "relayUrl": payload.relayUrl,
                "expiresAt": String(payload.expiresAt)
            ])
        )
        return payload
    }

    func claimPairingSession(
        rawPayload: String,
        tokenManager: TokenManager,
        bindingStore: BindingStore,
        expectedRelayBaseURL: String? = nil,
        pairTraceId: String? = nil
    ) async throws -> BindingRecord {
        let sessionStartedAt = Date()
        let pairingPayload = try parsePairingPayload(from: rawPayload)
        DiagnosticsLogger.info(
            "PairingService",
            "claim_pairing_session_start",
            metadata: DiagnosticsLogger.pairTraceMetadata(pairTraceId: pairTraceId, [
                "pairingId": pairingPayload.pairingId,
                "relayUrl": pairingPayload.relayUrl,
                "expectedRelayBaseURL": expectedRelayBaseURL
            ])
        )
        if let expectedRelayBaseURL,
           RelayEnvironmentStore.normalizeRelayBaseURL(expectedRelayBaseURL) != RelayEnvironmentStore.normalizeRelayBaseURL(pairingPayload.relayUrl) {
            throw PairingError.relayEnvironmentMismatch(
                expected: expectedRelayBaseURL,
                actual: pairingPayload.relayUrl
            )
        }

        do {
            let bundle = try await ensureMobileCredentials(
                relayBaseURL: pairingPayload.relayUrl,
                tokenManager: tokenManager,
                pairTraceId: pairTraceId
            )

            let response = try await claimPairing(
                pairingPayload: pairingPayload,
                mobileDeviceId: bundle.deviceId,
                accessToken: bundle.accessToken,
                pairTraceId: pairTraceId
            )

            let bindings = response.bindings.map { summary in
                BindingRecord(
                    id: summary.bindingId,
                    agentId: summary.agentId,
                    agentName: summary.displayName,
                    relayBaseURL: response.relayUrl,
                    isDefault: summary.bindingId == (response.defaultBindingId ?? summary.bindingId)
                )
            }
            bindingStore.replaceBindings(bindings)
            bindingStore.setPreferredBinding(id: response.bindingId)

            guard let claimedBinding = bindingStore.binding(for: response.bindingId) ?? bindingStore.defaultBinding else {
                throw PairingError.bindingUnavailable
            }

            DiagnosticsLogger.info(
                "PairingService",
                "claim_pairing_session_success",
                metadata: DiagnosticsLogger.pairTraceMetadata(pairTraceId: pairTraceId, [
                    "bindingId": claimedBinding.id,
                    "agentId": claimedBinding.agentId,
                    "relayUrl": claimedBinding.relayBaseURL,
                    "durationMs": DiagnosticsLogger.durationMilliseconds(since: sessionStartedAt)
                ])
            )
            return claimedBinding
        } catch {
            DiagnosticsLogger.warning(
                "PairingService",
                "claim_pairing_session_failed",
                metadata: DiagnosticsLogger.pairTraceMetadata(pairTraceId: pairTraceId, [
                    "pairingId": pairingPayload.pairingId,
                    "error": error.localizedDescription,
                    "durationMs": DiagnosticsLogger.durationMilliseconds(since: sessionStartedAt)
                ])
            )
            if let classifiedError = Self.classify(error: error, relayBaseURL: pairingPayload.relayUrl) {
                throw classifiedError
            }

            throw error
        }
    }

    private func bootstrapMobileDevice(
        relayBaseURL: String,
        pairTraceId: String?
    ) async throws -> MobileBootstrapResponse {
        let bootstrapStartedAt = Date()
        DiagnosticsLogger.info(
            "PairingService",
            "bootstrap_mobile_start",
            metadata: DiagnosticsLogger.pairTraceMetadata(pairTraceId: pairTraceId, [
                "relayBaseURL": relayBaseURL
            ])
        )
        var request = URLRequest(url: URL(string: "\(relayBaseURL)/v1/mobile-devices/bootstrap")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(
            MobileBootstrapRequest(
                deviceId: nil,
                deviceName: "KodexLink-iPhone"
            )
        )

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            var metadata = Self.networkErrorMetadata(error)
            metadata["relayBaseURL"] = relayBaseURL
            metadata["durationMs"] = DiagnosticsLogger.durationMilliseconds(since: bootstrapStartedAt)
            DiagnosticsLogger.warning(
                "PairingService",
                "bootstrap_mobile_http_failed",
                metadata: DiagnosticsLogger.pairTraceMetadata(pairTraceId: pairTraceId, metadata)
            )
            throw error
        }
        DiagnosticsLogger.info(
            "PairingService",
            "bootstrap_mobile_http_response_received",
            metadata: DiagnosticsLogger.pairTraceMetadata(pairTraceId: pairTraceId, [
                "relayBaseURL": relayBaseURL,
                "statusCode": (response as? HTTPURLResponse).map { String($0.statusCode) },
                "responseBytes": String(data.count),
                "durationMs": DiagnosticsLogger.durationMilliseconds(since: bootstrapStartedAt)
            ])
        )
        try validateHTTP(response, data: data, expectedStatusCode: 200)
        let decoded = try JSONDecoder().decode(MobileBootstrapResponse.self, from: data)
        DiagnosticsLogger.info(
            "PairingService",
            "bootstrap_mobile_success",
            metadata: DiagnosticsLogger.pairTraceMetadata(pairTraceId: pairTraceId, [
                "relayBaseURL": relayBaseURL,
                "deviceId": decoded.deviceId,
                "bindingCount": String(decoded.bindings.count),
                "durationMs": DiagnosticsLogger.durationMilliseconds(since: bootstrapStartedAt)
            ])
        )
        return decoded
    }

    private func ensureMobileCredentials(
        relayBaseURL: String,
        tokenManager: TokenManager,
        pairTraceId: String?
    ) async throws -> DeviceTokenBundle {
        let nowSeconds = Int(Date().timeIntervalSince1970)
        if let currentBundle = tokenManager.currentBundle() {
            if currentBundle.accessExpiresAt > nowSeconds {
                if !tokenManager.shouldRefresh() {
                    DiagnosticsLogger.info(
                        "PairingService",
                        "reuse_mobile_credentials",
                        metadata: DiagnosticsLogger.pairTraceMetadata(pairTraceId: pairTraceId, [
                            "relayBaseURL": relayBaseURL,
                            "deviceId": currentBundle.deviceId,
                            "accessExpiresAt": String(currentBundle.accessExpiresAt)
                        ])
                    )
                    return currentBundle
                }

                do {
                    let refreshStartedAt = Date()
                    let refreshedBundle = try await authService.refreshSession(
                        relayBaseURL: relayBaseURL,
                        deviceId: currentBundle.deviceId,
                        refreshToken: currentBundle.refreshToken
                    )
                    tokenManager.update(bundle: refreshedBundle)
                    DiagnosticsLogger.info(
                        "PairingService",
                        "refresh_mobile_credentials_success",
                        metadata: DiagnosticsLogger.pairTraceMetadata(pairTraceId: pairTraceId, [
                            "relayBaseURL": relayBaseURL,
                            "deviceId": refreshedBundle.deviceId,
                            "durationMs": DiagnosticsLogger.durationMilliseconds(since: refreshStartedAt)
                        ])
                    )
                    return refreshedBundle
                } catch let authError as AuthServiceError {
                    if !authError.isCredentialRejected {
                        DiagnosticsLogger.warning(
                            "PairingService",
                            "refresh_mobile_credentials_deferred",
                            metadata: DiagnosticsLogger.pairTraceMetadata(pairTraceId: pairTraceId, [
                                "relayBaseURL": relayBaseURL,
                                "deviceId": currentBundle.deviceId,
                                "error": authError.localizedDescription
                            ])
                        )
                        return currentBundle
                    }

                    tokenManager.clear()
                }
            } else if tokenManager.canRefresh() {
                do {
                    let refreshStartedAt = Date()
                    let refreshedBundle = try await authService.refreshSession(
                        relayBaseURL: relayBaseURL,
                        deviceId: currentBundle.deviceId,
                        refreshToken: currentBundle.refreshToken
                    )
                    tokenManager.update(bundle: refreshedBundle)
                    DiagnosticsLogger.info(
                        "PairingService",
                        "refresh_expired_credentials_success",
                        metadata: DiagnosticsLogger.pairTraceMetadata(pairTraceId: pairTraceId, [
                            "relayBaseURL": relayBaseURL,
                            "deviceId": refreshedBundle.deviceId,
                            "durationMs": DiagnosticsLogger.durationMilliseconds(since: refreshStartedAt)
                        ])
                    )
                    return refreshedBundle
                } catch let authError as AuthServiceError {
                    if !authError.isCredentialRejected {
                        DiagnosticsLogger.warning(
                            "PairingService",
                            "refresh_expired_credentials_failed",
                            metadata: DiagnosticsLogger.pairTraceMetadata(pairTraceId: pairTraceId, [
                                "relayBaseURL": relayBaseURL,
                                "deviceId": currentBundle.deviceId,
                                "error": authError.localizedDescription
                            ])
                        )
                        throw PairingError.server(authError.localizedDescription)
                    }

                    tokenManager.clear()
                }
            } else {
                tokenManager.clear()
            }
        }

        let bootstrap = try await bootstrapMobileDevice(
            relayBaseURL: relayBaseURL,
            pairTraceId: pairTraceId
        )
        let bundle = DeviceTokenBundle(
            deviceId: bootstrap.deviceId,
            accessToken: bootstrap.accessToken,
            refreshToken: bootstrap.refreshToken,
            accessExpiresAt: bootstrap.accessExpiresAt,
            refreshExpiresAt: bootstrap.refreshExpiresAt
        )
        tokenManager.update(bundle: bundle)
        return bundle
    }

    private func claimPairing(
        pairingPayload: PairingPayload,
        mobileDeviceId: String,
        accessToken: String,
        pairTraceId: String?
    ) async throws -> ClaimPairingResponse {
        let requestStartedAt = Date()
        DiagnosticsLogger.info(
            "PairingService",
            "claim_pairing_http_start",
            metadata: DiagnosticsLogger.pairTraceMetadata(pairTraceId: pairTraceId, [
                "pairingId": pairingPayload.pairingId,
                "mobileDeviceId": mobileDeviceId,
                "relayUrl": pairingPayload.relayUrl
            ])
        )
        var request = URLRequest(url: URL(string: "\(pairingPayload.relayUrl)/v1/pairings/claim")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(mobileDeviceId, forHTTPHeaderField: "x-device-id")
        request.setValue(accessToken, forHTTPHeaderField: "x-device-token")
        request.httpBody = try JSONEncoder().encode(
            ClaimPairingRequest(
                pairingId: pairingPayload.pairingId,
                pairingSecret: pairingPayload.pairingSecret,
                displayName: pairingPayload.agentLabel
            )
        )

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            var metadata = Self.networkErrorMetadata(error)
            metadata["pairingId"] = pairingPayload.pairingId
            metadata["relayUrl"] = pairingPayload.relayUrl
            metadata["durationMs"] = DiagnosticsLogger.durationMilliseconds(since: requestStartedAt)
            DiagnosticsLogger.warning(
                "PairingService",
                "claim_pairing_http_failed",
                metadata: DiagnosticsLogger.pairTraceMetadata(pairTraceId: pairTraceId, metadata)
            )
            throw error
        }
        DiagnosticsLogger.info(
            "PairingService",
            "claim_pairing_http_response_received",
            metadata: DiagnosticsLogger.pairTraceMetadata(pairTraceId: pairTraceId, [
                "pairingId": pairingPayload.pairingId,
                "statusCode": (response as? HTTPURLResponse).map { String($0.statusCode) },
                "responseBytes": String(data.count),
                "durationMs": DiagnosticsLogger.durationMilliseconds(since: requestStartedAt)
            ])
        )
        try validateHTTP(response, data: data, expectedStatusCode: 200)
        let decoded = try JSONDecoder().decode(ClaimPairingResponse.self, from: data)
        DiagnosticsLogger.info(
            "PairingService",
            "claim_pairing_http_success",
            metadata: DiagnosticsLogger.pairTraceMetadata(pairTraceId: pairTraceId, [
                "pairingId": pairingPayload.pairingId,
                "bindingId": decoded.bindingId,
                "agentId": decoded.agentId,
                "durationMs": DiagnosticsLogger.durationMilliseconds(since: requestStartedAt)
            ])
        )
        return decoded
    }

    private func validateHTTP(
        _ response: URLResponse,
        data: Data,
        expectedStatusCode: Int
    ) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw PairingError.invalidResponse
        }

        guard httpResponse.statusCode == expectedStatusCode else {
            let message = String(data: data, encoding: .utf8) ?? "Unknown server error"
            throw PairingError.server(message)
        }
    }

    private static func classify(error: Error, relayBaseURL: String) -> PairingError? {
        if let pairingError = error as? PairingError {
            return pairingError
        }

        let nsError = error as NSError
        guard nsError.domain == NSURLErrorDomain,
              nsError.code == URLError.notConnectedToInternet.rawValue else {
            return nil
        }

        let host = URL(string: relayBaseURL)?.host
        guard LocalNetworkPermissionController.isLocalRelayHost(host) else {
            return nil
        }

        let diagnostics = [
            nsError.userInfo["_NSURLErrorNWPathKey"],
            nsError.userInfo[NSUnderlyingErrorKey],
            nsError
        ]
            .compactMap { $0 }
            .map { String(describing: $0).lowercased() }
            .joined(separator: " ")

        if diagnostics.contains("denied over wi-fi interface")
            || diagnostics.contains("policydenied") {
            return .localNetworkPermissionDenied
        }

        return nil
    }

    private static func networkErrorMetadata(_ error: Error) -> [String: String?] {
        let nsError = error as NSError
        var metadata: [String: String?] = [
            "error": nsError.localizedDescription,
            "errorDomain": nsError.domain,
            "errorCode": String(nsError.code)
        ]

        if let urlError = error as? URLError {
            metadata["urlErrorCode"] = String(urlError.code.rawValue)
        }

        metadata["failingURL"] = sanitizedDiagnostic(
            nsError.userInfo[NSURLErrorFailingURLErrorKey]
                ?? nsError.userInfo[NSURLErrorFailingURLStringErrorKey]
        )
        metadata["nwPath"] = sanitizedDiagnostic(nsError.userInfo["_NSURLErrorNWPathKey"])
        metadata["underlyingError"] = sanitizedDiagnostic(nsError.userInfo[NSUnderlyingErrorKey])
        return metadata
    }

    private static func sanitizedDiagnostic(_ value: Any?) -> String? {
        guard let value else {
            return nil
        }

        return String(describing: value)
            .replacingOccurrences(of: "\n", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

enum PairingError: LocalizedError {
    case invalidResponse
    case bindingUnavailable
    case localNetworkPermissionDenied
    case relayEnvironmentMismatch(expected: String, actual: String)
    case server(String)

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return String(localized: "pairingError.invalidResponse")
        case .bindingUnavailable:
            return String(localized: "pairingError.bindingUnavailable")
        case .localNetworkPermissionDenied:
            return String(localized: "pairingError.localNetworkDenied")
        case .relayEnvironmentMismatch(let expected, let actual):
            return String(format: String(localized: "pairingError.relayMismatch"), expected, actual)
        case .server(let message):
            return message
        }
    }
}
