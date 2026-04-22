import SwiftUI

struct LocalNetworkPermissionGateView: View {
    @EnvironmentObject private var permissionController: LocalNetworkPermissionController
    @EnvironmentObject private var bindingStore: BindingStore

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("KodexLink")
                            .font(.largeTitle.bold())
                        Text("localNetworkGate.subtitle")
                            .foregroundStyle(.secondary)
                    }

                    RelayEnvironmentStatusCard(bindingRelayBaseURL: bindingStore.defaultBinding?.relayBaseURL)

                    statusCard

                    actionSection

                    instructionsCard
                }
                .padding(20)
            }
            .background(Color(.systemGroupedBackground))
        }
    }

    private var title: String {
        switch permissionController.status {
        case .checking:
            return String(localized: "localNetworkGate.checking")
        case .denied:
            return String(localized: "localNetworkGate.denied")
        case .unavailable:
            return String(localized: "localNetworkGate.unavailable")
        case .idle, .granted, .notRequired:
            return String(localized: "localNetworkGate.preparing")
        }
    }

    private var message: String {
        switch permissionController.status {
        case .checking:
            return String(localized: "localNetworkGate.checking.message")
        case .denied:
            return String(localized: "localNetworkGate.denied.message")
        case .unavailable(let reason):
            return reason
        case .idle, .granted, .notRequired:
            return String(localized: "localNetworkGate.checking.detail")
        }
    }

    private var iconName: String {
        switch permissionController.status {
        case .checking:
            return "dot.radiowaves.left.and.right"
        case .denied:
            return "wifi.slash"
        case .unavailable:
            return "exclamationmark.triangle.fill"
        case .idle, .granted, .notRequired:
            return "wifi"
        }
    }

    private var iconTint: Color {
        switch permissionController.status {
        case .checking:
            return .orange
        case .denied, .unavailable:
            return .red
        case .idle, .granted, .notRequired:
            return .green
        }
    }

    private var statusCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                Image(systemName: iconName)
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundStyle(iconTint)

                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.headline)
                    Text(message)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }

            if permissionController.status == .checking {
                HStack(spacing: 10) {
                    ProgressView()
                        .progressViewStyle(.circular)
                    Text("localNetworkGate.waitingSystem")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(18)
        .background(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(Color(.secondarySystemGroupedBackground))
        )
    }

    @ViewBuilder
    private var actionSection: some View {
        if permissionController.status != .checking {
            VStack(spacing: 12) {
                Button {
                    permissionController.retry()
                } label: {
                    Label("localNetworkGate.recheckPermission", systemImage: "arrow.clockwise")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)

                Button {
                    AppSettingsOpener.openAppSettings()
                } label: {
                    Label("localNetworkGate.openSettings", systemImage: "gearshape")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)

                Text("localNetworkGate.openSettingsHint")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .center)
            }
        }
    }

    private var instructionsCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("localNetworkGate.howTo")
                .font(.headline)

            VStack(alignment: .leading, spacing: 10) {
                instructionRow(
                    iconName: "wifi",
                    text: String(localized: "localNetworkGate.instruction1")
                )
                instructionRow(
                    iconName: "lock.open",
                    text: String(localized: "localNetworkGate.instruction2")
                )
                instructionRow(
                    iconName: "checkmark.circle",
                    text: String(localized: "localNetworkGate.instruction3")
                )
            }
        }
        .padding(18)
        .background(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(Color(.secondarySystemGroupedBackground))
        )
    }

    private func instructionRow(iconName: String, text: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: iconName)
                .foregroundStyle(.secondary)
                .frame(width: 18)
            Text(text)
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

}

#Preview {
    LocalNetworkPermissionGateView()
        .environmentObject(LocalNetworkPermissionController())
        .environmentObject(BindingStore())
        .environmentObject(RelayEnvironmentStore())
}
