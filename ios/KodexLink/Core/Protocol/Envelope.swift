import Foundation

struct EnvelopeHeader: Decodable {
    let id: String
    let type: String
    let bindingId: String?
    let createdAt: Int
    let requiresAck: Bool
    let protocolVersion: Int
    let idempotencyKey: String?
    let traceId: String?
}

struct Envelope<Payload: Codable>: Codable {
    let id: String
    let type: String
    let bindingId: String?
    let createdAt: Int
    let requiresAck: Bool
    let protocolVersion: Int
    let idempotencyKey: String?
    let traceId: String?
    let payload: Payload
}
