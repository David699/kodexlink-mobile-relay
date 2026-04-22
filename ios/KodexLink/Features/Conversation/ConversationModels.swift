import Foundation

struct ConversationMessage: Identifiable, Equatable, Codable {
    let id: String
    let role: ThreadMessageRole
    var text: String
    let turnId: String?
    let createdAt: Date?

    init(id: String, role: ThreadMessageRole, text: String, turnId: String?, createdAt: Date?) {
        self.id = id
        self.role = role
        self.text = text
        self.turnId = turnId
        self.createdAt = createdAt
    }

    init(threadMessage: ThreadMessage) {
        self.init(
            id: threadMessage.id,
            role: threadMessage.role,
            text: threadMessage.text,
            turnId: threadMessage.turnId,
            createdAt: threadMessage.createdAtDate
        )
    }

    init?(threadTimelineItem: ThreadTimelineItem, createdAt: Date?) {
        switch threadTimelineItem.type {
        case .userMessage:
            guard let text = threadTimelineItem.text else {
                return nil
            }
            self.init(
                id: threadTimelineItem.id,
                role: .user,
                text: text,
                turnId: threadTimelineItem.turnId,
                createdAt: createdAt
            )
        case .assistantMessage:
            guard let text = threadTimelineItem.text else {
                return nil
            }
            self.init(
                id: threadTimelineItem.id,
                role: .assistant,
                text: text,
                turnId: threadTimelineItem.turnId,
                createdAt: createdAt
            )
        case .commandExecution, .fileChange:
            return nil
        }
    }
}

enum CommandOutputState: String, Codable {
    case running
    case waitingApproval = "waiting_approval"
    case completed
    case interrupted
    case failed
}

struct CommandOutputPanel: Identifiable, Equatable, Codable {
    let id: String
    let itemId: String
    let turnId: String
    let title: String
    let text: String
    let state: CommandOutputState
    let detail: String?
    let createdAt: Date?

    init(
        id: String,
        itemId: String,
        turnId: String,
        title: String,
        text: String,
        state: CommandOutputState,
        detail: String? = nil,
        createdAt: Date? = nil
    ) {
        self.id = id
        self.itemId = itemId
        self.turnId = turnId
        self.title = title
        self.text = text
        self.state = state
        self.detail = detail
        self.createdAt = createdAt
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case itemId
        case turnId
        case title
        case text
        case state
        case detail
        case createdAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let id = try container.decode(String.self, forKey: .id)
        self.id = id
        itemId = try container.decodeIfPresent(String.self, forKey: .itemId) ?? id
        turnId = try container.decode(String.self, forKey: .turnId)
        title = try container.decode(String.self, forKey: .title)
        text = try container.decode(String.self, forKey: .text)
        state = try container.decodeIfPresent(CommandOutputState.self, forKey: .state) ?? .running
        detail = try container.decodeIfPresent(String.self, forKey: .detail)
        createdAt = try container.decodeIfPresent(Date.self, forKey: .createdAt)
    }

    init?(threadTimelineItem: ThreadTimelineItem) {
        switch threadTimelineItem.type {
        case .commandExecution:
            self.init(
                id: threadTimelineItem.id,
                itemId: threadTimelineItem.id,
                turnId: threadTimelineItem.turnId,
                title: String(localized: "conversation.executionOutput"),
                text: threadTimelineItem.aggregatedOutput ?? "",
                state: CommandOutputPanel.state(from: threadTimelineItem.status),
                detail: threadTimelineItem.command,
                createdAt: threadTimelineItem.createdAtDate
            )
        case .fileChange:
            self.init(
                id: threadTimelineItem.id,
                itemId: threadTimelineItem.id,
                turnId: threadTimelineItem.turnId,
                title: String(localized: "conversation.fileChangeOutput"),
                text: threadTimelineItem.aggregatedOutput ?? "",
                state: CommandOutputPanel.state(from: threadTimelineItem.status),
                detail: nil,
                createdAt: threadTimelineItem.createdAtDate
            )
        case .userMessage, .assistantMessage:
            return nil
        }
    }

    private static func state(from status: String?) -> CommandOutputState {
        switch status {
        case "in_progress", "running", "started":
            return .running
        case "waiting_approval":
            return .waitingApproval
        case "interrupted":
            return .interrupted
        case "failed":
            return .failed
        default:
            return .completed
        }
    }
}

struct ApprovalCardModel: Identifiable, Equatable, Codable {
    let id: String
    let approvalId: String
    let threadId: String
    let turnId: String
    let kind: ApprovalKind
    let title: String
    let summary: String
    let reason: String?
    let command: String?
    let cwd: String?
    let aggregatedOutput: String?
    let grantRoot: String?
}

struct QueuedDraftModel: Identifiable, Equatable, Codable {
    let id: String
    let text: String
}

struct PendingImageAttachment: Identifiable, Equatable {
    let id: String
    let dataURL: String
    let bytes: Int
    let width: Int
    let height: Int
}

enum ConversationRow: Identifiable, Equatable {
    case message(ConversationMessage)
    case commandOutput(CommandOutputPanel)
    case approval(ApprovalCardModel)
    case queuedDraft(QueuedDraftModel)

    var id: String {
        switch self {
        case .message(let message):
            return "message-\(message.id)"
        case .commandOutput(let output):
            return "output-\(output.id)"
        case .approval(let approval):
            return "approval-\(approval.id)"
        case .queuedDraft(let queuedDraft):
            return "queued-\(queuedDraft.id)"
        }
    }
}

struct ConversationRuntimeSnapshot: Codable {
    let threadId: String
    let turnStatus: TurnStatusValue?
    let statusDetail: String?
    let activeTurnId: String?
    let commandOutputs: [CommandOutputPanel]
    let orderedItemIds: [String]
    let activeApproval: ApprovalCardModel?
    let queuedDraft: QueuedDraftModel?
    let turnStartedAt: Date?
    let lastVisibleActivityAt: Date?

    init(
        threadId: String,
        turnStatus: TurnStatusValue?,
        statusDetail: String?,
        activeTurnId: String?,
        commandOutputs: [CommandOutputPanel],
        orderedItemIds: [String],
        activeApproval: ApprovalCardModel?,
        queuedDraft: QueuedDraftModel?,
        turnStartedAt: Date?,
        lastVisibleActivityAt: Date?
    ) {
        self.threadId = threadId
        self.turnStatus = turnStatus
        self.statusDetail = statusDetail
        self.activeTurnId = activeTurnId
        self.commandOutputs = commandOutputs
        self.orderedItemIds = orderedItemIds
        self.activeApproval = activeApproval
        self.queuedDraft = queuedDraft
        self.turnStartedAt = turnStartedAt
        self.lastVisibleActivityAt = lastVisibleActivityAt
    }

    private enum CodingKeys: String, CodingKey {
        case threadId
        case turnStatus
        case statusDetail
        case activeTurnId
        case commandOutputs
        case orderedItemIds
        case activeCommandOutput
        case activeApproval
        case queuedDraft
        case turnStartedAt
        case lastVisibleActivityAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        threadId = try container.decode(String.self, forKey: .threadId)
        turnStatus = try container.decodeIfPresent(TurnStatusValue.self, forKey: .turnStatus)
        statusDetail = try container.decodeIfPresent(String.self, forKey: .statusDetail)
        activeTurnId = try container.decodeIfPresent(String.self, forKey: .activeTurnId)
        if let commandOutputs = try container.decodeIfPresent([CommandOutputPanel].self, forKey: .commandOutputs) {
            self.commandOutputs = commandOutputs
        } else if let legacyOutput = try container.decodeIfPresent(CommandOutputPanel.self, forKey: .activeCommandOutput) {
            commandOutputs = [legacyOutput]
        } else {
            commandOutputs = []
        }
        orderedItemIds = try container.decodeIfPresent([String].self, forKey: .orderedItemIds) ?? []
        activeApproval = try container.decodeIfPresent(ApprovalCardModel.self, forKey: .activeApproval)
        queuedDraft = try container.decodeIfPresent(QueuedDraftModel.self, forKey: .queuedDraft)
        turnStartedAt = try container.decodeIfPresent(Date.self, forKey: .turnStartedAt)
        lastVisibleActivityAt = try container.decodeIfPresent(Date.self, forKey: .lastVisibleActivityAt)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(threadId, forKey: .threadId)
        try container.encodeIfPresent(turnStatus, forKey: .turnStatus)
        try container.encodeIfPresent(statusDetail, forKey: .statusDetail)
        try container.encodeIfPresent(activeTurnId, forKey: .activeTurnId)
        try container.encode(commandOutputs, forKey: .commandOutputs)
        try container.encode(orderedItemIds, forKey: .orderedItemIds)
        try container.encodeIfPresent(activeApproval, forKey: .activeApproval)
        try container.encodeIfPresent(queuedDraft, forKey: .queuedDraft)
        try container.encodeIfPresent(turnStartedAt, forKey: .turnStartedAt)
        try container.encodeIfPresent(lastVisibleActivityAt, forKey: .lastVisibleActivityAt)
    }
}

extension ThreadTimelineItem {
    var createdAtDate: Date? {
        guard let createdAt else {
            return nil
        }

        return Date(timeIntervalSince1970: TimeInterval(createdAt))
    }
}
