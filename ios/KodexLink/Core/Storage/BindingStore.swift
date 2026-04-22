import Foundation
import Combine

struct BindingRecord: Codable, Identifiable {
    let id: String
    let agentId: String
    let agentName: String
    let relayBaseURL: String
    let isDefault: Bool
}

@MainActor
final class BindingStore: ObservableObject {
    @Published private(set) var bindings: [BindingRecord] = []
    @Published private(set) var preferredBindingId: String?

    private let userDefaults: UserDefaults
    private let storageKey = "codex_mobile.bindings"
    private let preferredBindingIdKey = "codex_mobile.preferred_binding_id"

    init(userDefaults: UserDefaults = .standard) {
        self.userDefaults = userDefaults
        preferredBindingId = userDefaults.string(forKey: preferredBindingIdKey)
        loadBindings()
    }

    var defaultBinding: BindingRecord? {
        if let preferredBindingId,
           let preferredBinding = binding(for: preferredBindingId) {
            return preferredBinding
        }

        return bindings.first(where: \.isDefault) ?? bindings.first
    }

    func binding(for bindingId: String) -> BindingRecord? {
        bindings.first { $0.id == bindingId }
    }

    func replaceBindings(_ bindings: [BindingRecord]) {
        self.bindings = bindings
        normalizePreferredBinding()
        DiagnosticsLogger.info(
            "BindingStore",
            "replace_bindings",
            metadata: DiagnosticsLogger.metadata([
                "count": String(bindings.count),
                "preferredBindingId": preferredBindingId,
                "defaultBindingId": defaultBinding?.id,
                "defaultAgentId": defaultBinding?.agentId
            ])
        )
        persistBindings()
        persistPreferredBindingId()
    }

    func setPreferredBinding(id: String?) {
        guard let id else {
            preferredBindingId = nil
            normalizePreferredBinding()
            persistPreferredBindingId()
            return
        }

        guard binding(for: id) != nil else {
            return
        }

        preferredBindingId = id
        persistPreferredBindingId()
        DiagnosticsLogger.info(
            "BindingStore",
            "set_preferred_binding",
            metadata: DiagnosticsLogger.metadata([
                "preferredBindingId": id,
                "preferredAgentId": binding(for: id)?.agentId
            ])
        )
    }

    func clear() {
        bindings = []
        preferredBindingId = nil
        userDefaults.removeObject(forKey: storageKey)
        userDefaults.removeObject(forKey: preferredBindingIdKey)
        DiagnosticsLogger.info("BindingStore", "clear_bindings")
    }

    private func loadBindings() {
        guard let data = userDefaults.data(forKey: storageKey) else {
            bindings = []
            DiagnosticsLogger.debug("BindingStore", "load_bindings_empty")
            return
        }

        do {
            bindings = try JSONDecoder().decode([BindingRecord].self, from: data)
            normalizePreferredBinding()
            DiagnosticsLogger.info(
                "BindingStore",
                "load_bindings_success",
                metadata: DiagnosticsLogger.metadata([
                    "count": String(bindings.count),
                    "preferredBindingId": preferredBindingId,
                    "defaultBindingId": defaultBinding?.id
                ])
            )
        } catch {
            bindings = []
            preferredBindingId = nil
            DiagnosticsLogger.warning(
                "BindingStore",
                "load_bindings_failed",
                metadata: DiagnosticsLogger.metadata([
                    "error": error.localizedDescription
                ])
            )
        }
    }

    private func persistBindings() {
        guard let data = try? JSONEncoder().encode(bindings) else {
            return
        }

        userDefaults.set(data, forKey: storageKey)
    }

    private func normalizePreferredBinding() {
        if bindings.isEmpty {
            preferredBindingId = nil
            return
        }

        if let preferredBindingId,
           binding(for: preferredBindingId) != nil {
            return
        }

        preferredBindingId = bindings.first(where: \.isDefault)?.id ?? bindings.first?.id
    }

    private func persistPreferredBindingId() {
        if let preferredBindingId {
            userDefaults.set(preferredBindingId, forKey: preferredBindingIdKey)
        } else {
            userDefaults.removeObject(forKey: preferredBindingIdKey)
        }
    }
}
