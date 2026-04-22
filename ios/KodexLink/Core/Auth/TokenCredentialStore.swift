import Foundation
import Security

enum TokenCredentialStoreError: LocalizedError {
    case encodeFailed
    case decodeFailed(String)
    case unexpectedItem
    case unexpectedStatus(OSStatus, String)

    var errorDescription: String? {
        switch self {
        case .encodeFailed:
            return "Failed to encode token bundle."
        case .decodeFailed(let message):
            return "Failed to decode token bundle: \(message)"
        case .unexpectedItem:
            return "Unexpected credential payload returned from secure storage."
        case .unexpectedStatus(let status, let operation):
            let message = SecCopyErrorMessageString(status, nil) as String? ?? "Unknown OSStatus"
            return "\(operation) failed: \(message) (\(status))"
        }
    }
}

protocol TokenCredentialStore {
    func loadBundle() throws -> DeviceTokenBundle?
    func saveBundle(_ bundle: DeviceTokenBundle) throws
    func clearBundle() throws
}
