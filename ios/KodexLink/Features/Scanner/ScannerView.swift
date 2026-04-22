import SwiftUI

struct ScannerView: View {
    private let scannerRetryDelayNanoseconds: UInt64 = 1_200_000_000

    @EnvironmentObject private var tokenManager: TokenManager
    @EnvironmentObject private var bindingStore: BindingStore
    @EnvironmentObject private var relayConnection: RelayConnection
    @EnvironmentObject private var relayEnvironmentStore: RelayEnvironmentStore

    let pairingService: PairingService
    var onPairingSuccess: (() -> Void)? = nil
    private let qrScannerService = QRScannerService()

    @State private var pairingPayload = ""
    @State private var isClaiming = false
    @State private var errorMessage: String?
    @State private var cameraState: QRScannerAuthorizationState = .notDetermined
    @State private var isManualEntryExpanded = false
    @State private var isMacSetupExpanded = false
    @State private var isScannerPaused = false
    @State private var lastHandledPayload: String?
    @State private var scannerResumeTask: Task<Void, Never>?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("scanner.title")
                        .font(.title2.bold())
                    Text("scanner.subtitle")
                        .foregroundStyle(.secondary)
                }

                if let preferredRelayBaseURL = relayEnvironmentStore.preferredRelayBaseURL {
                    StatusMessageCard(
                        iconName: "network",
                        tint: .blue,
                        title: String(localized: "scanner.relayFixed.title"),
                        message: String(format: String(localized: "scanner.relayFixed.message"), preferredRelayBaseURL)
                    )
                }

                scannerSection

                if let errorMessage {
                    StatusMessageCard(
                        iconName: "exclamationmark.triangle.fill",
                        tint: .red,
                        title: String(localized: "scanner.pairingFailed"),
                        message: errorMessage
                    )
                }

                macSetupDisclosure

                DisclosureGroup(
                    isExpanded: $isManualEntryExpanded,
                    content: {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("scanner.manualEntry.hint")
                                .font(.footnote)
                                .foregroundStyle(.secondary)

                            TextEditor(text: $pairingPayload)
                                .font(.callout.monospaced())
                                .frame(minHeight: 160)
                                .padding(12)
                                .background(
                                    Color(.secondarySystemBackground),
                                    in: RoundedRectangle(cornerRadius: 18, style: .continuous)
                                )

                            Button {
                                Task {
                                    let trimmedPayload = pairingPayload.trimmingCharacters(in: .whitespacesAndNewlines)
                                    await claimPairing(rawPayload: trimmedPayload, pairTraceId: makePairTraceId())
                                }
                            } label: {
                                HStack {
                                    Image(systemName: isClaiming ? "hourglass" : "link.badge.plus")
                                    Text(isClaiming ? "scanner.claiming" : "scanner.useManualContent")
                                }
                                .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(isClaiming || pairingPayload.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        }
                        .padding(.top, 12)
                    },
                    label: {
                        Label("scanner.manualEntry.title", systemImage: "keyboard")
                            .font(.headline)
                    }
                )
                .padding(18)
                .background(
                    RoundedRectangle(cornerRadius: 24, style: .continuous)
                        .fill(Color(.secondarySystemGroupedBackground))
                )
            }
            .padding(20)
        }
        .task {
            await prepareScanner()
        }
        .onDisappear {
            scannerResumeTask?.cancel()
            scannerResumeTask = nil
        }
    }

    private var macSetupDisclosure: some View {
        DisclosureGroup(
            isExpanded: $isMacSetupExpanded,
            content: {
                VStack(alignment: .leading, spacing: 12) {
                    Text("scanner.macSetup.hint")
                        .font(.footnote)
                        .foregroundStyle(.secondary)

                    VStack(alignment: .leading, spacing: 10) {
                        ScannerSetupStepRow(number: 1, label: String(localized: "macSetup.step1"), code: nil)
                        ScannerSetupStepRow(number: 2, label: String(localized: "macSetup.step2"), code: "npm install -g kodexlink")
                        ScannerSetupStepRow(number: 3, label: String(localized: "macSetup.step3"), code: "kodexlink start")
                    }

                    Text("scanner.macSetup.footer")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .padding(.top, 12)
            },
            label: {
                Label("scanner.macSetup.title", systemImage: "laptopcomputer")
                    .font(.headline)
            }
        )
        .padding(18)
        .background(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(Color(.secondarySystemGroupedBackground))
        )
    }

    @ViewBuilder
    private var scannerSection: some View {
        switch cameraState {
        case .authorized:
            VStack(alignment: .leading, spacing: 14) {
                ZStack {
                    QRCodeCaptureView(isScanningEnabled: !isClaiming && !isScannerPaused) { scannedValue in
                        handleScannedPayload(scannedValue)
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))

                    RoundedRectangle(cornerRadius: 28, style: .continuous)
                        .strokeBorder(Color.white.opacity(0.2), lineWidth: 1)

                    ScannerFocusOverlay(isClaiming: isClaiming)
                }
                .frame(height: 320)
                .background(
                    LinearGradient(
                        colors: [Color.black.opacity(0.85), Color.black.opacity(0.65)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    in: RoundedRectangle(cornerRadius: 28, style: .continuous)
                )

                StatusMessageCard(
                    iconName: isClaiming ? "hourglass.circle.fill" : "qrcode.viewfinder",
                    tint: isClaiming ? .orange : .green,
                    title: isClaiming ? String(localized: "scanner.claiming.title") : String(localized: "scanner.aimQR"),
                    message: isClaiming
                        ? String(localized: "scanner.claimSuccess")
                        : String(localized: "scanner.autoScan")
                )
            }

        case .notDetermined:
            StatusMessageCard(
                iconName: "camera.aperture",
                tint: .orange,
                title: String(localized: "scanner.preparingCamera"),
                message: String(localized: "scanner.preparingCamera.message")
            )

        case .denied:
            permissionCard(
                title: String(localized: "scanner.cameraDenied"),
                message: String(localized: "scanner.cameraDenied.message")
            )

        case .restricted:
            permissionCard(
                title: String(localized: "scanner.cameraRestricted"),
                message: String(localized: "scanner.cameraRestricted.message")
            )

        case .unavailable:
            permissionCard(
                title: String(localized: "scanner.cameraUnavailable"),
                message: String(localized: "scanner.cameraUnavailable.message")
            )
        }
    }

    @ViewBuilder
    private func permissionCard(title: String, message: String) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            StatusMessageCard(
                iconName: "camera.metering.none",
                tint: .orange,
                title: title,
                message: message
            )

            if cameraState == .denied {
                Button {
                    AppSettingsOpener.openAppSettings()
                } label: {
                    Label("scanner.openSettings", systemImage: "gearshape")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
            }
        }
        .onAppear {
            isManualEntryExpanded = true
        }
    }

    private func prepareScanner() async {
        let currentState = qrScannerService.authorizationState
        switch currentState {
        case .notDetermined:
            cameraState = .notDetermined
            cameraState = await qrScannerService.requestCameraAccessIfNeeded()
        default:
            cameraState = currentState
        }

        if cameraState != .authorized {
            isManualEntryExpanded = true
        }
    }

    private func handleScannedPayload(_ scannedValue: String) {
        guard !isClaiming, !isScannerPaused else {
            return
        }

        do {
            let normalized = try qrScannerService.normalizedPayload(from: scannedValue)
            guard normalized != lastHandledPayload else {
                return
            }

            let pairTraceId = makePairTraceId()
            DiagnosticsLogger.info(
                "ScannerView",
                "scan_payload_normalized",
                metadata: DiagnosticsLogger.pairTraceMetadata(pairTraceId: pairTraceId, [
                    "payloadLength": String(normalized.count),
                    "cameraState": String(describing: cameraState)
                ])
            )

            lastHandledPayload = normalized
            pauseScanner(pairTraceId: pairTraceId, reason: "payload_detected")
            pairingPayload = normalized
            errorMessage = nil

            Task {
                await claimPairing(rawPayload: normalized, pairTraceId: pairTraceId)
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func claimPairing(rawPayload: String, pairTraceId: String) async {
        guard !rawPayload.isEmpty else {
            errorMessage = String(localized: "scanner.payloadEmpty")
            return
        }

        let claimStartedAt = Date()
        isClaiming = true
        errorMessage = nil
        DiagnosticsLogger.info(
            "ScannerView",
            "claim_pairing_ui_start",
            metadata: DiagnosticsLogger.pairTraceMetadata(pairTraceId: pairTraceId, [
                "payloadLength": String(rawPayload.count),
                "isManualEntryExpanded": isManualEntryExpanded ? "true" : "false"
            ])
        )

        defer {
            isClaiming = false
        }

        do {
            let binding = try await pairingService.claimPairingSession(
                rawPayload: rawPayload,
                tokenManager: tokenManager,
                bindingStore: bindingStore,
                expectedRelayBaseURL: relayEnvironmentStore.preferredRelayBaseURL,
                pairTraceId: pairTraceId
            )
            DiagnosticsLogger.info(
                "ScannerView",
                "claim_pairing_ui_binding_ready",
                metadata: DiagnosticsLogger.pairTraceMetadata(pairTraceId: pairTraceId, [
                    "bindingId": binding.id,
                    "agentId": binding.agentId,
                    "durationMs": DiagnosticsLogger.durationMilliseconds(since: claimStartedAt)
                ])
            )

            guard let deviceId = tokenManager.mobileDeviceId,
                  let deviceToken = tokenManager.deviceToken else {
                throw RelayConnectionError.notConfigured
            }

            relayConnection.updateSession(
                relayBaseURL: binding.relayBaseURL,
                deviceId: deviceId,
                deviceToken: deviceToken,
                bindingId: binding.id,
                pairTraceId: pairTraceId,
                resetRePairingState: true
            )
            relayConnection.connect()
            relayConnection.refreshBindingPresenceAfterPairing()
            pairingPayload = ""
            isManualEntryExpanded = false
            DiagnosticsLogger.info(
                "ScannerView",
                "claim_pairing_ui_success",
                metadata: DiagnosticsLogger.pairTraceMetadata(pairTraceId: pairTraceId, [
                    "bindingId": binding.id,
                    "agentId": binding.agentId,
                    "deviceId": deviceId,
                    "durationMs": DiagnosticsLogger.durationMilliseconds(since: claimStartedAt)
                ])
            )
            onPairingSuccess?()
        } catch {
            errorMessage = error.localizedDescription
            DiagnosticsLogger.warning(
                "ScannerView",
                "claim_pairing_ui_failed",
                metadata: DiagnosticsLogger.pairTraceMetadata(pairTraceId: pairTraceId, [
                    "error": error.localizedDescription,
                    "durationMs": DiagnosticsLogger.durationMilliseconds(since: claimStartedAt)
                ])
            )
            scheduleScannerResume(
                after: scannerRetryDelayNanoseconds,
                pairTraceId: pairTraceId,
                payloadToRelease: rawPayload,
                reason: "claim_failed"
            )
        }
    }

    private func makePairTraceId() -> String {
        let suffix = UUID().uuidString
            .lowercased()
            .replacingOccurrences(of: "-", with: "")
            .prefix(10)
        return "pt_\(suffix)"
    }

    private func pauseScanner(pairTraceId: String?, reason: String) {
        scannerResumeTask?.cancel()
        scannerResumeTask = nil

        guard !isScannerPaused else {
            return
        }

        isScannerPaused = true
        DiagnosticsLogger.info(
            "ScannerView",
            "scanner_pause_requested",
            metadata: DiagnosticsLogger.pairTraceMetadata(pairTraceId: pairTraceId, [
                "reason": reason
            ])
        )
    }

    private func scheduleScannerResume(
        after delayNanoseconds: UInt64,
        pairTraceId: String,
        payloadToRelease: String,
        reason: String
    ) {
        scannerResumeTask?.cancel()
        let cooldownMs = String(delayNanoseconds / 1_000_000)
        DiagnosticsLogger.info(
            "ScannerView",
            "scanner_resume_scheduled",
            metadata: DiagnosticsLogger.pairTraceMetadata(pairTraceId: pairTraceId, [
                "reason": reason,
                "cooldownMs": cooldownMs
            ])
        )

        scannerResumeTask = Task {
            do {
                try await Task.sleep(nanoseconds: delayNanoseconds)
            } catch {
                return
            }

            guard !Task.isCancelled else {
                return
            }

            await MainActor.run {
                if lastHandledPayload == payloadToRelease {
                    lastHandledPayload = nil
                }
                isScannerPaused = false
                scannerResumeTask = nil
                DiagnosticsLogger.info(
                    "ScannerView",
                    "scanner_resumed",
                    metadata: DiagnosticsLogger.pairTraceMetadata(pairTraceId: pairTraceId, [
                        "reason": reason,
                        "cooldownMs": cooldownMs
                    ])
                )
            }
        }
    }

}

private struct ScannerSetupStepRow: View {
    let number: Int
    let label: String
    let code: String?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text("\(number)")
                .font(.caption2.weight(.bold))
                .foregroundStyle(.white)
                .frame(width: 18, height: 18)
                .background(Color.orange, in: Circle())

            VStack(alignment: .leading, spacing: 4) {
                Text(label)
                    .font(.footnote)
                if let code {
                    Text(code)
                        .font(.caption.monospaced())
                        .foregroundStyle(.orange)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(
                            Color.orange.opacity(0.1),
                            in: RoundedRectangle(cornerRadius: 6, style: .continuous)
                        )
                }
            }
        }
    }
}

private struct StatusMessageCard: View {
    let iconName: String
    let tint: Color
    let title: String
    let message: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: iconName)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 24)

            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.headline)
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            Spacer(minLength: 0)
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(Color(.secondarySystemGroupedBackground))
        )
    }
}

private struct ScannerFocusOverlay: View {
    let isClaiming: Bool

    var body: some View {
        GeometryReader { proxy in
            let focusSize = min(proxy.size.width * 0.58, proxy.size.height * 0.58)

            ZStack {
                RoundedRectangle(cornerRadius: 26, style: .continuous)
                    .strokeBorder(
                        LinearGradient(
                            colors: [Color.green.opacity(0.9), Color.white.opacity(0.7)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ),
                        style: StrokeStyle(lineWidth: 3, dash: [12, 10])
                    )
                    .frame(width: focusSize, height: focusSize)

                VStack {
                    HStack {
                        Label(
                            isClaiming ? "scanner.claimingOverlay" : "scanner.autoRecognize",
                            systemImage: isClaiming ? "hourglass.circle.fill" : "sparkles.rectangle.stack"
                        )
                        .font(.footnote.weight(.semibold))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(Color.black.opacity(0.55), in: Capsule())
                        .foregroundStyle(.white)

                        Spacer()
                    }

                    Spacer()

                    Text("scanner.autoScanHint")
                        .font(.footnote)
                        .multilineTextAlignment(.leading)
                        .foregroundStyle(.white.opacity(0.92))
                        .padding(14)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.black.opacity(0.45), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                }
                .padding(18)
            }
        }
        .allowsHitTesting(false)
    }
}

#Preview {
    ScannerView(pairingService: PairingService())
        .environmentObject(TokenManager())
        .environmentObject(BindingStore())
        .environmentObject(RelayConnection())
        .environmentObject(RelayEnvironmentStore())
}
