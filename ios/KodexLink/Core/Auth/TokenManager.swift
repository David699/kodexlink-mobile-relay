import Foundation
import Combine

@MainActor
final class TokenManager: ObservableObject {
    @Published private(set) var mobileDeviceId: String?
    @Published private(set) var accessToken: String?
    @Published private(set) var refreshToken: String?
    @Published private(set) var accessExpiresAt: Int?
    @Published private(set) var refreshExpiresAt: Int?

    var deviceToken: String? {
        accessToken
    }

    private let userDefaults: UserDefaults
    private let credentialStore: TokenCredentialStore
    private let installationStore: AppInstallationStore
    private let deviceIdKey = "codex_mobile.mobile_device_id"
    private let accessTokenKey = "codex_mobile.access_token"
    private let refreshTokenKey = "codex_mobile.refresh_token"
    private let accessExpiresAtKey = "codex_mobile.access_expires_at"
    private let refreshExpiresAtKey = "codex_mobile.refresh_expires_at"

    init(
        userDefaults: UserDefaults = .standard,
        credentialStore: TokenCredentialStore = KeychainTokenStore(),
        installationStore: AppInstallationStore? = nil
    ) {
        self.userDefaults = userDefaults
        self.credentialStore = credentialStore
        self.installationStore = installationStore ?? AppInstallationStore(userDefaults: userDefaults)

        let initialBundle = loadPersistedBundle()
        apply(bundle: initialBundle)
        DiagnosticsLogger.info(
            "TokenManager",
            "load_token_bundle",
            metadata: DiagnosticsLogger.metadata([
                "deviceId": mobileDeviceId,
                "hasAccessToken": accessToken == nil ? "false" : "true",
                "hasRefreshToken": refreshToken == nil ? "false" : "true",
                "accessExpiresAt": accessExpiresAt.map(String.init),
                "refreshExpiresAt": refreshExpiresAt.map(String.init)
            ])
        )
    }

    func update(bundle: DeviceTokenBundle) {
        apply(bundle: bundle)
        persist(bundle: bundle)
        DiagnosticsLogger.info(
            "TokenManager",
            "update_token_bundle",
            metadata: DiagnosticsLogger.metadata([
                "deviceId": bundle.deviceId,
                "accessExpiresAt": String(bundle.accessExpiresAt),
                "refreshExpiresAt": String(bundle.refreshExpiresAt)
            ])
        )
    }

    func shouldRefresh(now: Date = Date(), leewaySeconds: Int = 300) -> Bool {
        guard let accessExpiresAt else {
            return false
        }

        let nowSeconds = Int(now.timeIntervalSince1970)
        return accessExpiresAt <= nowSeconds + leewaySeconds
    }

    func canRefresh(now: Date = Date()) -> Bool {
        guard let refreshToken, !refreshToken.isEmpty, let refreshExpiresAt else {
            return false
        }

        return refreshExpiresAt > Int(now.timeIntervalSince1970)
    }

    func currentBundle() -> DeviceTokenBundle? {
        guard let mobileDeviceId,
              let accessToken,
              let refreshToken,
              let accessExpiresAt,
              let refreshExpiresAt else {
            return nil
        }

        return DeviceTokenBundle(
            deviceId: mobileDeviceId,
            accessToken: accessToken,
            refreshToken: refreshToken,
            accessExpiresAt: accessExpiresAt,
            refreshExpiresAt: refreshExpiresAt
        )
    }

    func clear() {
        apply(bundle: nil)

        do {
            try credentialStore.clearBundle()
        } catch {
            DiagnosticsLogger.warning(
                "TokenManager",
                "clear_keychain_token_bundle_failed",
                metadata: DiagnosticsLogger.metadata([
                    "error": error.localizedDescription
                ])
            )
        }

        clearLegacyBundle()
        DiagnosticsLogger.info("TokenManager", "clear_token_bundle")
    }

    private func loadPersistedBundle() -> DeviceTokenBundle? {
        let legacyBundle = loadLegacyBundle()
        let hasInstallationMarker = installationStore.hasInstallationMarker

        defer {
            installationStore.markInstalledIfNeeded()
        }

        if !hasInstallationMarker {
            if let legacyBundle {
                let migratedBundle = migrateLegacyBundleToCredentialStore(legacyBundle)
                return migratedBundle
            }

            resetPersistedCredentialsForFreshInstall()
            return nil
        }

        let keychainBundle = loadKeychainBundle()
        if let keychainBundle {
            if legacyBundle != nil {
                clearLegacyBundle()
            }
            return keychainBundle
        }

        if let legacyBundle {
            return migrateLegacyBundleToCredentialStore(legacyBundle)
        }

        return nil
    }

    private func loadKeychainBundle() -> DeviceTokenBundle? {
        do {
            return try credentialStore.loadBundle()
        } catch {
            DiagnosticsLogger.warning(
                "TokenManager",
                "load_keychain_token_bundle_failed",
                metadata: DiagnosticsLogger.metadata([
                    "error": error.localizedDescription
                ])
            )
            return nil
        }
    }

    private func migrateLegacyBundleToCredentialStore(_ bundle: DeviceTokenBundle) -> DeviceTokenBundle {
        do {
            try credentialStore.saveBundle(bundle)
            clearLegacyBundle()
            DiagnosticsLogger.info(
                "TokenManager",
                "migrate_legacy_token_bundle_to_keychain",
                metadata: DiagnosticsLogger.metadata([
                    "deviceId": bundle.deviceId,
                    "accessExpiresAt": String(bundle.accessExpiresAt),
                    "refreshExpiresAt": String(bundle.refreshExpiresAt)
                ])
            )
            return bundle
        } catch {
            DiagnosticsLogger.warning(
                "TokenManager",
                "migrate_legacy_token_bundle_to_keychain_failed",
                metadata: DiagnosticsLogger.metadata([
                    "deviceId": bundle.deviceId,
                    "error": error.localizedDescription
                ])
            )
            return bundle
        }
    }

    private func resetPersistedCredentialsForFreshInstall() {
        do {
            try credentialStore.clearBundle()
            DiagnosticsLogger.info("TokenManager", "reset_token_bundle_for_fresh_install")
        } catch {
            DiagnosticsLogger.warning(
                "TokenManager",
                "reset_token_bundle_for_fresh_install_failed",
                metadata: DiagnosticsLogger.metadata([
                    "error": error.localizedDescription
                ])
            )
        }

        clearLegacyBundle()
    }

    private func persist(bundle: DeviceTokenBundle) {
        do {
            try credentialStore.saveBundle(bundle)
            clearLegacyBundle()
        } catch {
            persistLegacyBundle(bundle)
            DiagnosticsLogger.warning(
                "TokenManager",
                "persist_keychain_token_bundle_failed_fallback_legacy",
                metadata: DiagnosticsLogger.metadata([
                    "deviceId": bundle.deviceId,
                    "error": error.localizedDescription
                ])
            )
        }
    }

    private func apply(bundle: DeviceTokenBundle?) {
        mobileDeviceId = bundle?.deviceId
        accessToken = bundle?.accessToken
        refreshToken = bundle?.refreshToken
        accessExpiresAt = bundle?.accessExpiresAt
        refreshExpiresAt = bundle?.refreshExpiresAt
    }

    private func loadLegacyBundle() -> DeviceTokenBundle? {
        let deviceId = userDefaults.string(forKey: deviceIdKey)
        let accessToken = userDefaults.string(forKey: accessTokenKey)
        let refreshToken = userDefaults.string(forKey: refreshTokenKey)
        let accessExpiry = (userDefaults.object(forKey: accessExpiresAtKey) as? NSNumber)?.intValue
        let refreshExpiry = (userDefaults.object(forKey: refreshExpiresAtKey) as? NSNumber)?.intValue

        let hasAnyLegacyValue =
            deviceId != nil ||
            accessToken != nil ||
            refreshToken != nil ||
            accessExpiry != nil ||
            refreshExpiry != nil

        guard let deviceId,
              let accessToken,
              let refreshToken,
              let accessExpiry,
              let refreshExpiry else {
            if hasAnyLegacyValue {
                DiagnosticsLogger.warning("TokenManager", "load_legacy_token_bundle_incomplete")
            }
            return nil
        }

        return DeviceTokenBundle(
            deviceId: deviceId,
            accessToken: accessToken,
            refreshToken: refreshToken,
            accessExpiresAt: accessExpiry,
            refreshExpiresAt: refreshExpiry
        )
    }

    private func persistLegacyBundle(_ bundle: DeviceTokenBundle) {
        userDefaults.set(bundle.deviceId, forKey: deviceIdKey)
        userDefaults.set(bundle.accessToken, forKey: accessTokenKey)
        userDefaults.set(bundle.refreshToken, forKey: refreshTokenKey)
        userDefaults.set(bundle.accessExpiresAt, forKey: accessExpiresAtKey)
        userDefaults.set(bundle.refreshExpiresAt, forKey: refreshExpiresAtKey)
    }

    private func clearLegacyBundle() {
        userDefaults.removeObject(forKey: deviceIdKey)
        userDefaults.removeObject(forKey: accessTokenKey)
        userDefaults.removeObject(forKey: refreshTokenKey)
        userDefaults.removeObject(forKey: accessExpiresAtKey)
        userDefaults.removeObject(forKey: refreshExpiresAtKey)
    }
}
