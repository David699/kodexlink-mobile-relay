import SwiftUI

struct AppShellView: View {
    @EnvironmentObject private var relayConnection: RelayConnection
    @EnvironmentObject private var bindingStore: BindingStore
    @EnvironmentObject private var localNetworkPermissionController: LocalNetworkPermissionController
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @State private var controlTakeoverErrorMessage: String?
    @State private var selectedTab = 0
    let pairingService: PairingService

    var body: some View {
        Group {
            if localNetworkPermissionController.shouldBlockApp {
                LocalNetworkPermissionGateView()
            } else if bindingStore.defaultBinding == nil {
                OnboardingView(pairingService: pairingService)
            } else {
                configuredTabView
                .alert(
                    "app.takeover.failed",
                    isPresented: Binding(
                        get: { controlTakeoverErrorMessage != nil },
                        set: { isPresented in
                            if !isPresented {
                                controlTakeoverErrorMessage = nil
                            }
                        }
                    )
                ) {
                    Button("common.ok", role: .cancel) {
                        controlTakeoverErrorMessage = nil
                    }
                } message: {
                    Text(controlTakeoverErrorMessage ?? NSLocalizedString("app.takeover.failedMessage", comment: ""))
                }
            }
        }
    }

    @ViewBuilder
    private var configuredTabView: some View {
        baseTabView
            .environment(\.horizontalSizeClass, shouldForceBottomTabBar ? .compact : horizontalSizeClass)
            .safeAreaInset(edge: .top, spacing: 8) {
                statusChrome
                    .padding(.top, 8)
            }
    }

    private var shouldForceBottomTabBar: Bool {
        UIDevice.current.userInterfaceIdiom == .pad && horizontalSizeClass == .regular
    }

    private var baseTabView: some View {
        TabView(selection: $selectedTab) {
            NavigationStack {
                ThreadListView()
            }
            .tabItem {
                Label("app.tab.threads", systemImage: "message.badge.fill")
            }
            .tag(0)

            NavigationStack {
                ScannerView(pairingService: pairingService, onPairingSuccess: {
                    selectedTab = 0
                })
            }
            .tabItem {
                Label("app.tab.pairing", systemImage: "qrcode.viewfinder")
            }
            .tag(1)

            NavigationStack {
                SettingsView()
            }
            .tabItem {
                Label("app.tab.settings", systemImage: "gearshape.fill")
            }
            .badge("❤️")
            .tag(2)
        }
    }

    private var statusChrome: some View {
        VStack(spacing: 8) {
            ConnectionStatusBadge(
                relayState: relayConnection.state,
                agentStatus: relayConnection.currentAgentStatus,
                agentDegradedReason: relayConnection.currentAgentDegradedReason,
                isMissingCodexRuntimeDetail: relayConnection.isMissingCodexRuntimeDetail,
                requiresRePairing: relayConnection.requiresRePairing,
                needsSessionRecovery: relayConnection.needsSessionRecovery
            )

            if relayConnection.shouldShowControlTakeoverBanner {
                ControlTakeoverBanner(
                    message: relayConnection.controlTakeoverBannerText,
                    isLoading: relayConnection.isAcquiringCurrentBindingControl,
                    canTakeover: relayConnection.canManuallyTakeoverCurrentBinding,
                    takeover: {
                        Task {
                            do {
                                try await relayConnection.takeoverCurrentBindingControl()
                            } catch {
                                controlTakeoverErrorMessage = error.localizedDescription
                            }
                        }
                    }
                )
            }
        }
        .padding(.top, 8)
    }
}

private struct ConnectionStatusBadge: View {
    let relayState: RelayConnection.ConnectionState
    let agentStatus: RelayConnection.AgentStatus
    let agentDegradedReason: AgentDegradedReason?
    let isMissingCodexRuntimeDetail: Bool
    let requiresRePairing: Bool
    let needsSessionRecovery: Bool

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: appearance.iconName)
            Text(appearance.title)
                .font(.caption.weight(.semibold))
        }
        .foregroundStyle(appearance.tint)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.ultraThinMaterial, in: Capsule())
        .overlay(
            Capsule()
                .strokeBorder(appearance.tint.opacity(0.2), lineWidth: 1)
        )
    }

    private var appearance: (title: String, iconName: String, tint: Color) {
        if requiresRePairing {
            return (NSLocalizedString("app.status.rePairingRequired", comment: ""), "qrcode.viewfinder", .red)
        }

        if needsSessionRecovery {
            return (NSLocalizedString("app.status.authRecovering", comment: ""), "arrow.triangle.2.circlepath.circle.fill", .orange)
        }

        switch relayState {
        case .disconnected:
            return (NSLocalizedString("app.status.relayDisconnected", comment: ""), "bolt.horizontal.circle", .secondary)
        case .connecting:
            return (NSLocalizedString("app.status.relayConnecting", comment: ""), "ellipsis.message.fill", .orange)
        case .connected:
            switch agentStatus {
            case .unknown:
                return (NSLocalizedString("app.status.relayConnected", comment: ""), "checkmark.seal.fill", .green)
            case .online:
                return (NSLocalizedString("app.status.macOnline", comment: ""), "desktopcomputer.and.arrow.down", .green)
            case .offline:
                return (NSLocalizedString("app.status.macOffline", comment: ""), "desktopcomputer.trianglebadge.exclamationmark", .orange)
            case .degraded:
                switch agentDegradedReason {
                case .runtimeUnavailable:
                    return (
                        NSLocalizedString(
                            isMissingCodexRuntimeDetail ? "app.status.codexMissing" : "app.status.macRuntimeError",
                            comment: ""
                        ),
                        "desktopcomputer.badge.exclamationmark",
                        .orange
                    )
                case .requestFailures:
                    return (NSLocalizedString("app.status.macRequestError", comment: ""), "desktopcomputer.badge.exclamationmark", .orange)
                case nil:
                    return (NSLocalizedString("app.status.macStatusError", comment: ""), "desktopcomputer.badge.exclamationmark", .orange)
                }
            }
        case .failed:
            return (NSLocalizedString("app.status.relayFailed", comment: ""), "exclamationmark.triangle.fill", .red)
        }
    }
}

private struct ControlTakeoverBanner: View {
    let message: String
    let isLoading: Bool
    let canTakeover: Bool
    let takeover: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: isLoading ? "arrow.triangle.2.circlepath.circle.fill" : "iphone.gen3.badge.exclamationmark")
                .font(.system(size: 14, weight: .semibold))
            Text(message)
                .font(.caption.weight(.semibold))
                .multilineTextAlignment(.leading)
            Spacer(minLength: 0)
            Button(action: takeover) {
                Text(isLoading ? NSLocalizedString("app.takeover.inProgress", comment: "") : NSLocalizedString("app.takeover.action", comment: ""))
                    .font(.caption.weight(.semibold))
            }
            .buttonStyle(.borderedProminent)
            .disabled(!canTakeover)
        }
        .foregroundStyle(.orange)
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(Color.orange.opacity(0.18), lineWidth: 1)
        )
        .padding(.horizontal, 16)
    }
}

#Preview {
    AppShellView(pairingService: PairingService())
        .environmentObject(RelayConnection())
        .environmentObject(BindingStore())
        .environmentObject(RelayEnvironmentStore())
        .environmentObject(LocalNetworkPermissionController())
}
