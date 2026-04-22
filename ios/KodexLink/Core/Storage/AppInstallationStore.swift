import Foundation

final class AppInstallationStore {
    private let userDefaults: UserDefaults
    private let installationIDKey = "codex_mobile.installation_id"

    init(userDefaults: UserDefaults = .standard) {
        self.userDefaults = userDefaults
    }

    var hasInstallationMarker: Bool {
        guard let value = userDefaults.string(forKey: installationIDKey) else {
            return false
        }

        return !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    func markInstalledIfNeeded() {
        guard !hasInstallationMarker else {
            return
        }

        userDefaults.set(UUID().uuidString, forKey: installationIDKey)
    }
}
