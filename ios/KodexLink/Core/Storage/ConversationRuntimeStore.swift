import Foundation

@MainActor
final class ConversationRuntimeStore {
    static let shared = ConversationRuntimeStore()

    private let userDefaults: UserDefaults
    private let storageKey = "codex_mobile.conversation_runtime"

    init(userDefaults: UserDefaults = .standard) {
        self.userDefaults = userDefaults
    }

    func snapshot(for threadId: String) -> ConversationRuntimeSnapshot? {
        loadSnapshots()[threadId]
    }

    func save(_ snapshot: ConversationRuntimeSnapshot) {
        var snapshots = loadSnapshots()
        snapshots[snapshot.threadId] = snapshot
        persistSnapshots(snapshots)
    }

    func removeSnapshot(for threadId: String) {
        var snapshots = loadSnapshots()
        snapshots.removeValue(forKey: threadId)
        persistSnapshots(snapshots)
        DiagnosticsLogger.info(
            "ConversationRuntimeStore",
            "remove_snapshot",
            metadata: DiagnosticsLogger.metadata([
                "threadId": threadId
            ])
        )
    }

    private func loadSnapshots() -> [String: ConversationRuntimeSnapshot] {
        guard let data = userDefaults.data(forKey: storageKey) else {
            return [:]
        }

        do {
            return try JSONDecoder().decode([String: ConversationRuntimeSnapshot].self, from: data)
        } catch {
            DiagnosticsLogger.warning(
                "ConversationRuntimeStore",
                "load_snapshots_failed",
                metadata: DiagnosticsLogger.metadata([
                    "error": error.localizedDescription
                ])
            )
            return [:]
        }
    }

    private func persistSnapshots(_ snapshots: [String: ConversationRuntimeSnapshot]) {
        if snapshots.isEmpty {
            userDefaults.removeObject(forKey: storageKey)
            return
        }

        guard let data = try? JSONEncoder().encode(snapshots) else {
            DiagnosticsLogger.warning(
                "ConversationRuntimeStore",
                "persist_snapshots_encode_failed",
                metadata: DiagnosticsLogger.metadata([
                    "count": String(snapshots.count)
                ])
            )
            return
        }

        userDefaults.set(data, forKey: storageKey)
    }
}
