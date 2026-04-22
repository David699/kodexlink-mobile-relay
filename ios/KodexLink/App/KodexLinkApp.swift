import SwiftUI

@main
struct KodexLinkApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase
    @State private var didEnterBackground = false
    @StateObject private var relayConnection = RelayConnection()
    @StateObject private var tokenManager = TokenManager()
    @StateObject private var bindingStore = BindingStore()
    @StateObject private var relayEnvironmentStore = RelayEnvironmentStore()
    @StateObject private var localNetworkPermissionController = LocalNetworkPermissionController()
    @StateObject private var userAvatarStore = UserAvatarStore()
    @StateObject private var tipStore = TipStore()
    private let pairingService = PairingService()
    private let authService = AuthService()

    var body: some Scene {
        WindowGroup {
            AppShellView(pairingService: pairingService)
                .environmentObject(relayConnection)
                .environmentObject(tokenManager)
                .environmentObject(bindingStore)
                .environmentObject(relayEnvironmentStore)
                .environmentObject(localNetworkPermissionController)
                .environmentObject(userAvatarStore)
                .environmentObject(tipStore)
                .task {
                    await restoreSessionIfNeeded(forcePermissionRefresh: true)
                    await relayEnvironmentStore.refreshHostedRelayBaseURL()
                    await tipStore.preloadProductsIfNeeded()
                }
        }
        .onChange(of: scenePhase) { oldPhase, newPhase in
            DiagnosticsLogger.info(
                "AppLifecycle",
                "scene_phase_changed",
                metadata: DiagnosticsLogger.metadata([
                    "phase": String(describing: newPhase)
                ])
            )
            switch newPhase {
            case .active:
                Task {
                    await restoreSessionIfNeeded(forcePermissionRefresh: true)
                    await relayEnvironmentStore.refreshHostedRelayBaseURL()
                }
                if didEnterBackground {
                    didEnterBackground = false
                    if tipStore.purchaseState != .purchasing {
                        AppOpenAdManager.shared.showAdIfAvailable()
                    }
                }
            case .inactive:
                break
            case .background:
                didEnterBackground = true
                relayConnection.disconnect()
            @unknown default:
                break
            }
        }
        .onChange(of: bindingStore.defaultBinding?.id) { _, _ in
            Task {
                await restoreSessionIfNeeded(forcePermissionRefresh: true)
            }
        }
        .onChange(of: relayEnvironmentStore.mode) { _, _ in
            Task {
                await restoreSessionIfNeeded(forcePermissionRefresh: true)
            }
        }
        .onChange(of: relayEnvironmentStore.customRelayBaseURL) { _, _ in
            Task {
                await restoreSessionIfNeeded(forcePermissionRefresh: true)
            }
        }
        .onChange(of: relayEnvironmentStore.hostedRelayBaseURL) { _, _ in
            Task {
                await restoreSessionIfNeeded(forcePermissionRefresh: true)
            }
        }
        .onChange(of: localNetworkPermissionController.status) { _, _ in
            Task {
                await restoreSessionIfNeeded(forcePermissionRefresh: false)
            }
        }
        .onChange(of: relayConnection.needsSessionRecovery) { _, needsRecovery in
            guard needsRecovery else {
                return
            }

            Task {
                await restoreSessionIfNeeded(forcePermissionRefresh: false)
            }
        }
    }

    private func restoreSessionIfNeeded(forcePermissionRefresh: Bool) async {
        let defaultBinding = bindingStore.defaultBinding
        let resolvedRelayBaseURL = relayEnvironmentStore.resolvedRelayBaseURL(
            bindingRelayBaseURL: defaultBinding?.relayBaseURL
        )
        DiagnosticsLogger.info(
            "AppLifecycle",
            "restore_session_start",
            metadata: DiagnosticsLogger.metadata([
                "forcePermissionRefresh": forcePermissionRefresh ? "true" : "false",
                "bindingId": defaultBinding?.id,
                "agentId": defaultBinding?.agentId,
                "resolvedRelayBaseURL": resolvedRelayBaseURL,
                "relayEnvironmentMode": relayEnvironmentStore.mode.rawValue
            ])
        )
        localNetworkPermissionController.updateRequirement(
            relayBaseURL: resolvedRelayBaseURL,
            hasBinding: defaultBinding != nil,
            force: forcePermissionRefresh
        )

        if relayEnvironmentStore.requiresSessionReset(for: defaultBinding) {
            DiagnosticsLogger.warning(
                "AppLifecycle",
                "restore_session_reset_required",
                metadata: DiagnosticsLogger.metadata([
                    "bindingId": defaultBinding?.id,
                    "bindingRelayBaseURL": defaultBinding?.relayBaseURL,
                    "preferredRelayBaseURL": relayEnvironmentStore.preferredRelayBaseURL
                ])
            )
            tokenManager.clear()
            bindingStore.clear()
            relayConnection.clearSession()
            return
        }

        guard localNetworkPermissionController.isAuthorized else {
            DiagnosticsLogger.warning(
                "AppLifecycle",
                "restore_session_blocked_by_local_network",
                metadata: DiagnosticsLogger.metadata([
                    "bindingId": defaultBinding?.id,
                    "localNetworkStatus": String(describing: localNetworkPermissionController.status)
                ])
            )
            if defaultBinding == nil {
                relayConnection.clearSession()
            } else {
                relayConnection.disconnect()
            }
            return
        }

        guard let binding = defaultBinding else {
            DiagnosticsLogger.info("AppLifecycle", "restore_session_no_binding")
            relayConnection.clearSession()
            return
        }

        guard let currentBundle = tokenManager.currentBundle() else {
            DiagnosticsLogger.warning(
                "AppLifecycle",
                "restore_session_missing_token_bundle",
                metadata: DiagnosticsLogger.metadata([
                    "bindingId": binding.id
                ])
            )
            relayConnection.markRePairingRequired()
            return
        }

        let relayBaseURL = relayEnvironmentStore.resolvedRelayBaseURL(
            bindingRelayBaseURL: binding.relayBaseURL
        ) ?? binding.relayBaseURL
        var activeBundle = currentBundle
        if relayConnection.needsSessionRecovery || tokenManager.shouldRefresh() {
            do {
                DiagnosticsLogger.info(
                    "AppLifecycle",
                    "restore_session_refresh_start",
                    metadata: DiagnosticsLogger.metadata([
                        "bindingId": binding.id,
                        "deviceId": currentBundle.deviceId,
                        "relayBaseURL": relayBaseURL
                    ])
                )
                let refreshedBundle = try await authService.refreshSession(
                    relayBaseURL: relayBaseURL,
                    deviceId: currentBundle.deviceId,
                    refreshToken: currentBundle.refreshToken
                )
                tokenManager.update(bundle: refreshedBundle)
                activeBundle = refreshedBundle
                DiagnosticsLogger.info(
                    "AppLifecycle",
                    "restore_session_refresh_success",
                    metadata: DiagnosticsLogger.metadata([
                        "bindingId": binding.id,
                        "deviceId": refreshedBundle.deviceId
                    ])
                )
            } catch let authError as AuthServiceError {
                if authError.isCredentialRejected {
                    DiagnosticsLogger.warning(
                        "AppLifecycle",
                        "restore_session_refresh_rejected",
                        metadata: DiagnosticsLogger.metadata([
                            "bindingId": binding.id,
                            "error": authError.localizedDescription
                        ])
                    )
                    tokenManager.clear()
                    relayConnection.markRePairingRequired()
                    return
                }

                if relayConnection.needsSessionRecovery || currentBundle.accessExpiresAt <= Int(Date().timeIntervalSince1970) {
                    DiagnosticsLogger.warning(
                        "AppLifecycle",
                        "restore_session_refresh_failed_requires_recovery",
                        metadata: DiagnosticsLogger.metadata([
                            "bindingId": binding.id,
                            "error": authError.localizedDescription
                        ])
                    )
                    relayConnection.markSessionRecoveryNeeded(message: authError.localizedDescription)
                    return
                }
            } catch {
                if relayConnection.needsSessionRecovery || currentBundle.accessExpiresAt <= Int(Date().timeIntervalSince1970) {
                    DiagnosticsLogger.warning(
                        "AppLifecycle",
                        "restore_session_refresh_failed",
                        metadata: DiagnosticsLogger.metadata([
                            "bindingId": binding.id,
                            "error": error.localizedDescription
                        ])
                    )
                    relayConnection.markSessionRecoveryNeeded(message: error.localizedDescription)
                    return
                }
            }
        }

        relayConnection.updateSession(
            relayBaseURL: relayBaseURL,
            deviceId: activeBundle.deviceId,
            deviceToken: activeBundle.accessToken,
            bindingId: binding.id
        )
        DiagnosticsLogger.info(
            "AppLifecycle",
            "restore_session_connect",
            metadata: DiagnosticsLogger.metadata([
                "bindingId": binding.id,
                "agentId": binding.agentId,
                "deviceId": activeBundle.deviceId,
                "relayBaseURL": relayBaseURL
            ])
        )
        relayConnection.connect()
    }
}
