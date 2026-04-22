// GENERATED FILE - DO NOT EDIT
// Source: packages/protocol/src/messages.ts
// Run: pnpm protocol:generate:swift

import Foundation

enum ThreadMessageRole: String, Codable, Equatable {
    case user
    case assistant
}

enum ThreadTimelineItemType: String, Codable, Equatable {
    case userMessage = "user_message"
    case assistantMessage = "assistant_message"
    case commandExecution = "command_execution"
    case fileChange = "file_change"
}

enum AgentPresenceStatus: String, Codable, Equatable {
    case online
    case offline
    case degraded
}

enum AgentDegradedReason: String, Codable, Equatable {
    case runtimeUnavailable = "runtime_unavailable"
    case requestFailures = "request_failures"
}

enum TurnStatusValue: String, Codable, Equatable {
    case starting
    case streaming
    case runningCommand = "running_command"
    case waitingApproval = "waiting_approval"
    case interrupting
    case completed
    case interrupted
    case failed
}

enum ExecutionOutputSource: String, Codable, Equatable {
    case commandExecution
    case fileChange
}

enum ApprovalKind: String, Codable, Equatable {
    case commandExecution
    case fileChange
}

enum ApprovalDecision: String, Codable, Equatable {
    case accept
    case decline
    case cancel
}

struct ThreadGitInfo: Codable, Hashable {
    let sha: String?
    let branch: String?
    let originUrl: String?
}

struct ThreadSummary: Codable, Hashable, Identifiable {
    let id: String
    let preview: String
    let modelProvider: String
    let createdAt: Int
    let path: String
    let cwd: String
    let cliVersion: String
    let source: String
    let gitInfo: ThreadGitInfo?
}

struct ThreadListRequestPayload: Codable {
    let limit: Int
    let cursor: String?
}

struct ThreadListResponsePayload: Codable {
    let items: [ThreadSummary]
    let nextCursor: String?
}

struct ThreadMessage: Codable, Identifiable {
    let id: String
    let role: ThreadMessageRole
    let text: String
    let turnId: String?
    let createdAt: Int?
}

struct ThreadResumeRequestPayload: Codable {
    let threadId: String
    let beforeItemId: String?
    let windowSize: Int?
}

struct ThreadResumeResponsePayload: Codable {
    let threadId: String
    let cwd: String
    let messages: [ThreadMessage]
    let timelineItems: [ThreadTimelineItem]?
    let hasMoreBefore: Bool?
}

struct ThreadTimelineItem: Codable {
    let id: String
    let type: ThreadTimelineItemType
    let turnId: String
    let text: String?
    let command: String?
    let cwd: String?
    let aggregatedOutput: String?
    let status: String?
    let createdAt: Int?
}

struct ThreadCreateRequestPayload: Codable {
    let cwd: String?
}

struct ThreadCreateResponsePayload: Codable {
    let thread: ThreadSummary
}

struct ThreadArchiveRequestPayload: Codable {
    let threadId: String
}

struct ThreadArchiveResponsePayload: Codable {
    let threadId: String
}

struct AgentRegisterPayload: Codable {
    let agentId: String
    let runtimeType: String
}

struct ClientRegisterPayload: Codable {
    let clientId: String
}

struct AuthPayload: Codable {
    let deviceType: String
    let deviceId: String
    let deviceToken: String
    let clientVersion: String
    let lastCursor: String?
    let runtimeType: String? = nil
}

struct AuthOkPayload: Codable {
    let deviceType: String
    let deviceId: String
    let protocolVersion: Int
    let serverVersion: String
    let features: [String]
}

struct AgentPresencePayload: Codable {
    let agentId: String
    let status: AgentPresenceStatus
    let reason: AgentDegradedReason?
    let detail: String?
    let consecutiveFailures: Int?
}

struct AgentHealthReportPayload: Codable {
    let status: AgentPresenceStatus
    let reason: AgentDegradedReason?
    let detail: String?
    let consecutiveFailures: Int?
}

struct PresenceSyncRequestPayload: Codable {
}

struct PresenceSyncResponsePayload: Codable {
    let agentId: String
    let status: AgentPresenceStatus
    let reason: AgentDegradedReason?
    let detail: String?
    let consecutiveFailures: Int?
    let updatedAt: Int
}

struct ControlTakeoverRequestPayload: Codable {
}

struct ControlTakeoverResponsePayload: Codable {
    let agentId: String
    let granted: Bool
    let controllerDeviceId: String
}

struct ControlRevokedPayload: Codable {
    let agentId: String
    let takenByDeviceId: String
    let message: String
}

struct ErrorPayload: Codable {
    let code: ErrorCode
    let message: String
}

struct TokenRevokedPayload: Codable {
    let code: ErrorCode
    let message: String
}

struct TurnInputItem: Codable, Equatable {
    let type: String
    let text: String?
    let url: String?

    static func text(_ value: String) -> TurnInputItem {
        TurnInputItem(type: "text", text: value, url: nil)
    }

    static func image(url: String) -> TurnInputItem {
        TurnInputItem(type: "image", text: nil, url: url)
    }
}

struct TurnStartRequestPayload: Codable {
    let threadId: String
    let inputs: [TurnInputItem]
}

struct TurnStatusPayload: Codable {
    let requestId: String
    let threadId: String
    let turnId: String?
    let status: TurnStatusValue
    let detail: String?
    let itemId: String?
}

struct TurnDeltaPayload: Codable {
    let requestId: String
    let threadId: String
    let turnId: String
    let itemId: String?
    let delta: String
}

struct AssistantMessageSegment: Codable {
    let itemId: String
    let text: String
}

struct CommandOutputDeltaPayload: Codable {
    let requestId: String
    let threadId: String
    let turnId: String
    let itemId: String
    let delta: String
    let source: ExecutionOutputSource
}

struct ApprovalRequestedPayload: Codable {
    let requestId: String
    let approvalId: String
    let threadId: String
    let turnId: String
    let itemId: String
    let kind: ApprovalKind
    let reason: String?
    let command: String?
    let cwd: String?
    let aggregatedOutput: String?
    let grantRoot: String?
    let proposedExecpolicyAmendment: [String]?
}

struct ApprovalResolveRequestPayload: Codable {
    let approvalId: String
    let threadId: String
    let turnId: String
    let decision: ApprovalDecision
}

struct ApprovalResolvedPayload: Codable {
    let requestId: String
    let approvalId: String
    let threadId: String
    let turnId: String
    let decision: ApprovalDecision
}

struct TurnInterruptRequestPayload: Codable {
    let threadId: String
    let turnId: String
}

struct TurnInterruptedPayload: Codable {
    let requestId: String
    let threadId: String
    let turnId: String
}

struct TurnCompletedPayload: Codable {
    let requestId: String
    let threadId: String
    let turnId: String
    let status: String
    let text: String
    let segments: [AssistantMessageSegment]?
    let errorMessage: String?
}

struct PingPayload: Codable {
    let ts: Int
}

struct PongPayload: Codable {
    let ts: Int
}

extension ThreadSummary {
    var titleText: String {
        let trimmedPreview = preview.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmedPreview.isEmpty ? cwd : trimmedPreview
    }

    var subtitleText: String {
        cwd
    }

    var createdAtDate: Date {
        Date(timeIntervalSince1970: TimeInterval(createdAt))
    }
}

extension ThreadMessage {
    var createdAtDate: Date? {
        guard let createdAt else {
            return nil
        }

        return Date(timeIntervalSince1970: TimeInterval(createdAt))
    }
}
