import Foundation

struct RelayHostedConfig: Codable, Equatable {
    let hostedRelayBaseURL: String
    let schemaVersion: Int
    let updatedAt: String?

    private enum CodingKeys: String, CodingKey {
        case hostedRelayBaseURL
        case defaultRelayBaseURL
        case schemaVersion
        case updatedAt
    }

    init(
        hostedRelayBaseURL: String,
        schemaVersion: Int = 1,
        updatedAt: String? = nil
    ) {
        self.hostedRelayBaseURL = hostedRelayBaseURL
        self.schemaVersion = schemaVersion
        self.updatedAt = updatedAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        guard let hostedRelayBaseURL =
            try container.decodeIfPresent(String.self, forKey: .hostedRelayBaseURL) ??
            container.decodeIfPresent(String.self, forKey: .defaultRelayBaseURL) else {
            throw DecodingError.keyNotFound(
                CodingKeys.hostedRelayBaseURL,
                DecodingError.Context(
                    codingPath: decoder.codingPath,
                    debugDescription: "Missing hosted relay base URL."
                )
            )
        }

        self.hostedRelayBaseURL = hostedRelayBaseURL
        schemaVersion = try container.decodeIfPresent(Int.self, forKey: .schemaVersion) ?? 1
        updatedAt = try container.decodeIfPresent(String.self, forKey: .updatedAt)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(hostedRelayBaseURL, forKey: .hostedRelayBaseURL)
        try container.encode(schemaVersion, forKey: .schemaVersion)
        try container.encodeIfPresent(updatedAt, forKey: .updatedAt)
    }
}

enum RelayHostedConfigStoreError: LocalizedError {
    case remoteConfigURLMissing
    case invalidResponseStatus(Int)
    case invalidHostedRelayBaseURL

    var errorDescription: String? {
        switch self {
        case .remoteConfigURLMissing:
            return "Missing RelayRemoteConfigURL."
        case let .invalidResponseStatus(statusCode):
            return "Unexpected HTTP status code: \(statusCode)."
        case .invalidHostedRelayBaseURL:
            return "Invalid hosted relay base URL in remote config."
        }
    }
}

struct RelayHostedConfigStore {
    private enum Constants {
        static let cacheKey = "codex_mobile.hosted_relay_config_payload"
        static let remoteConfigURLInfoPlistKey = "RelayRemoteConfigURL"
        static let bundledDefaultConfigName = "RelayHostedConfigDefault"
        static let bundledFallbackHostedRelayBaseURL = "https://relay.example.com"
    }

    private let userDefaults: UserDefaults
    private let session: URLSession
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

    init(userDefaults: UserDefaults = .standard, session: URLSession = .shared) {
        self.userDefaults = userDefaults
        self.session = session
    }

    func currentHostedRelayBaseURL() -> String {
        cachedConfig()?.hostedRelayBaseURL ??
            bundledConfig()?.hostedRelayBaseURL ??
            Constants.bundledFallbackHostedRelayBaseURL
    }

    func fetchRemoteConfig() async throws -> RelayHostedConfig {
        guard let remoteConfigURL = remoteConfigURL() else {
            throw RelayHostedConfigStoreError.remoteConfigURLMissing
        }

        let (data, response) = try await session.data(from: remoteConfigURL)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw RelayHostedConfigStoreError.invalidResponseStatus(-1)
        }
        guard (200 ... 299).contains(httpResponse.statusCode) else {
            throw RelayHostedConfigStoreError.invalidResponseStatus(httpResponse.statusCode)
        }

        let config = try decodeConfig(from: data)
        persist(config)
        return config
    }

    private func remoteConfigURL() -> URL? {
        guard let rawValue = Bundle.main.infoDictionary?[Constants.remoteConfigURLInfoPlistKey] as? String else {
            return nil
        }

        let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              let url = URL(string: trimmed),
              let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https" else {
            return nil
        }

        return url
    }

    private func bundledConfig() -> RelayHostedConfig? {
        guard let url = Bundle.main.url(forResource: Constants.bundledDefaultConfigName, withExtension: "json"),
              let data = try? Data(contentsOf: url) else {
            return nil
        }

        return try? decodeConfig(from: data)
    }

    private func cachedConfig() -> RelayHostedConfig? {
        guard let data = userDefaults.data(forKey: Constants.cacheKey) else {
            return nil
        }

        return try? decodeConfig(from: data)
    }

    private func decodeConfig(from data: Data) throws -> RelayHostedConfig {
        let config = try decoder.decode(RelayHostedConfig.self, from: data)
        guard let normalizedRelayBaseURL = RelayEnvironmentStore.normalizeRelayBaseURL(config.hostedRelayBaseURL) else {
            throw RelayHostedConfigStoreError.invalidHostedRelayBaseURL
        }

        return RelayHostedConfig(
            hostedRelayBaseURL: normalizedRelayBaseURL,
            schemaVersion: config.schemaVersion,
            updatedAt: config.updatedAt
        )
    }

    private func persist(_ config: RelayHostedConfig) {
        guard let encoded = try? encoder.encode(config) else {
            return
        }

        userDefaults.set(encoded, forKey: Constants.cacheKey)
    }
}
