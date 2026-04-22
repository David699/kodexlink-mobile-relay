import Foundation

enum ErrorCode: String, Codable {
    case unauthorized = "UNAUTHORIZED"
    case authFailed = "AUTH_FAILED"
    case deviceAlreadyInitialized = "DEVICE_ALREADY_INITIALIZED"
    case forbidden = "FORBIDDEN"
    case invalidPayload = "INVALID_PAYLOAD"
    case unsupportedVersion = "UNSUPPORTED_VERSION"
    case bindingNotFound = "BINDING_NOT_FOUND"
    case bindingDisabled = "BINDING_DISABLED"
    case agentOffline = "AGENT_OFFLINE"
    case controlNotHeld = "CONTROL_NOT_HELD"
    case idempotencyConflict = "IDEMPOTENCY_CONFLICT"
    case tokenExpired = "TOKEN_EXPIRED"
    case tokenRevoked = "TOKEN_REVOKED"
    case internalError = "INTERNAL_ERROR"

    /// 兜底：服务端返回未知错误码时不会导致解码失败
    case unknown

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let rawValue = try container.decode(String.self)
        self = ErrorCode(rawValue: rawValue) ?? .unknown
    }
}
