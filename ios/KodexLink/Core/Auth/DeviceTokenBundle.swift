import Foundation

struct DeviceTokenBundle: Codable, Equatable {
    let deviceId: String
    let accessToken: String
    let refreshToken: String
    let accessExpiresAt: Int
    let refreshExpiresAt: Int
}
