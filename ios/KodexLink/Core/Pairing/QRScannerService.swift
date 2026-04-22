import AVFoundation
import Foundation

enum QRScannerAuthorizationState {
    case notDetermined
    case authorized
    case denied
    case restricted
    case unavailable
}

enum QRScannerError: LocalizedError {
    case unsupportedPayload

    var errorDescription: String? {
        switch self {
        case .unsupportedPayload:
            return String(localized: "qrScannerError.unsupported")
        }
    }
}

final class QRScannerService {
    var authorizationState: QRScannerAuthorizationState {
        guard AVCaptureDevice.default(for: .video) != nil else {
            return .unavailable
        }

        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .notDetermined:
            return .notDetermined
        case .authorized:
            return .authorized
        case .denied:
            return .denied
        case .restricted:
            return .restricted
        @unknown default:
            return .denied
        }
    }

    func requestCameraAccessIfNeeded() async -> QRScannerAuthorizationState {
        guard authorizationState == .notDetermined else {
            return authorizationState
        }

        let granted = await withCheckedContinuation { continuation in
            AVCaptureDevice.requestAccess(for: .video) { isGranted in
                continuation.resume(returning: isGranted)
            }
        }

        return granted ? .authorized : .denied
    }

    func normalizedPayload(from scannedValue: String) throws -> String {
        let trimmed = scannedValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw QRScannerError.unsupportedPayload
        }

        if trimmed.hasPrefix("{") {
            return trimmed
        }

        if let components = URLComponents(string: trimmed),
           let payload = components.queryItems?.first(where: { $0.name == "payload" })?.value {
            let normalized = payload.trimmingCharacters(in: .whitespacesAndNewlines)
            if normalized.hasPrefix("{") {
                return normalized
            }
        }

        if let data = Data(base64Encoded: trimmed),
           let decoded = String(data: data, encoding: .utf8) {
            let normalized = decoded.trimmingCharacters(in: .whitespacesAndNewlines)
            if normalized.hasPrefix("{") {
                return normalized
            }
        }

        throw QRScannerError.unsupportedPayload
    }
}
