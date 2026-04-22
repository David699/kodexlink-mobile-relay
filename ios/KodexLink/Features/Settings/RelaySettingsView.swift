import SwiftUI

struct RelaySettingsView: View {
    @EnvironmentObject private var relayEnvironmentStore: RelayEnvironmentStore
    @EnvironmentObject private var bindingStore: BindingStore
    @EnvironmentObject private var tokenManager: TokenManager
    @EnvironmentObject private var relayConnection: RelayConnection

    @State private var selectedMode: RelayEnvironmentMode = .bindingDefault
    @State private var customRelayBaseURL = ""
    @State private var infoMessage: String?
    @State private var errorMessage: String?

    var body: some View {
        List {
            Section {
                ForEach(RelayEnvironmentMode.allCases) { mode in
                    Button {
                        select(mode)
                    } label: {
                        RelayEnvironmentRow(
                            mode: mode,
                            isSelected: selectedMode == mode
                        )
                    }
                    .buttonStyle(.plain)
                }

                if selectedMode == .custom {
                    VStack(alignment: .leading, spacing: 12) {
                        TextField(
                            "https://relay.example.com",
                            text: $customRelayBaseURL
                        )
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        .autocorrectionDisabled()

                        Button {
                            applyCustomRelay()
                        } label: {
                            Label("relaySettings.saveCustom", systemImage: "checkmark.circle.fill")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                    }
                    .padding(.vertical, 4)
                }
            } header: {
                Text("relaySettings.environment")
            } footer: {
                Text("relaySettings.switchHint")
            }

            Section("relaySettings.activeAddress") {
                Text(
                    relayEnvironmentStore.summaryText(
                        bindingRelayBaseURL: bindingStore.defaultBinding?.relayBaseURL
                    )
                )
                .font(.footnote.monospaced())
                .textSelection(.enabled)
            }

            if let defaultBinding = bindingStore.defaultBinding {
                Section("relaySettings.currentBinding") {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(defaultBinding.agentName)
                            .font(.headline)
                        Text(defaultBinding.relayBaseURL)
                            .font(.caption.monospaced())
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                    }
                }
            }

            if let infoMessage {
                Section {
                    Text(infoMessage)
                        .font(.footnote)
                        .foregroundStyle(.green)
                }
            }

            if let errorMessage {
                Section {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(.red)
                }
            }
        }
        .navigationTitle("relaySettings.title")
        .onAppear {
            selectedMode = relayEnvironmentStore.mode
            customRelayBaseURL = relayEnvironmentStore.customRelayBaseURL
        }
    }

    private func select(_ mode: RelayEnvironmentMode) {
        infoMessage = nil
        errorMessage = nil
        selectedMode = mode

        guard mode != .custom else {
            return
        }

        apply(mode: mode, customRelayBaseURL: customRelayBaseURL)
    }

    private func applyCustomRelay() {
        guard let normalizedRelayBaseURL = RelayEnvironmentStore.normalizeRelayBaseURL(customRelayBaseURL) else {
            errorMessage = String(localized: "relaySettings.invalidCustom")
            return
        }

        customRelayBaseURL = normalizedRelayBaseURL
        apply(mode: .custom, customRelayBaseURL: normalizedRelayBaseURL)
    }

    private func apply(
        mode: RelayEnvironmentMode,
        customRelayBaseURL: String
    ) {
        let defaultBinding = bindingStore.defaultBinding
        relayEnvironmentStore.update(
            mode: mode,
            customRelayBaseURL: customRelayBaseURL
        )

        if relayEnvironmentStore.requiresSessionReset(for: defaultBinding) {
            tokenManager.clear()
            bindingStore.clear()
            relayConnection.clearSession()
            infoMessage = String(localized: "relaySettings.switchedCleared")
            return
        }

        infoMessage = switch mode {
        case .bindingDefault:
            String(localized: "relaySettings.restoredDefault")
        case .hostedRemote:
            String(localized: "relaySettings.switchedRemote")
        case .custom:
            String(localized: "relaySettings.savedCustom")
        }
    }
}

struct RelayEnvironmentStatusCard: View {
    @EnvironmentObject private var relayEnvironmentStore: RelayEnvironmentStore

    let bindingRelayBaseURL: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "network")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(.blue)

                VStack(alignment: .leading, spacing: 4) {
                    Text("relaySettings.cardTitle")
                        .font(.headline)
                    Text(relayEnvironmentStore.mode.title)
                        .font(.subheadline.weight(.semibold))
                    Text(
                        relayEnvironmentStore.summaryText(
                            bindingRelayBaseURL: bindingRelayBaseURL
                        )
                    )
                    .font(.footnote.monospaced())
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                }
            }

            NavigationLink {
                RelaySettingsView()
            } label: {
                Label("relaySettings.configure", systemImage: "slider.horizontal.3")
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.bordered)
        }
        .padding(18)
        .background(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(Color(.secondarySystemGroupedBackground))
        )
    }
}

private struct RelayEnvironmentRow: View {
    let mode: RelayEnvironmentMode
    let isSelected: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(isSelected ? .blue : .secondary)

            VStack(alignment: .leading, spacing: 4) {
                Text(mode.title)
                    .foregroundStyle(.primary)
                Text(mode.description)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            Spacer(minLength: 0)
        }
        .padding(.vertical, 4)
    }
}

#Preview {
    NavigationStack {
        RelaySettingsView()
            .environmentObject(RelayEnvironmentStore())
            .environmentObject(BindingStore())
            .environmentObject(TokenManager())
            .environmentObject(RelayConnection())
    }
}
