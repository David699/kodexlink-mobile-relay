import Foundation
import Combine

enum RelayEnvironmentMode: String, CaseIterable, Codable, Identifiable {
    case bindingDefault = "binding_default"
    case hostedRemote = "hosted_remote"
    case custom

    var id: String {
        rawValue
    }

    var title: String {
        switch self {
        case .bindingDefault:
            return NSLocalizedString("relayEnv.bindingDefault", comment: "")
        case .hostedRemote:
            return NSLocalizedString("relayEnv.hostedRemote", comment: "")
        case .custom:
            return NSLocalizedString("relayEnv.custom", comment: "")
        }
    }

    var description: String {
        switch self {
        case .bindingDefault:
            return NSLocalizedString("relayEnv.bindingDefault.desc", comment: "")
        case .hostedRemote:
            return NSLocalizedString("relayEnv.hostedRemote.desc", comment: "")
        case .custom:
            return NSLocalizedString("relayEnv.custom.desc", comment: "")
        }
    }
}

@MainActor
final class RelayEnvironmentStore: ObservableObject {
    @Published private(set) var mode: RelayEnvironmentMode
    @Published private(set) var customRelayBaseURL: String
    @Published private(set) var hostedRelayBaseURL: String

    private let userDefaults: UserDefaults
    private let hostedConfigStore: RelayHostedConfigStore
    private let modeKey = "codex_mobile.relay_environment_mode"
    private let customRelayBaseURLKey = "codex_mobile.custom_relay_base_url"

    init(
        userDefaults: UserDefaults = .standard,
        session: URLSession = .shared
    ) {
        let hostedConfigStore = RelayHostedConfigStore(
            userDefaults: userDefaults,
            session: session
        )
        self.userDefaults = userDefaults
        self.hostedConfigStore = hostedConfigStore
        mode = RelayEnvironmentMode(
            rawValue: userDefaults.string(forKey: modeKey) ?? ""
        ) ?? .bindingDefault
        customRelayBaseURL = userDefaults.string(forKey: customRelayBaseURLKey) ?? ""
        hostedRelayBaseURL = hostedConfigStore.currentHostedRelayBaseURL()
    }

    var preferredRelayBaseURL: String? {
        switch mode {
        case .bindingDefault:
            return nil
        case .hostedRemote:
            return Self.normalizeRelayBaseURL(hostedRelayBaseURL)
        case .custom:
            return Self.normalizeRelayBaseURL(customRelayBaseURL)
        }
    }

    func resolvedRelayBaseURL(bindingRelayBaseURL: String?) -> String? {
        preferredRelayBaseURL ?? Self.normalizeRelayBaseURL(bindingRelayBaseURL)
    }

    func requiresSessionReset(for binding: BindingRecord?) -> Bool {
        guard let binding,
              let preferredRelayBaseURL else {
            return false
        }

        return Self.normalizeRelayBaseURL(binding.relayBaseURL) != Self.normalizeRelayBaseURL(preferredRelayBaseURL)
    }

    func summaryText(bindingRelayBaseURL: String?) -> String {
        if let resolvedRelayBaseURL = resolvedRelayBaseURL(bindingRelayBaseURL: bindingRelayBaseURL) {
            return resolvedRelayBaseURL
        }

        switch mode {
        case .bindingDefault:
            return NSLocalizedString("relayEnv.awaitingPairing", comment: "")
        case .hostedRemote:
            return hostedRelayBaseURL
        case .custom:
            return NSLocalizedString("relayEnv.enterCustom", comment: "")
        }
    }

    func refreshHostedRelayBaseURL() async {
        do {
            let hostedConfig = try await hostedConfigStore.fetchRemoteConfig()
            guard hostedRelayBaseURL != hostedConfig.hostedRelayBaseURL else {
                DiagnosticsLogger.info(
                    "RelayEnvironmentStore",
                    "refresh_hosted_relay_config_no_change",
                    metadata: DiagnosticsLogger.metadata([
                        "hostedRelayBaseURL": hostedRelayBaseURL
                    ])
                )
                return
            }

            hostedRelayBaseURL = hostedConfig.hostedRelayBaseURL
            DiagnosticsLogger.info(
                "RelayEnvironmentStore",
                "refresh_hosted_relay_config_success",
                metadata: DiagnosticsLogger.metadata([
                    "hostedRelayBaseURL": hostedRelayBaseURL,
                    "schemaVersion": String(hostedConfig.schemaVersion)
                ])
            )
        } catch RelayHostedConfigStoreError.remoteConfigURLMissing {
            DiagnosticsLogger.info(
                "RelayEnvironmentStore",
                "refresh_hosted_relay_config_skipped"
            )
        } catch {
            DiagnosticsLogger.warning(
                "RelayEnvironmentStore",
                "refresh_hosted_relay_config_failed",
                metadata: DiagnosticsLogger.metadata([
                    "error": error.localizedDescription
                ])
            )
        }
    }

    func update(
        mode: RelayEnvironmentMode,
        customRelayBaseURL newCustomRelayBaseURL: String? = nil
    ) {
        self.mode = mode
        if let newCustomRelayBaseURL {
            customRelayBaseURL = newCustomRelayBaseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        persist()
        DiagnosticsLogger.info(
            "RelayEnvironmentStore",
            "update_environment",
            metadata: DiagnosticsLogger.metadata([
                "mode": mode.rawValue,
                "customRelayBaseURL": Self.normalizeRelayBaseURL(customRelayBaseURL)
            ])
        )
    }

    nonisolated static func normalizeRelayBaseURL(_ rawValue: String?) -> String? {
        guard let rawValue else {
            return nil
        }

        let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              var components = URLComponents(string: trimmed),
              let host = components.host else {
            return nil
        }

        switch components.scheme?.lowercased() {
        case "ws":
            components.scheme = "http"
        case "wss":
            components.scheme = "https"
        default:
            break
        }

        guard let scheme = components.scheme?.lowercased(),
              scheme == "http" || scheme == "https" else {
            return nil
        }

        components.host = host.lowercased()
        components.path = ""
        components.query = nil
        components.fragment = nil

        return components.url?.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }

    private func persist() {
        userDefaults.set(mode.rawValue, forKey: modeKey)
        userDefaults.set(customRelayBaseURL, forKey: customRelayBaseURLKey)
    }
}
