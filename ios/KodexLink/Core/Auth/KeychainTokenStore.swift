import Foundation
import Security

final class KeychainTokenStore: TokenCredentialStore {
    private let service: String
    private let account: String
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    init(
        service: String = "com.kodexlink.ios.device-token",
        account: String = "default"
    ) {
        self.service = service
        self.account = account
    }

    func loadBundle() throws -> DeviceTokenBundle? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)

        switch status {
        case errSecSuccess:
            guard let data = item as? Data else {
                throw TokenCredentialStoreError.unexpectedItem
            }

            do {
                return try decoder.decode(DeviceTokenBundle.self, from: data)
            } catch {
                throw TokenCredentialStoreError.decodeFailed(error.localizedDescription)
            }
        case errSecItemNotFound:
            return nil
        default:
            throw TokenCredentialStoreError.unexpectedStatus(status, "Keychain read")
        }
    }

    func saveBundle(_ bundle: DeviceTokenBundle) throws {
        let data: Data
        do {
            data = try encoder.encode(bundle)
        } catch {
            throw TokenCredentialStoreError.encodeFailed
        }

        var addQuery = baseQuery
        addQuery[kSecValueData as String] = data
        addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly

        let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
        if addStatus == errSecDuplicateItem {
            let attributes: [String: Any] = [
                kSecValueData as String: data,
                kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            ]
            let updateStatus = SecItemUpdate(baseQuery as CFDictionary, attributes as CFDictionary)
            guard updateStatus == errSecSuccess else {
                throw TokenCredentialStoreError.unexpectedStatus(updateStatus, "Keychain update")
            }
            return
        }

        guard addStatus == errSecSuccess else {
            throw TokenCredentialStoreError.unexpectedStatus(addStatus, "Keychain save")
        }
    }

    func clearBundle() throws {
        let status = SecItemDelete(baseQuery as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw TokenCredentialStoreError.unexpectedStatus(status, "Keychain delete")
        }
    }

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
    }
}
