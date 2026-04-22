import Foundation

private struct TokenRefreshResponse: Codable {
    let deviceId: String
    let accessToken: String
    let refreshToken: String
    let accessExpiresAt: Int
    let refreshExpiresAt: Int
    let relayUrl: String
}

enum AuthServiceError: LocalizedError {
    case invalidResponse
    case server(code: ErrorCode, message: String)
    case serverMessage(String)

    var isCredentialRejected: Bool {
        switch self {
        case .server(let code, _):
            switch code {
            case .unauthorized, .authFailed, .tokenExpired, .tokenRevoked:
                return true
            default:
                return false
            }
        case .invalidResponse, .serverMessage:
            return false
        }
    }

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return String(localized: "authError.invalidResponse")
        case .server(_, let message), .serverMessage(let message):
            return message
        }
    }
}

final class AuthService {
    private let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    func refreshSession(
        relayBaseURL: String,
        deviceId: String,
        refreshToken: String
    ) async throws -> DeviceTokenBundle {
        DiagnosticsLogger.info(
            "AuthService",
            "refresh_session_start",
            metadata: DiagnosticsLogger.metadata([
                "relayBaseURL": relayBaseURL,
                "deviceId": deviceId,
                "refreshTokenPresent": refreshToken.isEmpty ? "false" : "true"
            ])
        )
        var request = URLRequest(url: URL(string: "\(relayBaseURL)/v1/token/refresh")!)
        request.httpMethod = "POST"
        request.setValue(deviceId, forHTTPHeaderField: "x-device-id")
        request.setValue(refreshToken, forHTTPHeaderField: "x-refresh-token")

        let (data, response) = try await session.data(for: request)
        try validateHTTP(response, data: data, expectedStatusCode: 200)

        let decoded = try JSONDecoder().decode(TokenRefreshResponse.self, from: data)
        DiagnosticsLogger.info(
            "AuthService",
            "refresh_session_success",
            metadata: DiagnosticsLogger.metadata([
                "relayBaseURL": relayBaseURL,
                "deviceId": decoded.deviceId,
                "accessExpiresAt": String(decoded.accessExpiresAt),
                "refreshExpiresAt": String(decoded.refreshExpiresAt)
            ])
        )
        return DeviceTokenBundle(
            deviceId: decoded.deviceId,
            accessToken: decoded.accessToken,
            refreshToken: decoded.refreshToken,
            accessExpiresAt: decoded.accessExpiresAt,
            refreshExpiresAt: decoded.refreshExpiresAt
        )
    }

    private func validateHTTP(
        _ response: URLResponse,
        data: Data,
        expectedStatusCode: Int
    ) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            DiagnosticsLogger.warning("AuthService", "refresh_session_invalid_response")
            throw AuthServiceError.invalidResponse
        }

        guard httpResponse.statusCode == expectedStatusCode else {
            if let errorPayload = try? JSONDecoder().decode(ErrorPayload.self, from: data) {
                DiagnosticsLogger.warning(
                    "AuthService",
                    "refresh_session_server_error",
                    metadata: DiagnosticsLogger.metadata([
                        "statusCode": String(httpResponse.statusCode),
                        "code": errorPayload.code.rawValue,
                        "message": errorPayload.message
                    ])
                )
                throw AuthServiceError.server(
                    code: errorPayload.code,
                    message: errorPayload.message
                )
            }

            let message = String(data: data, encoding: .utf8) ?? "Unknown auth server error"
            DiagnosticsLogger.warning(
                "AuthService",
                "refresh_session_http_error",
                metadata: DiagnosticsLogger.metadata([
                    "statusCode": String(httpResponse.statusCode),
                    "message": message
                ])
            )
            throw AuthServiceError.serverMessage(message)
        }
    }
}
