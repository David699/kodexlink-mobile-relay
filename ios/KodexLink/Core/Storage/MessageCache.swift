import Foundation

struct CachedMessage: Codable, Identifiable {
    let id: String
    let payload: Data
}

final class MessageCache {
    private(set) var messages: [CachedMessage] = []
}

