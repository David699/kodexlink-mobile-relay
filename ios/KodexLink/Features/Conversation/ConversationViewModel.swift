import Foundation

@MainActor
final class ConversationViewModel: ObservableObject {
    private let silenceThreshold: TimeInterval = 8
    private let restoreValidationDelay: TimeInterval = 2
    private let maxImagesPerTurn = 2
    private let displayPageSize = 20
    private let threadResumeWindowSize = 20

    @Published private(set) var rows: [ConversationRow] = []
    @Published private(set) var pendingImageAttachments: [PendingImageAttachment] = []
    @Published private(set) var isProcessingImages = false
    @Published var draft = ""
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var turnStatus: TurnStatusValue?
    @Published var statusDetail: String?
    @Published var activeTurnId: String?
    @Published var isInterrupting = false
    @Published var isResolvingApproval = false

    private var loadedThreadId: String?
    private var baseMessages: [ConversationMessage] = []
    private var currentAssistantPlaceholderId: String?
    private var currentAssistantMessageIdsByItemId: [String: String] = [:]
    private var historicalCommandOutputs: [CommandOutputPanel] = []
    private var commandOutputs: [CommandOutputPanel] = []
    private var orderedItemIds: [String] = []
    private var activeApproval: ApprovalCardModel?
    private var queuedDraft: QueuedDraftModel?
    @Published private(set) var turnStartedAt: Date?
    @Published private(set) var oldestVisibleIndex: Int = 0
    @Published private(set) var hasMoreHistoryBefore = false
    @Published private(set) var isLoadingOlderHistory = false
    private var lastVisibleActivityAt: Date?
    private var baseStatusDetail: String?
    private var pendingInterrupt = false
    private var statusMonitorTask: Task<Void, Never>?
    private var restoreValidationTask: Task<Void, Never>?
    private var restoredStatePendingValidation = false
    private weak var relayConnection: RelayConnection?
    private let runtimeStore: ConversationRuntimeStore

    init(runtimeStore: ConversationRuntimeStore) {
        self.runtimeStore = runtimeStore
    }

    convenience init() {
        self.init(runtimeStore: .shared)
    }

    private func diagnosticsMetadata(_ extra: [String: String?] = [:]) -> [String: String] {
        var metadata = extra
        metadata["loadedThreadId"] = loadedThreadId
        metadata["activeTurnId"] = activeTurnId
        metadata["turnStatus"] = turnStatus?.rawValue
        metadata["rows"] = String(rows.count)
        metadata["baseMessages"] = String(baseMessages.count)
        return DiagnosticsLogger.metadata(metadata)
    }

    private func threadResumeResponseMetadata(
        _ response: ThreadResumeResponsePayload,
        beforeItemId: String? = nil
    ) -> [String: String?] {
        [
            "beforeItemId": beforeItemId,
            "windowSize": String(threadResumeWindowSize),
            "messageCount": String(response.messages.count),
            "timelineItemCount": String(response.timelineItems?.count ?? 0),
            "hasMoreBefore": String(response.hasMoreBefore ?? false),
            "responseWindowKind": (response.timelineItems?.isEmpty ?? true) ? "messages" : "timeline",
            "firstMessageId": response.messages.first?.id,
            "lastMessageId": response.messages.last?.id,
            "firstTimelineItemId": response.timelineItems?.first?.id,
            "lastTimelineItemId": response.timelineItems?.last?.id
        ]
    }

    func loadThread(using relayConnection: RelayConnection, threadId: String) async {
        self.relayConnection = relayConnection
        if loadedThreadId == threadId && !baseMessages.isEmpty {
            DiagnosticsLogger.debug(
                "ConversationRuntime",
                "load_thread_skipped_cached",
                metadata: diagnosticsMetadata([
                    "threadId": threadId
                ])
            )
            return
        }

        isLoading = true
        errorMessage = nil
        DiagnosticsLogger.info(
            "ConversationRuntime",
            "load_thread_start",
            metadata: diagnosticsMetadata([
                "threadId": threadId
            ])
        )

        defer {
            isLoading = false
        }

        do {
            let response = try await relayConnection.requestThreadResume(
                threadId: threadId,
                windowSize: threadResumeWindowSize
            )
            loadedThreadId = response.threadId
            clearTransientState(keepStatus: false)
            replaceConversationHistory(from: response)
            restoreRuntime(for: response.threadId)
            rebuildRows(resetVisibleWindow: true)
            DiagnosticsLogger.info(
                "ConversationRuntime",
                "load_thread_success",
                metadata: diagnosticsMetadata([
                    "threadId": response.threadId
                ].merging(threadResumeResponseMetadata(response)) { _, new in new })
            )
        } catch {
            errorMessage = error.localizedDescription
            DiagnosticsLogger.warning(
                "ConversationRuntime",
                "load_thread_failed",
                metadata: diagnosticsMetadata([
                    "threadId": threadId,
                    "error": error.localizedDescription
                ])
            )
        }
    }

    func refreshAfterReconnect(using relayConnection: RelayConnection, threadId: String) async {
        self.relayConnection = relayConnection
        guard loadedThreadId == threadId || runtimeStore.snapshot(for: threadId) != nil else {
            DiagnosticsLogger.debug(
                "ConversationRuntime",
                "refresh_after_reconnect_skipped",
                metadata: diagnosticsMetadata([
                    "threadId": threadId
                ])
            )
            return
        }

        do {
            DiagnosticsLogger.info(
                "ConversationRuntime",
                "refresh_after_reconnect_start",
                metadata: diagnosticsMetadata([
                    "threadId": threadId
                ])
            )
            let response = try await relayConnection.requestThreadResume(
                threadId: threadId,
                windowSize: threadResumeWindowSize
            )
            loadedThreadId = response.threadId
            clearTransientState(keepStatus: false)
            replaceConversationHistory(from: response)
            restoreRuntime(for: response.threadId)
            errorMessage = nil
            rebuildRows(resetVisibleWindow: true)
            DiagnosticsLogger.info(
                "ConversationRuntime",
                "refresh_after_reconnect_success",
                metadata: diagnosticsMetadata([
                    "threadId": response.threadId
                ].merging(threadResumeResponseMetadata(response)) { _, new in new })
            )
        } catch {
            errorMessage = error.localizedDescription
            DiagnosticsLogger.warning(
                "ConversationRuntime",
                "refresh_after_reconnect_failed",
                metadata: diagnosticsMetadata([
                    "threadId": threadId,
                    "error": error.localizedDescription
                ])
            )
        }
    }

    func send(using relayConnection: RelayConnection, threadId: String) async {
        self.relayConnection = relayConnection
        guard ensureWritable(using: relayConnection) else {
            return
        }
        if isProcessingImages {
            errorMessage = String(localized: "conversation.composer.processingImages")
            DiagnosticsLogger.warning(
                "ConversationRuntime",
                "send_blocked_processing_images",
                metadata: diagnosticsMetadata([
                    "threadId": threadId
                ])
            )
            return
        }

        let trimmedDraft = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        let imageAttachments = pendingImageAttachments

        guard !trimmedDraft.isEmpty || !imageAttachments.isEmpty else {
            DiagnosticsLogger.debug(
                "ConversationRuntime",
                "send_skipped_empty_input",
                metadata: diagnosticsMetadata([
                    "threadId": threadId
                ])
            )
            return
        }

        if isTurnActive {
            if !imageAttachments.isEmpty {
                errorMessage = String(localized: "conversation.composer.activeWithImages")
                DiagnosticsLogger.warning(
                    "ConversationRuntime",
                    "send_blocked_active_turn_with_images",
                    metadata: diagnosticsMetadata([
                        "threadId": threadId
                    ])
                )
                return
            }
            queueDraft(trimmedDraft)
            draft = ""
            return
        }

        let userMessageText = buildUserMessageText(
            text: trimmedDraft,
            imageCount: imageAttachments.count
        )
        let turnInputs = buildTurnInputs(
            text: trimmedDraft,
            attachments: imageAttachments
        )
        await startTurn(
            using: relayConnection,
            threadId: threadId,
            userMessageText: userMessageText,
            turnInputs: turnInputs,
            originalDraft: trimmedDraft,
            originalImages: imageAttachments
        )
    }

    func interrupt(using relayConnection: RelayConnection, threadId: String) async {
        self.relayConnection = relayConnection
        guard isTurnActive, !isInterrupting else {
            return
        }
        guard ensureWritable(using: relayConnection) else {
            return
        }

        isInterrupting = true
        turnStatus = .interrupting
        baseStatusDetail = String(localized: "conversation.status.interrupting")
        refreshStatusDetail()

        guard let activeTurnId else {
            pendingInterrupt = true
            rebuildRows()
            return
        }

        await performInterrupt(using: relayConnection, threadId: threadId, turnId: activeTurnId)
    }

    func approve(using relayConnection: RelayConnection) async {
        self.relayConnection = relayConnection
        await resolveApproval(using: relayConnection, decision: .accept)
    }

    func declineAndContinue(using relayConnection: RelayConnection) async {
        self.relayConnection = relayConnection
        await resolveApproval(using: relayConnection, decision: .decline)
    }

    func cancelCurrentTurn(using relayConnection: RelayConnection) async {
        self.relayConnection = relayConnection
        await resolveApproval(using: relayConnection, decision: .cancel)
    }

    var hasQueuedDraft: Bool {
        queuedDraft != nil
    }

    var remainingImageSlots: Int {
        max(0, maxImagesPerTurn - pendingImageAttachments.count)
    }

    var isTurnActive: Bool {
        if restoredStatePendingValidation {
            return false
        }

        guard let turnStatus else {
            return false
        }

        switch turnStatus {
        case .completed, .failed, .interrupted:
            return false
        default:
            return true
        }
    }

    var visibleRows: [ConversationRow] {
        guard oldestVisibleIndex > 0 else { return rows }
        return Array(rows.dropFirst(oldestVisibleIndex))
    }

    var hasOlderRows: Bool {
        oldestVisibleIndex > 0
    }

    var canLoadOlderRows: Bool {
        hasOlderRows || hasMoreHistoryBefore
    }

    func loadOlderRows(using relayConnection: RelayConnection) async {
        self.relayConnection = relayConnection
        if oldestVisibleIndex > 0 {
            oldestVisibleIndex = max(0, oldestVisibleIndex - displayPageSize)
            return
        }

        guard hasMoreHistoryBefore,
              !isLoading,
              !isLoadingOlderHistory,
              let threadId = loadedThreadId,
              let beforeItemId = earliestLoadedItemId() else {
            DiagnosticsLogger.debug(
                "ConversationRuntime",
                "load_older_history_skipped",
                metadata: diagnosticsMetadata([
                    "threadId": loadedThreadId,
                    "hasMoreHistoryBefore": String(hasMoreHistoryBefore),
                    "isLoading": String(isLoading),
                    "isLoadingOlderHistory": String(isLoadingOlderHistory)
                ])
            )
            return
        }

        isLoadingOlderHistory = true
        defer { isLoadingOlderHistory = false }

        do {
            DiagnosticsLogger.info(
                "ConversationRuntime",
                "load_older_history_start",
                metadata: diagnosticsMetadata([
                    "threadId": threadId,
                    "beforeItemId": beforeItemId,
                    "windowSize": String(threadResumeWindowSize)
                ])
            )
            let response = try await relayConnection.requestThreadResume(
                threadId: threadId,
                beforeItemId: beforeItemId,
                windowSize: threadResumeWindowSize
            )
            mergeConversationHistory(from: response)
            rebuildRows()
            DiagnosticsLogger.info(
                "ConversationRuntime",
                "load_older_history_success",
                metadata: diagnosticsMetadata([
                    "threadId": threadId
                ].merging(threadResumeResponseMetadata(response, beforeItemId: beforeItemId)) { _, new in new })
            )
        } catch {
            errorMessage = error.localizedDescription
            DiagnosticsLogger.warning(
                "ConversationRuntime",
                "load_older_history_failed",
                metadata: diagnosticsMetadata([
                    "threadId": threadId,
                    "beforeItemId": beforeItemId,
                    "error": error.localizedDescription
                ])
            )
        }
    }

    func addImageDataItems(_ dataItems: [Data]) async {
        guard !dataItems.isEmpty else {
            return
        }

        if isProcessingImages {
            return
        }

        guard !isTurnActive else {
            errorMessage = String(localized: "conversation.composer.activeWithImages")
            return
        }

        let availableSlots = remainingImageSlots
        guard availableSlots > 0 else {
            errorMessage = String(localized: "conversation.maxImages")
            return
        }

        let selectedItems = Array(dataItems.prefix(availableSlots))
        var preparedAttachments: [PendingImageAttachment] = []
        isProcessingImages = true
        defer { isProcessingImages = false }

        do {
            for data in selectedItems {
                let prepared = try await Task.detached(priority: .userInitiated) {
                    try ImageAttachmentPreprocessor.prepare(data: data, limits: .default)
                }.value

                preparedAttachments.append(
                    PendingImageAttachment(
                        id: UUID().uuidString,
                        dataURL: prepared.dataURL,
                        bytes: prepared.jpegData.count,
                        width: prepared.width,
                        height: prepared.height
                    )
                )
            }
        } catch {
            errorMessage = error.localizedDescription
            return
        }

        if preparedAttachments.isEmpty {
            errorMessage = String(localized: "conversation.noImages")
            return
        }

        pendingImageAttachments.append(contentsOf: preparedAttachments)
        errorMessage = nil
    }

    func removePendingImage(id: String) {
        pendingImageAttachments.removeAll(where: { $0.id == id })
    }

    private func startTurn(
        using relayConnection: RelayConnection,
        threadId: String,
        userMessageText: String,
        turnInputs: [TurnInputItem],
        originalDraft: String,
        originalImages: [PendingImageAttachment]
    ) async {
        let now = Date()
        DiagnosticsLogger.info(
            "ConversationRuntime",
            "start_turn",
            metadata: diagnosticsMetadata([
                "threadId": threadId,
                "inputCount": String(turnInputs.count),
                "hasImages": originalImages.isEmpty ? "false" : "true"
            ])
        )
        cancelRestoreValidation()
        restoredStatePendingValidation = false
        draft = ""
        pendingImageAttachments = []
        errorMessage = nil
        isInterrupting = false
        pendingInterrupt = false
        activeTurnId = nil
        commandOutputs = []
        activeApproval = nil
        turnStartedAt = now
        lastVisibleActivityAt = now
        turnStatus = .starting
        baseStatusDetail = String(localized: "conversation.status.starting")
        refreshStatusDetail(now: now)
        startStatusMonitorIfNeeded()

        let userMessage = ConversationMessage(
            id: UUID().uuidString,
            role: .user,
            text: userMessageText,
            turnId: nil,
            createdAt: now
        )
        currentAssistantPlaceholderId = nil
        currentAssistantMessageIdsByItemId = [:]
        baseMessages.append(userMessage)
        recordTimelineItemId(userMessage.id)
        rebuildRows()
        advanceVisibleWindow()

        do {
            let completedPayload = try await relayConnection.startTurn(
                threadId: threadId,
                inputs: turnInputs,
                handlers: .init(
                    onStatus: { [weak self] payload in
                        self?.handleTurnStatus(payload, relayConnection: relayConnection, threadId: threadId)
                    },
                    onDelta: { [weak self] payload in
                        self?.appendAssistantDelta(payload)
                    },
                    onCommandOutput: { [weak self] payload in
                        self?.appendCommandOutput(payload)
                    },
                    onApprovalRequested: { [weak self] payload in
                        self?.showApproval(payload)
                    },
                    completion: { _ in }
                )
            )

            finishTurnCompletion(completedPayload)

            if completedPayload.status == "failed" {
                errorMessage = completedPayload.errorMessage ?? String(localized: "conversation.sendFailed")
            }
            DiagnosticsLogger.info(
                "ConversationRuntime",
                "start_turn_completed",
                metadata: diagnosticsMetadata([
                    "threadId": threadId,
                    "turnId": completedPayload.turnId,
                    "status": completedPayload.status
                ])
            )
        } catch {
            draft = originalDraft
            pendingImageAttachments = originalImages
            errorMessage = error.localizedDescription
            let placeholderId = currentAssistantPlaceholderId ?? ensureAssistantMessagePlaceholder(
                itemId: nil,
                turnId: activeTurnId
            )
            finishAssistantMessage(
                text: String(format: String(localized: "conversation.requestFailed"), error.localizedDescription),
                turnId: activeTurnId,
                placeholderId: placeholderId
            )
            clearTransientState(keepStatus: false)
            rebuildRows()
            DiagnosticsLogger.warning(
                "ConversationRuntime",
                "start_turn_failed",
                metadata: diagnosticsMetadata([
                    "threadId": threadId,
                    "error": error.localizedDescription
                ])
            )
        }
    }

    private func handleTurnStatus(
        _ payload: TurnStatusPayload,
        relayConnection: RelayConnection,
        threadId: String
    ) {
        DiagnosticsLogger.debug(
            "ConversationRuntime",
            "handle_turn_status",
            metadata: diagnosticsMetadata([
                "threadId": threadId,
                "turnId": payload.turnId,
                "status": payload.status.rawValue,
                "detail": payload.detail,
                "itemId": payload.itemId
            ])
        )
        confirmLiveTurnActivity()
        noteVisibleActivity()

        if let turnId = payload.turnId {
            activeTurnId = turnId
            if pendingInterrupt && !isInterrupting {
                Task {
                    await interrupt(using: relayConnection, threadId: threadId)
                }
            } else if pendingInterrupt {
                Task {
                    await performInterrupt(using: relayConnection, threadId: threadId, turnId: turnId)
                }
            }
        }

        turnStatus = payload.status
        baseStatusDetail = payload.detail ?? fallbackStatusDetail(for: payload.status)

        switch payload.status {
        case .runningCommand:
            if let turnId = payload.turnId {
                upsertCommandOutput(
                    turnId: turnId,
                    itemId: payload.itemId,
                    title: payload.detail?.isEmpty == false ? payload.detail! : String(localized: "conversation.executionOutput"),
                    state: .running,
                    detail: payload.detail
                )
            }
        case .waitingApproval:
            baseStatusDetail = payload.detail ?? String(localized: "conversation.waitingApproval")
            if let turnId = payload.turnId {
                upsertCommandOutput(
                    turnId: turnId,
                    itemId: payload.itemId,
                    title: payload.detail?.isEmpty == false ? payload.detail! : String(localized: "conversation.executionOutput"),
                    state: .waitingApproval,
                    detail: payload.detail
                )
            }
        case .completed, .failed, .interrupted:
            isInterrupting = false
            stopStatusMonitor()
        default:
            break
        }

        refreshStatusDetail()
        rebuildRows()
    }

    private func appendAssistantDelta(_ payload: TurnDeltaPayload) {
        confirmLiveTurnActivity()
        activeTurnId = payload.turnId
        let placeholderId = ensureAssistantMessagePlaceholder(
            itemId: payload.itemId,
            turnId: payload.turnId
        )
        currentAssistantPlaceholderId = placeholderId
        guard let index = baseMessages.firstIndex(where: { $0.id == placeholderId }) else {
            return
        }

        baseMessages[index].text += payload.delta
        noteVisibleActivity()
        if turnStatus == .starting {
            turnStatus = .streaming
            baseStatusDetail = fallbackStatusDetail(for: .streaming)
            refreshStatusDetail()
        }
        patchLastAssistantRow()
    }

    private func ensureAssistantMessagePlaceholder(
        itemId: String?,
        turnId: String?,
        insertBeforeItemId: String? = nil
    ) -> String {
        if let itemId,
           let existingId = currentAssistantMessageIdsByItemId[itemId],
           baseMessages.contains(where: { $0.id == existingId }) {
            return existingId
        }

        if itemId == nil,
           let currentAssistantPlaceholderId,
           baseMessages.contains(where: { $0.id == currentAssistantPlaceholderId }) {
            return currentAssistantPlaceholderId
        }

        let messageId = itemId ?? UUID().uuidString
        let assistantMessage = ConversationMessage(
            id: messageId,
            role: .assistant,
            text: "",
            turnId: turnId,
            createdAt: Date()
        )

        if let insertBeforeItemId,
           let insertIndex = baseMessages.firstIndex(
               where: { $0.id == (currentAssistantMessageIdsByItemId[insertBeforeItemId] ?? insertBeforeItemId) }
           ) {
            baseMessages.insert(assistantMessage, at: insertIndex)
        } else {
            baseMessages.append(assistantMessage)
        }

        let insertBeforeId = insertBeforeItemId.flatMap { currentAssistantMessageIdsByItemId[$0] ?? $0 }
        recordTimelineItemId(messageId, before: insertBeforeId)

        if let itemId {
            currentAssistantMessageIdsByItemId[itemId] = messageId
        } else {
            currentAssistantPlaceholderId = messageId
        }

        return messageId
    }

    private func appendCommandOutput(_ payload: CommandOutputDeltaPayload) {
        confirmLiveTurnActivity()
        noteVisibleActivity()
        upsertCommandOutput(
            turnId: payload.turnId,
            itemId: payload.itemId,
            title: payload.source == .commandExecution ? String(localized: "conversation.executionOutput") : String(localized: "conversation.fileChangeOutput"),
            state: .running,
            detail: nil,
            appendedText: payload.delta
        )
        if turnStatus != .waitingApproval {
            turnStatus = .runningCommand
            baseStatusDetail = fallbackStatusDetail(for: .runningCommand)
            refreshStatusDetail()
        }
        rebuildRows()
    }

    private func showApproval(_ payload: ApprovalRequestedPayload) {
        DiagnosticsLogger.info(
            "ConversationRuntime",
            "approval_requested",
            metadata: diagnosticsMetadata([
                "threadId": payload.threadId,
                "turnId": payload.turnId,
                "approvalId": payload.approvalId,
                "kind": payload.kind.rawValue
            ])
        )
        confirmLiveTurnActivity()
        noteVisibleActivity()
        let title = payload.kind == .commandExecution ? String(localized: "conversation.approval.needApproveCommand") : String(localized: "conversation.approval.needApproveFile")
        let summary: String
        if let command = payload.command, !command.isEmpty {
            summary = command
        } else if let reason = payload.reason, !reason.isEmpty {
            summary = reason
        } else if let grantRoot = payload.grantRoot, !grantRoot.isEmpty {
            summary = grantRoot
        } else {
            summary = String(localized: "conversation.approval.fallbackSummary")
        }

        activeApproval = ApprovalCardModel(
            id: payload.approvalId,
            approvalId: payload.approvalId,
            threadId: payload.threadId,
            turnId: payload.turnId,
            kind: payload.kind,
            title: title,
            summary: summary,
            reason: payload.reason,
            command: payload.command,
            cwd: payload.cwd,
            aggregatedOutput: payload.aggregatedOutput,
            grantRoot: payload.grantRoot
        )
        turnStatus = .waitingApproval
        baseStatusDetail = String(localized: "conversation.waitingApproval")
        refreshStatusDetail()
        rebuildRows()
    }

    private func queueDraft(_ text: String) {
        guard queuedDraft == nil else {
            errorMessage = String(localized: "conversation.queueConflict")
            DiagnosticsLogger.warning("ConversationRuntime", "queue_draft_conflict", metadata: diagnosticsMetadata())
            return
        }

        queuedDraft = QueuedDraftModel(id: UUID().uuidString, text: text)
        errorMessage = nil
        DiagnosticsLogger.info(
            "ConversationRuntime",
            "queue_draft",
            metadata: diagnosticsMetadata([
                "queuedLength": String(text.count)
            ])
        )
        rebuildRows()
    }

    private func buildTurnInputs(text: String, attachments: [PendingImageAttachment]) -> [TurnInputItem] {
        var inputs: [TurnInputItem] = []
        if !text.isEmpty {
            inputs.append(.text(text))
        }
        for attachment in attachments {
            inputs.append(.image(url: attachment.dataURL))
        }
        return inputs
    }

    private func buildUserMessageText(text: String, imageCount: Int) -> String {
        if imageCount == 0 {
            return text
        }

        if text.isEmpty {
            return String(format: String(localized: "conversation.sentImages"), imageCount)
        }

        return "\(text)\n" + String(format: String(localized: "conversation.attachedImages"), imageCount)
    }

    private func resolveApproval(using relayConnection: RelayConnection, decision: ApprovalDecision) async {
        guard let activeApproval, !isResolvingApproval else {
            return
        }
        guard ensureWritable(using: relayConnection) else {
            return
        }

        DiagnosticsLogger.info(
            "ConversationRuntime",
            "resolve_approval_start",
            metadata: diagnosticsMetadata([
                "approvalId": activeApproval.approvalId,
                "threadId": activeApproval.threadId,
                "turnId": activeApproval.turnId,
                "decision": decision.rawValue
            ])
        )

        isResolvingApproval = true
        defer {
            isResolvingApproval = false
        }

        do {
            _ = try await relayConnection.resolveApproval(
                approvalId: activeApproval.approvalId,
                threadId: activeApproval.threadId,
                turnId: activeApproval.turnId,
                decision: decision
            )
            self.activeApproval = nil
            if decision == .cancel {
                turnStatus = .interrupting
                baseStatusDetail = String(localized: "conversation.stoppingTurn")
            } else {
                turnStatus = .runningCommand
                baseStatusDetail = decision == .accept ? String(localized: "conversation.approvalAccepted") : String(localized: "conversation.approvalDeclined")
            }
            noteVisibleActivity()
            refreshStatusDetail()
            rebuildRows()
            DiagnosticsLogger.info(
                "ConversationRuntime",
                "resolve_approval_success",
                metadata: diagnosticsMetadata([
                    "approvalId": activeApproval.approvalId,
                    "decision": decision.rawValue
                ])
            )
        } catch {
            errorMessage = error.localizedDescription
            DiagnosticsLogger.warning(
                "ConversationRuntime",
                "resolve_approval_failed",
                metadata: diagnosticsMetadata([
                    "approvalId": activeApproval.approvalId,
                    "decision": decision.rawValue,
                    "error": error.localizedDescription
                ])
            )
        }
    }

    private func performInterrupt(using relayConnection: RelayConnection, threadId: String, turnId: String) async {
        DiagnosticsLogger.info(
            "ConversationRuntime",
            "interrupt_start",
            metadata: diagnosticsMetadata([
                "threadId": threadId,
                "turnId": turnId
            ])
        )
        do {
            let result = try await relayConnection.interruptTurn(threadId: threadId, turnId: turnId)

            if turnStatus == .interrupted || !isTurnActive || activeTurnId != result.turnId {
                return
            }

            isInterrupting = false
            pendingInterrupt = false
            baseStatusDetail = String(localized: "conversation.stopRequestSent")
            noteVisibleActivity()
            refreshStatusDetail()
            rebuildRows()
            DiagnosticsLogger.info(
                "ConversationRuntime",
                "interrupt_success",
                metadata: diagnosticsMetadata([
                    "threadId": result.threadId,
                    "turnId": result.turnId
                ])
            )
        } catch {
            isInterrupting = false
            pendingInterrupt = false
            errorMessage = error.localizedDescription
            DiagnosticsLogger.warning(
                "ConversationRuntime",
                "interrupt_failed",
                metadata: diagnosticsMetadata([
                    "threadId": threadId,
                    "turnId": turnId,
                    "error": error.localizedDescription
                ])
            )
        }
    }

    private func ensureWritable(using relayConnection: RelayConnection) -> Bool {
        guard relayConnection.canWriteToAgent else {
            errorMessage = relayConnection.writeUnavailableMessage
            DiagnosticsLogger.warning(
                "ConversationRuntime",
                "ensure_writable_failed",
                metadata: diagnosticsMetadata([
                    "reason": relayConnection.writeUnavailableMessage
                ])
            )
            return false
        }
        return true
    }

    func handleAgentUnavailable(reason: String) {
        let hadInFlightState =
            restoredStatePendingValidation ||
            isRestorableInFlightStatus(turnStatus) ||
            hasLiveCommandOutputs ||
            activeApproval != nil ||
            activeTurnId != nil

        guard hadInFlightState else {
            return
        }

        let queuedDraftToRestore = queuedDraft
        let interruptedTurnId = activeTurnId
        if let interruptedTurnId {
            finalizeCommandOutputs(for: interruptedTurnId, state: .interrupted)
        }
        removeEmptyTransientAssistantMessages()
        clearTransientState(keepStatus: false, preserveCommandOutputs: true)

        if let queuedDraftToRestore,
           draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            draft = queuedDraftToRestore.text
        }

        turnStatus = .interrupted
        baseStatusDetail = reason
        statusDetail = reason
        errorMessage = nil
        DiagnosticsLogger.warning(
            "ConversationRuntime",
            "handle_agent_unavailable",
            metadata: diagnosticsMetadata([
                "reason": reason,
                "hadInFlightState": hadInFlightState ? "true" : "false"
            ])
        )
        rebuildRows()
    }

    private func finishTurnCompletion(_ payload: TurnCompletedPayload) {
        DiagnosticsLogger.info(
            "ConversationRuntime",
            "finish_turn_completion",
            metadata: diagnosticsMetadata([
                "turnId": payload.turnId,
                "status": payload.status,
                "requestId": payload.requestId
            ])
        )
        confirmLiveTurnActivity()
        let placeholderId = currentAssistantPlaceholderId

        if let segments = payload.segments, !segments.isEmpty {
            finishAssistantSegments(segments, turnId: payload.turnId)
        } else {
            let resolvedText = resolvedAssistantText(from: payload, placeholderId: placeholderId)
            if !resolvedText.isEmpty {
                let targetPlaceholderId = placeholderId ?? ensureAssistantMessagePlaceholder(
                    itemId: nil,
                    turnId: payload.turnId
                )
                finishAssistantMessage(
                    text: resolvedText,
                    turnId: payload.turnId,
                    placeholderId: targetPlaceholderId
                )
            }
        }

        currentAssistantPlaceholderId = nil
        currentAssistantMessageIdsByItemId = [:]

        let commandOutputState: CommandOutputState
        switch payload.status {
        case "interrupted":
            commandOutputState = .interrupted
        case "failed":
            commandOutputState = .failed
        default:
            commandOutputState = .completed
        }
        finalizeCommandOutputs(for: payload.turnId, state: commandOutputState)

        if payload.status == "interrupted" {
            turnStatus = .interrupted
            baseStatusDetail = String(localized: "conversation.status.interrupted")
        } else if payload.status == "failed" {
            turnStatus = .failed
            baseStatusDetail = payload.errorMessage ?? String(localized: "conversation.status.failed")
        } else {
            turnStatus = .completed
            baseStatusDetail = nil
        }

        activeTurnId = nil
        activeApproval = nil
        isInterrupting = false
        pendingInterrupt = false
        lastVisibleActivityAt = Date()
        turnStartedAt = nil
        stopStatusMonitor()
        refreshStatusDetail()
        rebuildRows()

        if let queuedDraft {
            let queuedText = queuedDraft.text
                self.queuedDraft = nil
                rebuildRows()
                if let loadedThreadId, let relayConnection {
                    Task {
                        await startTurn(
                            using: relayConnection,
                            threadId: loadedThreadId,
                            userMessageText: queuedText,
                            turnInputs: [TurnInputItem.text(queuedText)],
                            originalDraft: queuedText,
                            originalImages: []
                        )
                    }
                }
            }
        }

    private func finishAssistantSegments(_ segments: [AssistantMessageSegment], turnId: String) {
        var nextItemId: String?

        for segment in segments.reversed() {
            let placeholderId = ensureAssistantMessagePlaceholder(
                itemId: segment.itemId,
                turnId: turnId,
                insertBeforeItemId: nextItemId
            )
            finishAssistantMessage(
                text: segment.text,
                turnId: turnId,
                placeholderId: placeholderId
            )
            nextItemId = segment.itemId
        }
    }

    private func finishAssistantMessage(text: String, turnId: String?, placeholderId: String?) {
        guard let placeholderId,
              let index = baseMessages.firstIndex(where: { $0.id == placeholderId }) else {
            return
        }

        let resolvedText = text.isEmpty ? baseMessages[index].text : text
        baseMessages[index] = ConversationMessage(
            id: baseMessages[index].id,
            role: .assistant,
            text: resolvedText,
            turnId: turnId,
            createdAt: baseMessages[index].createdAt
        )
    }

    private func resolvedAssistantText(from payload: TurnCompletedPayload, placeholderId: String?) -> String {
        if !payload.text.isEmpty {
            return payload.text
        }

        if let placeholderId,
           let message = baseMessages.first(where: { $0.id == placeholderId }),
           !message.text.isEmpty {
            return message.text
        }

        let segmentMessageIds = Set(currentAssistantMessageIdsByItemId.values)
        let segmentTexts = baseMessages
            .filter { segmentMessageIds.contains($0.id) }
            .map(\.text)
            .filter { !$0.isEmpty }
        if !segmentTexts.isEmpty {
            return segmentTexts.joined(separator: "\n\n")
        }

        if payload.status == "interrupted" {
            return String(localized: "conversation.executionStoppedDot")
        }

        return payload.status == "failed" ? String(localized: "conversation.executionFailedDot") : ""
    }

    private func removeEmptyTransientAssistantMessages() {
        let transientMessageIds = Set(
            Array(currentAssistantMessageIdsByItemId.values) +
            (currentAssistantPlaceholderId.map { [$0] } ?? [])
        )

        guard !transientMessageIds.isEmpty else {
            return
        }

        baseMessages.removeAll { message in
            transientMessageIds.contains(message.id) &&
            message.role == .assistant &&
            message.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }

    private func clearTransientState(keepStatus: Bool, preserveCommandOutputs: Bool = false) {
        stopStatusMonitor()
        cancelRestoreValidation()
        currentAssistantPlaceholderId = nil
        currentAssistantMessageIdsByItemId = [:]
        if !preserveCommandOutputs {
            commandOutputs = []
        }
        activeApproval = nil
        queuedDraft = nil
        activeTurnId = nil
        turnStartedAt = nil
        lastVisibleActivityAt = nil
        baseStatusDetail = nil
        restoredStatePendingValidation = false
        isInterrupting = false
        pendingInterrupt = false
        oldestVisibleIndex = 0
        if !keepStatus {
            turnStatus = nil
            statusDetail = nil
        }
    }

    private func rebuildRows(resetVisibleWindow: Bool = false) {
        let mergedOutputs = mergedCommandOutputs()
        // 用 Dictionary 预建索引，避免 O(n²) 的 first(where:) 查找
        let messageById = Dictionary(uniqueKeysWithValues: baseMessages.map { ($0.id, $0) })
        let outputById = Dictionary(uniqueKeysWithValues: mergedOutputs.map { ($0.id, $0) })

        var nextRows: [ConversationRow] = []
        var appendedMessageIds = Set<String>()
        var appendedOutputIds = Set<String>()

        for itemId in orderedItemIds {
            if let message = messageById[itemId],
               appendedMessageIds.insert(message.id).inserted {
                nextRows.append(.message(message))
            }
            if let output = outputById[itemId],
               appendedOutputIds.insert(output.id).inserted {
                nextRows.append(.commandOutput(output))
            }
        }

        for message in baseMessages where !appendedMessageIds.contains(message.id) {
            nextRows.append(.message(message))
        }
        for output in mergedOutputs where !appendedOutputIds.contains(output.id) {
            nextRows.append(.commandOutput(output))
        }

        if let activeApproval {
            nextRows.append(.approval(activeApproval))
        }
        if let queuedDraft {
            nextRows.append(.queuedDraft(queuedDraft))
        }

        rows = nextRows

        if resetVisibleWindow {
            oldestVisibleIndex = rows.count > displayPageSize ? rows.count - displayPageSize : 0
        }

        persistRuntimeIfNeeded()
    }

    // 用户发送新消息时推进可见窗口，保持最多 displayPageSize 条可见
    private func advanceVisibleWindow() {
        let visibleCount = rows.count - oldestVisibleIndex
        guard visibleCount > displayPageSize else { return }
        oldestVisibleIndex = rows.count - displayPageSize
    }

    // streaming delta 专用：只原地更新正在流式输出的那一行，避免全量重建
    private func patchLastAssistantRow() {
        let targetId: String?
        if let placeholderId = currentAssistantPlaceholderId {
            targetId = placeholderId
        } else {
            targetId = Array(currentAssistantMessageIdsByItemId.values).last
        }

        guard let targetId,
              let message = baseMessages.first(where: { $0.id == targetId }),
              let rowIndex = rows.firstIndex(where: {
                  if case .message(let m) = $0 { return m.id == targetId }
                  return false
              }) else {
            rebuildRows()
            return
        }

        rows[rowIndex] = .message(message)
    }

    private func restoreRuntime(for threadId: String) {
        guard let snapshot = runtimeStore.snapshot(for: threadId) else {
            DiagnosticsLogger.debug(
                "ConversationRuntime",
                "restore_runtime_no_snapshot",
                metadata: diagnosticsMetadata([
                    "threadId": threadId
                ])
            )
            return
        }

        DiagnosticsLogger.info(
            "ConversationRuntime",
            "restore_runtime_found_snapshot",
            metadata: diagnosticsMetadata([
                "threadId": threadId,
                "snapshotTurnId": snapshot.activeTurnId,
                "snapshotStatus": snapshot.turnStatus?.rawValue
            ])
        )

        if shouldDiscardSnapshot(snapshot) {
            runtimeStore.removeSnapshot(for: threadId)
            DiagnosticsLogger.warning(
                "ConversationRuntime",
                "restore_runtime_discard_snapshot",
                metadata: diagnosticsMetadata([
                    "threadId": threadId,
                    "snapshotTurnId": snapshot.activeTurnId
                ])
            )
            return
        }

        turnStatus = snapshot.turnStatus
        statusDetail = snapshot.statusDetail
        baseStatusDetail = snapshot.statusDetail
        activeTurnId = snapshot.activeTurnId
        commandOutputs = snapshot.commandOutputs
        mergeOrderedItemIds(snapshot.orderedItemIds)
        activeApproval = snapshot.activeApproval
        queuedDraft = snapshot.queuedDraft
        turnStartedAt = snapshot.turnStartedAt
        lastVisibleActivityAt = snapshot.lastVisibleActivityAt
        if isRestorableInFlightStatus(snapshot.turnStatus) {
            let isTracked = relayConnection?.isTrackingTurn(
                threadId: threadId,
                turnId: snapshot.activeTurnId
            ) ?? false

            if isTracked {
                startStatusMonitorIfNeeded()
                refreshStatusDetail()
                DiagnosticsLogger.info(
                    "ConversationRuntime",
                    "restore_runtime_resume_live_tracking",
                    metadata: diagnosticsMetadata([
                        "threadId": threadId,
                        "turnId": snapshot.activeTurnId
                    ])
                )
            } else {
                beginRestoreValidation(for: threadId)
            }
        }
    }

    private func shouldDiscardSnapshot(_ snapshot: ConversationRuntimeSnapshot) -> Bool {
        guard let activeTurnId = snapshot.activeTurnId,
              isRestorableInFlightStatus(snapshot.turnStatus) else {
            return false
        }

        return baseMessages.contains { message in
            message.turnId == activeTurnId &&
            message.role == .assistant &&
            !message.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }

    private func persistRuntimeIfNeeded() {
        guard let threadId = loadedThreadId else {
            return
        }

        let shouldPersist =
            activeTurnId != nil ||
            !commandOutputs.isEmpty ||
            activeApproval != nil ||
            queuedDraft != nil ||
            shouldPersistStatusOnly

        guard shouldPersist else {
            runtimeStore.removeSnapshot(for: threadId)
            return
        }

        runtimeStore.save(
            ConversationRuntimeSnapshot(
                threadId: threadId,
                turnStatus: turnStatus,
                statusDetail: statusDetail,
                activeTurnId: activeTurnId,
                commandOutputs: commandOutputs,
                orderedItemIds: orderedItemIds,
                activeApproval: activeApproval,
                queuedDraft: queuedDraft,
                turnStartedAt: turnStartedAt,
                lastVisibleActivityAt: lastVisibleActivityAt
            )
        )
    }

    private var shouldPersistStatusOnly: Bool {
        !restoredStatePendingValidation && isRestorableInFlightStatus(turnStatus)
    }

    private var hasLiveCommandOutputs: Bool {
        commandOutputs.contains { output in
            output.state == .running || output.state == .waitingApproval
        }
    }

    private func isRestorableInFlightStatus(_ status: TurnStatusValue?) -> Bool {
        guard let status else {
            return false
        }

        switch status {
        case .starting, .streaming, .runningCommand, .waitingApproval, .interrupting:
            return true
        case .completed, .interrupted, .failed:
            return false
        }
    }

    private func beginRestoreValidation(for threadId: String) {
        DiagnosticsLogger.info(
            "ConversationRuntime",
            "restore_validation_begin",
            metadata: diagnosticsMetadata([
                "threadId": threadId
            ])
        )
        restoredStatePendingValidation = true
        baseStatusDetail = String(localized: "conversation.calibratingState")
        statusDetail = baseStatusDetail
        stopStatusMonitor()
        activeTurnId = nil
        activeApproval = nil
        commandOutputs = []
        isInterrupting = false
        pendingInterrupt = false
        turnStartedAt = nil
        lastVisibleActivityAt = nil

        if let queuedDraft, draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            draft = queuedDraft.text
            self.queuedDraft = nil
        }

        rebuildRows()
        cancelRestoreValidation()
        let validationDelay = restoreValidationDelay
        restoreValidationTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(validationDelay))
            guard !Task.isCancelled else {
                return
            }

            await MainActor.run {
                self?.downgradeRestoredInFlightState(for: threadId)
            }
        }
    }

    private func confirmLiveTurnActivity() {
        guard restoredStatePendingValidation else {
            return
        }

        DiagnosticsLogger.info(
            "ConversationRuntime",
            "restore_validation_confirmed_live",
            metadata: diagnosticsMetadata()
        )
        restoredStatePendingValidation = false
        cancelRestoreValidation()
        if baseStatusDetail == String(localized: "conversation.calibratingState") {
            if let turnStatus {
                baseStatusDetail = fallbackStatusDetail(for: turnStatus)
            } else {
                baseStatusDetail = nil
            }
        }
        startStatusMonitorIfNeeded()
        refreshStatusDetail()
    }

    private func downgradeRestoredInFlightState(for threadId: String) {
        guard restoredStatePendingValidation, loadedThreadId == threadId else {
            return
        }

        DiagnosticsLogger.warning(
            "ConversationRuntime",
            "restore_validation_downgraded",
            metadata: diagnosticsMetadata([
                "threadId": threadId
            ])
        )
        clearTransientState(keepStatus: false)
        runtimeStore.removeSnapshot(for: threadId)
        rebuildRows()
    }

    private func cancelRestoreValidation() {
        restoreValidationTask?.cancel()
        restoreValidationTask = nil
    }

    func isMessageInProgress(_ message: ConversationMessage) -> Bool {
        guard message.role == .assistant, isTurnActive else {
            return false
        }

        return message.id == currentAssistantPlaceholderId
    }

    private func noteVisibleActivity(at date: Date = Date()) {
        lastVisibleActivityAt = date
        refreshStatusDetail(now: date)
    }

    private func startStatusMonitorIfNeeded() {
        guard statusMonitorTask == nil, isTurnActive else {
            return
        }

        statusMonitorTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
                guard !Task.isCancelled else {
                    break
                }

                await MainActor.run {
                    self?.refreshStatusDetail(now: Date())
                }
            }
        }
    }

    private func stopStatusMonitor() {
        statusMonitorTask?.cancel()
        statusMonitorTask = nil
    }

    private func refreshStatusDetail(now: Date = Date()) {
        guard let turnStatus else {
            statusDetail = nil
            return
        }

        let base = baseStatusDetail ?? fallbackStatusDetail(for: turnStatus)

        guard isTurnActive else {
            statusDetail = base
            return
        }

        switch turnStatus {
        case .waitingApproval, .interrupting:
            statusDetail = base
            return
        case .completed, .interrupted, .failed:
            statusDetail = base
            return
        case .starting, .streaming, .runningCommand:
            break
        }

        guard let lastVisibleActivityAt else {
            statusDetail = base
            return
        }

        let silentInterval = now.timeIntervalSince(lastVisibleActivityAt)
        guard silentInterval >= silenceThreshold else {
            statusDetail = base
            return
        }

        let totalInterval = now.timeIntervalSince(turnStartedAt ?? lastVisibleActivityAt)
        let silentText = formattedDuration(silentInterval)
        let totalText = formattedDuration(totalInterval)

        switch turnStatus {
        case .runningCommand:
            statusDetail = String(format: String(localized: "conversation.silentCommand"), silentText, totalText)
        case .starting, .streaming:
            statusDetail = String(format: String(localized: "conversation.silentProcessing"), silentText, totalText)
        case .waitingApproval, .interrupting, .completed, .interrupted, .failed:
            statusDetail = base
        }
    }

    private func fallbackStatusDetail(for status: TurnStatusValue) -> String {
        switch status {
        case .starting:
            return String(localized: "conversation.status.starting")
        case .streaming:
            return String(localized: "conversation.status.streaming")
        case .runningCommand:
            return String(localized: "conversation.status.runningCommand")
        case .waitingApproval:
            return String(localized: "conversation.waitingApproval")
        case .interrupting:
            return String(localized: "conversation.status.interrupting")
        case .completed:
            return ""
        case .interrupted:
            return String(localized: "conversation.status.interrupted")
        case .failed:
            return String(localized: "conversation.status.failed")
        }
    }

    private func upsertCommandOutput(
        turnId: String,
        itemId: String?,
        title: String,
        state: CommandOutputState,
        detail: String?,
        appendedText: String? = nil
    ) {
        let resolvedItemId = itemId ?? "turn-\(turnId)"
        let createdAt = Date()

        if let index = commandOutputs.firstIndex(where: { $0.itemId == resolvedItemId && $0.turnId == turnId }) {
            let existing = commandOutputs[index]
            let updatedText = existing.text + (appendedText ?? "")
            let updatedTitle = existing.title == String(localized: "conversation.executionOutput") || existing.title == String(localized: "conversation.fileChangeOutput") ? title : existing.title
            commandOutputs[index] = CommandOutputPanel(
                id: existing.id,
                itemId: existing.itemId,
                turnId: existing.turnId,
                title: updatedTitle,
                text: updatedText,
                state: state,
                detail: detail ?? existing.detail,
                createdAt: existing.createdAt ?? createdAt
            )
            return
        }

        commandOutputs.append(
            CommandOutputPanel(
                id: resolvedItemId,
                itemId: resolvedItemId,
                turnId: turnId,
                title: title,
                text: appendedText ?? "",
                state: state,
                detail: detail,
                createdAt: createdAt
            )
        )
        recordTimelineItemId(resolvedItemId)
    }

    private func finalizeCommandOutputs(for turnId: String, state: CommandOutputState) {
        guard !commandOutputs.isEmpty else {
            return
        }

        commandOutputs = commandOutputs.map { output in
            guard output.turnId == turnId else {
                return output
            }

            return CommandOutputPanel(
                id: output.id,
                itemId: output.itemId,
                turnId: output.turnId,
                title: output.title,
                text: output.text,
                state: state,
                detail: output.detail,
                createdAt: output.createdAt
            )
        }
    }

    private func formattedDuration(_ interval: TimeInterval) -> String {
        let seconds = max(1, Int(interval.rounded(.down)))
        if seconds < 60 {
            return String(format: String(localized: "time.seconds"), seconds)
        }

        let minutes = seconds / 60
        let remainingSeconds = seconds % 60
        if remainingSeconds == 0 {
            return String(format: String(localized: "time.minutes"), minutes)
        }

        return String(format: String(localized: "time.minutesAndSeconds"), minutes, remainingSeconds)
    }

    private struct ParsedConversationHistory {
        let messages: [ConversationMessage]
        let commandOutputs: [CommandOutputPanel]
        let orderedItemIds: [String]
    }

    private func parseConversationHistory(from response: ThreadResumeResponsePayload) -> ParsedConversationHistory {
        let messageCreatedAtById = Dictionary(
            uniqueKeysWithValues: response.messages.map { ($0.id, $0.createdAtDate) }
        )

        if let timelineItems = response.timelineItems, !timelineItems.isEmpty {
            var nextMessages: [ConversationMessage] = []
            var nextOutputs: [CommandOutputPanel] = []
            var nextOrderedIds: [String] = []

            for item in timelineItems {
                if !nextOrderedIds.contains(item.id) {
                    nextOrderedIds.append(item.id)
                }

                if let message = ConversationMessage(
                    threadTimelineItem: item,
                    createdAt: messageCreatedAtById[item.id] ?? item.createdAtDate
                ) {
                    nextMessages.append(message)
                    continue
                }

                if let commandOutput = CommandOutputPanel(threadTimelineItem: item) {
                    nextOutputs.append(commandOutput)
                }
            }

            return ParsedConversationHistory(
                messages: nextMessages,
                commandOutputs: nextOutputs,
                orderedItemIds: nextOrderedIds
            )
        }

        let nextMessages = response.messages.map(ConversationMessage.init(threadMessage:))
        return ParsedConversationHistory(
            messages: nextMessages,
            commandOutputs: [],
            orderedItemIds: nextMessages.map(\.id)
        )
    }

    private func replaceConversationHistory(from response: ThreadResumeResponsePayload) {
        let parsed = parseConversationHistory(from: response)
        baseMessages = parsed.messages
        historicalCommandOutputs = parsed.commandOutputs
        orderedItemIds = parsed.orderedItemIds
        hasMoreHistoryBefore = response.hasMoreBefore ?? false
    }

    private func mergeConversationHistory(from response: ThreadResumeResponsePayload) {
        let parsed = parseConversationHistory(from: response)

        var mergedMessages: [ConversationMessage] = []
        var seenMessageIds = Set<String>()
        for message in parsed.messages + baseMessages where seenMessageIds.insert(message.id).inserted {
            mergedMessages.append(message)
        }
        baseMessages = mergedMessages

        var mergedOutputs: [CommandOutputPanel] = []
        var seenOutputIds = Set<String>()
        for output in parsed.commandOutputs + historicalCommandOutputs where seenOutputIds.insert(output.id).inserted {
            mergedOutputs.append(output)
        }
        historicalCommandOutputs = mergedOutputs

        var mergedOrderedIds: [String] = []
        var seenOrderedIds = Set<String>()
        for itemId in parsed.orderedItemIds + orderedItemIds where seenOrderedIds.insert(itemId).inserted {
            mergedOrderedIds.append(itemId)
        }
        orderedItemIds = mergedOrderedIds

        hasMoreHistoryBefore = response.hasMoreBefore ?? false
    }

    private func earliestLoadedItemId() -> String? {
        orderedItemIds.first ?? baseMessages.first?.id
    }

    private func recordTimelineItemId(_ itemId: String, before beforeItemId: String? = nil) {
        guard !itemId.isEmpty else {
            return
        }

        if orderedItemIds.contains(itemId) {
            return
        }

        if let beforeItemId,
           let index = orderedItemIds.firstIndex(of: beforeItemId) {
            orderedItemIds.insert(itemId, at: index)
            return
        }

        orderedItemIds.append(itemId)
    }

    private func mergeOrderedItemIds(_ itemIds: [String]) {
        for itemId in itemIds where !orderedItemIds.contains(itemId) {
            orderedItemIds.append(itemId)
        }
    }

    private func mergedCommandOutputs() -> [CommandOutputPanel] {
        var merged = historicalCommandOutputs

        for commandOutput in commandOutputs {
            if let index = merged.firstIndex(where: { $0.id == commandOutput.id }) {
                merged[index] = commandOutput
            } else {
                merged.append(commandOutput)
            }
        }

        return merged
    }
}
