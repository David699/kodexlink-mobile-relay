import Foundation

struct DiagnosticsLogEntry: Codable, Identifiable {
    let id: String
    let timestamp: Date
    let level: DiagnosticsLogLevel
    let module: String
    let event: String
    let metadata: [String: String]
}

enum DiagnosticsLogLevel: String, Codable {
    case debug
    case info
    case warning
    case error
}

final class DiagnosticsLogStore {
    static let shared = DiagnosticsLogStore()
    static let storageKey = "codex_mobile.diagnostics_entries"

    private let userDefaults: UserDefaults
    private let queue = DispatchQueue(label: "com.xuwanbiao.kodexlink.diagnostics")
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()
    private let maxEntries: Int
    private var cachedEntries: [DiagnosticsLogEntry]?

    init(userDefaults: UserDefaults = .standard, maxEntries: Int = 600) {
        self.userDefaults = userDefaults
        self.maxEntries = maxEntries
    }

    func append(_ entry: DiagnosticsLogEntry) {
        queue.async {
            var entries = self.loadEntriesLocked()
            entries.append(entry)
            if entries.count > self.maxEntries {
                entries.removeFirst(entries.count - self.maxEntries)
            }
            self.persistLocked(entries)
        }
    }

    func recentEntries(limit: Int = 200) -> [DiagnosticsLogEntry] {
        queue.sync {
            Array(loadEntriesLocked().suffix(max(0, limit)))
        }
    }

    func clear() {
        queue.sync {
            cachedEntries = []
            userDefaults.removeObject(forKey: Self.storageKey)
        }
    }

    private func loadEntriesLocked() -> [DiagnosticsLogEntry] {
        if let cachedEntries {
            return cachedEntries
        }

        guard let data = userDefaults.data(forKey: Self.storageKey) else {
            cachedEntries = []
            return []
        }

        do {
            let entries = try decoder.decode([DiagnosticsLogEntry].self, from: data)
            cachedEntries = entries
            return entries
        } catch {
            cachedEntries = []
            userDefaults.removeObject(forKey: Self.storageKey)
            return []
        }
    }

    private func persistLocked(_ entries: [DiagnosticsLogEntry]) {
        cachedEntries = entries
        guard let data = try? encoder.encode(entries) else {
            return
        }

        userDefaults.set(data, forKey: Self.storageKey)
    }
}
