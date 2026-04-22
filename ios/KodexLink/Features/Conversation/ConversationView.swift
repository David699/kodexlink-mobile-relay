import SwiftUI
import PhotosUI

struct ConversationView: View {
    let thread: ThreadSummary

    @EnvironmentObject private var relayConnection: RelayConnection
    @StateObject private var viewModel = ConversationViewModel()
    @State private var selectedPhotoItems: [PhotosPickerItem] = []
    @State private var thinkingSeconds: Int = 0

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 12) {
                    if let banner = connectionBannerText {
                        ConversationStatusBanner(text: banner, status: .failed)
                            .id("connection-banner")
                    }

                    if viewModel.isLoading {
                        ProgressView("conversation.loading")
                            .frame(maxWidth: .infinity)
                            .padding(.top, 32)
                    }

                    if let banner = statusBannerText {
                        ConversationStatusBanner(text: banner, status: viewModel.turnStatus)
                            .id("status-banner")
                    }

                    if viewModel.canLoadOlderRows {
                        Button {
                            Task {
                                await viewModel.loadOlderRows(using: relayConnection)
                            }
                        } label: {
                            Group {
                                if viewModel.isLoadingOlderHistory {
                                    HStack(spacing: 8) {
                                        ProgressView()
                                            .controlSize(.small)
                                        Text("conversation.loadOlder")
                                    }
                                } else {
                                    Label("conversation.loadOlder", systemImage: "arrow.up.circle")
                                }
                            }
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(Color.accentColor)
                            .padding(.vertical, 8)
                        }
                        .buttonStyle(.plain)
                        .disabled(viewModel.isLoadingOlderHistory)
                    }

                    ForEach(viewModel.visibleRows) { row in
                        conversationRow(row)
                            .id(row.id)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 20)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Color(.systemGroupedBackground))
            .navigationTitle(thread.titleText)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(.hidden, for: .tabBar)
            .refreshable {
                await viewModel.refreshAfterReconnect(using: relayConnection, threadId: thread.id)
            }
            .safeAreaInset(edge: .bottom) {
                VStack(spacing: 8) {
                    if !viewModel.pendingImageAttachments.isEmpty {
                        PendingImageStrip(
                            attachments: viewModel.pendingImageAttachments,
                            onRemove: { attachmentId in
                                viewModel.removePendingImage(id: attachmentId)
                            }
                        )
                        .padding(.horizontal, 16)
                    }

                    ComposerBar(
                        text: $viewModel.draft,
                        photoSelection: $selectedPhotoItems,
                        isTurnActive: viewModel.isTurnActive,
                        hasQueuedDraft: viewModel.hasQueuedDraft,
                        hasPendingImages: !viewModel.pendingImageAttachments.isEmpty,
                        isProcessingImages: viewModel.isProcessingImages,
                        canAttachImages: canWriteToAgent && !viewModel.isTurnActive && viewModel.remainingImageSlots > 0,
                        remainingImageSlots: viewModel.remainingImageSlots,
                        isInterrupting: viewModel.isInterrupting,
                        canWriteToAgent: canWriteToAgent,
                        onSend: {
                            Task {
                                await viewModel.send(using: relayConnection, threadId: thread.id)
                            }
                        },
                        onStop: {
                            Task {
                                await viewModel.interrupt(using: relayConnection, threadId: thread.id)
                            }
                        }
                    )
                }
                .background(.bar)
            }
            .overlay(alignment: .top) {
                VStack(spacing: 6) {
                    if viewModel.isTurnActive, viewModel.turnStartedAt != nil {
                        ThinkingTimePill(
                            seconds: thinkingSeconds,
                            turnStatus: viewModel.turnStatus
                        )
                        .transition(.move(edge: .top).combined(with: .opacity))
                    }
                    if let errorMessage = viewModel.errorMessage {
                        Text(errorMessage)
                            .font(.caption)
                            .foregroundStyle(.red)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(.ultraThinMaterial, in: Capsule())
                    }
                }
                .padding(.top, 8)
                .animation(.easeInOut(duration: 0.25), value: viewModel.isTurnActive)
            }
            .task(id: viewModel.turnStartedAt) {
                thinkingSeconds = 0
                guard let startedAt = viewModel.turnStartedAt else { return }
                while !Task.isCancelled {
                    thinkingSeconds = max(0, Int(Date().timeIntervalSince(startedAt)))
                    try? await Task.sleep(nanoseconds: 1_000_000_000)
                }
            }
            .task {
                await viewModel.loadThread(using: relayConnection, threadId: thread.id)
            }
            .onChange(of: relayConnection.state) { _, newState in
                switch newState {
                case .connected:
                    Task {
                        await viewModel.refreshAfterReconnect(using: relayConnection, threadId: thread.id)
                    }
                case .disconnected, .failed:
                    break
                case .connecting:
                    break
                }
            }
            .onChange(of: relayConnection.currentAgentStatus) { _, newStatus in
                switch newStatus {
                case .online:
                    Task {
                        await viewModel.refreshAfterReconnect(using: relayConnection, threadId: thread.id)
                    }
                case .offline, .degraded:
                    viewModel.handleAgentUnavailable(reason: relayConnection.writeUnavailableMessage)
                case .unknown:
                    break
                }
            }
            .onChange(of: viewModel.rows.count) { _, _ in
                scrollToBottom(with: proxy)
            }
            .onChange(of: viewModel.turnStatus) { _, _ in
                scrollToBottom(with: proxy)
            }
            .onChange(of: selectedPhotoItems.count) { _, _ in
                let items = selectedPhotoItems
                guard !items.isEmpty else {
                    return
                }

                Task {
                    let candidateItems = Array(items.prefix(max(0, viewModel.remainingImageSlots)))
                    var dataItems: [Data] = []
                    for item in candidateItems {
                        if let data = try? await item.loadTransferable(type: Data.self) {
                            dataItems.append(data)
                        }
                    }

                    await viewModel.addImageDataItems(dataItems)
                    selectedPhotoItems = []
                }
            }
        }
    }

    private var canWriteToAgent: Bool {
        relayConnection.canWriteToAgent
    }

    private var connectionBannerText: String? {
        guard !relayConnection.canWriteToAgent else {
            return nil
        }

        return relayConnection.writeUnavailableMessage
    }

    private var statusBannerText: String? {
        if let detail = viewModel.statusDetail, !detail.isEmpty {
            return detail
        }

        guard let turnStatus = viewModel.turnStatus else {
            return nil
        }

        switch turnStatus {
        case .starting:
            return NSLocalizedString("conversation.status.starting", comment: "")
        case .streaming:
            return NSLocalizedString("conversation.status.streaming", comment: "")
        case .runningCommand:
            return NSLocalizedString("conversation.status.runningCommand", comment: "")
        case .waitingApproval:
            return NSLocalizedString("conversation.status.waitingApproval", comment: "")
        case .interrupting:
            return NSLocalizedString("conversation.status.interrupting", comment: "")
        case .completed:
            return nil
        case .interrupted:
            return NSLocalizedString("conversation.status.interrupted", comment: "")
        case .failed:
            return NSLocalizedString("conversation.status.failed", comment: "")
        }
    }

    @ViewBuilder
    private func conversationRow(_ row: ConversationRow) -> some View {
        switch row {
        case .message(let message):
            MessageBubble(
                message: message,
                isInProgress: viewModel.isMessageInProgress(message)
            )
        case .commandOutput(let output):
            CommandOutputCard(output: output)
        case .approval(let approval):
            ApprovalCard(
                approval: approval,
                isResolving: viewModel.isResolvingApproval,
                canResolve: canWriteToAgent,
                onApprove: {
                    Task {
                        await viewModel.approve(using: relayConnection)
                    }
                },
                onDeclineContinue: {
                    Task {
                        await viewModel.declineAndContinue(using: relayConnection)
                    }
                },
                onCancelTurn: {
                    Task {
                        await viewModel.cancelCurrentTurn(using: relayConnection)
                    }
                }
            )
        case .queuedDraft(let queuedDraft):
            QueuedDraftBubble(queuedDraft: queuedDraft)
        }
    }

    private func scrollToBottom(with proxy: ScrollViewProxy) {
        guard let lastId = viewModel.rows.last?.id else {
            return
        }

        withAnimation(.easeOut(duration: 0.2)) {
            proxy.scrollTo(lastId, anchor: .bottom)
        }
    }
}

private struct ThinkingTimePill: View {
    let seconds: Int
    let turnStatus: TurnStatusValue?

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: iconName)
                .font(.system(size: 11, weight: .semibold))
                .symbolEffect(.pulse, isActive: true)
            Text(labelText)
                .font(.caption.weight(.semibold))
            Text("·")
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(formattedTime)
                .font(.caption.monospacedDigit().weight(.medium))
                .foregroundStyle(.secondary)
        }
        .foregroundStyle(tintColor)
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .background(.ultraThinMaterial, in: Capsule())
        .overlay(Capsule().strokeBorder(tintColor.opacity(0.2), lineWidth: 1))
    }

    private var iconName: String {
        switch turnStatus {
        case .runningCommand: return "terminal.fill"
        case .waitingApproval: return "hand.raised.fill"
        case .interrupting: return "stop.fill"
        default: return "sparkle"
        }
    }

    private var labelText: String {
        switch turnStatus {
        case .starting: return NSLocalizedString("conversation.status.starting", comment: "")
        case .streaming: return NSLocalizedString("conversation.generating", comment: "")
        case .runningCommand: return NSLocalizedString("conversation.status.runningCommand", comment: "")
        case .waitingApproval: return NSLocalizedString("conversation.waitingApproval", comment: "")
        case .interrupting: return NSLocalizedString("conversation.stoppingTurn", comment: "")
        default: return NSLocalizedString("conversation.generating", comment: "")
        }
    }

    private var tintColor: Color {
        switch turnStatus {
        case .waitingApproval: return .orange
        case .interrupting: return .red
        default: return Color.accentColor
        }
    }

    private var formattedTime: String {
        if seconds < 60 {
            return "\(seconds)s"
        } else {
            return "\(seconds / 60):\(String(format: "%02d", seconds % 60))"
        }
    }
}

private struct ConversationStatusBanner: View {
    let text: String
    let status: TurnStatusValue?

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: iconName)
                .font(.system(size: 14, weight: .semibold))
            Text(text)
                .font(.caption.weight(.semibold))
                .multilineTextAlignment(.leading)
            Spacer(minLength: 0)
        }
        .foregroundStyle(tint)
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private var iconName: String {
        switch status {
        case .starting:
            return "sparkles"
        case .streaming:
            return "ellipsis.bubble"
        case .runningCommand:
            return "terminal"
        case .waitingApproval:
            return "hand.raised.circle"
        case .interrupting:
            return "stop.circle"
        case .interrupted:
            return "pause.circle"
        case .failed:
            return "exclamationmark.triangle"
        case .completed, .none:
            return "checkmark.circle"
        }
    }

    private var tint: Color {
        switch status {
        case .waitingApproval:
            return .orange
        case .failed:
            return .red
        case .interrupting, .interrupted:
            return .pink
        default:
            return .blue
        }
    }
}

private struct MessageBubble: View {
    let message: ConversationMessage
    let isInProgress: Bool

    @AppStorage("chatAvatarStyle") private var avatarStyleRaw: String = ChatAvatarStyle.codex.rawValue

    private var avatarStyle: ChatAvatarStyle {
        ChatAvatarStyle(rawValue: avatarStyleRaw) ?? .codex
    }

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            if message.role == .assistant {
                AssistantAvatarView(style: avatarStyle)
                bubble
                Spacer(minLength: 32)
            } else {
                Spacer(minLength: 32)
                bubble
                UserAvatarView()
            }
        }
    }

    private var bubble: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .center, spacing: 8) {
                Text(message.role == .assistant ? "Codex" : NSLocalizedString("conversation.me", comment: ""))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(labelStyle)

                if isInProgress {
                    Label("conversation.generating", systemImage: "ellipsis")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(progressTint)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(progressTint.opacity(0.12), in: Capsule())
                }

                Spacer(minLength: 0)

                if let timestampText {
                    Text(timestampText)
                        .font(.caption2)
                        .foregroundStyle(timestampStyle)
                }
            }
            MessageTextView(
                text: message.text.isEmpty ? "..." : message.text,
                font: .preferredFont(forTextStyle: .body),
                textColor: textUIColor
            )
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(backgroundStyle, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private var backgroundStyle: AnyShapeStyle {
        if message.role == .assistant {
            return AnyShapeStyle(.regularMaterial)
        }

        return AnyShapeStyle(
            LinearGradient(
                colors: [Color.blue, Color.cyan],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
    }

    private var labelStyle: AnyShapeStyle {
        if message.role == .assistant {
            return AnyShapeStyle(.secondary)
        }

        return AnyShapeStyle(Color.white.opacity(0.85))
    }

    private var textStyle: AnyShapeStyle {
        if message.role == .assistant {
            return AnyShapeStyle(.primary)
        }

        return AnyShapeStyle(Color.white)
    }

    private var textUIColor: UIColor {
        message.role == .assistant ? .label : .white
    }

    private var timestampText: String? {
        guard let createdAt = message.createdAt else {
            return nil
        }

        return createdAt.formatted(date: .omitted, time: .shortened)
    }

    private var timestampStyle: AnyShapeStyle {
        if message.role == .assistant {
            return AnyShapeStyle(.tertiary)
        }

        return AnyShapeStyle(Color.white.opacity(0.72))
    }

    private var progressTint: Color {
        message.role == .assistant ? .blue : .white
    }
}

private struct CommandOutputCard: View {
    let output: CommandOutputPanel
    @State private var isExpanded = false

    var body: some View {
        HStack {
            DisclosureGroup(isExpanded: $isExpanded) {
                ScrollView(.horizontal) {
                    VStack(alignment: .leading, spacing: 8) {
                        if let detail = output.detail,
                           detail != headlineText,
                           !detail.isEmpty {
                            Text(detail)
                                .font(.system(.caption, design: .monospaced))
                                .foregroundStyle(.secondary)
                                .textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }

                        Text(bodyText)
                            .font(.system(.footnote, design: .monospaced))
                            .foregroundStyle(output.text.isEmpty ? .secondary : .primary)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(.top, 8)
                }
            } label: {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        Image(systemName: "terminal")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(statusTint)
                        Text(headlineText)
                            .font(.caption.weight(.semibold))
                            .lineLimit(1)
                        Spacer(minLength: 0)
                        Text(statusLabel)
                            .font(.caption2.weight(.bold))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(statusTint.opacity(0.12), in: Capsule())
                            .foregroundStyle(statusTint)
                    }

                    if !previewText.isEmpty {
                        Text(previewText)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(Color(.secondarySystemGroupedBackground))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(statusTint.opacity(0.12), lineWidth: 1)
            )
            Spacer(minLength: 56)
        }
    }

    private var headlineText: String {
        if let detail = output.detail,
           !detail.isEmpty {
            return detail
        }

        return output.title
    }

    private var previewText: String {
        let trimmedOutput = output.text.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedOutput.isEmpty,
           let firstLine = trimmedOutput
                .split(whereSeparator: \.isNewline)
                .first?
                .trimmingCharacters(in: .whitespacesAndNewlines),
           !firstLine.isEmpty {
            return firstLine
        }

        switch output.state {
        case .running:
            return NSLocalizedString("conversation.commandOutput.noOutputRunning", comment: "")
        case .waitingApproval:
            return NSLocalizedString("conversation.commandOutput.waitingApproval", comment: "")
        case .completed:
            return NSLocalizedString("conversation.commandOutput.noOutputCompleted", comment: "")
        case .interrupted:
            return NSLocalizedString("conversation.commandOutput.interrupted", comment: "")
        case .failed:
            return NSLocalizedString("conversation.commandOutput.failed", comment: "")
        }
    }

    private var bodyText: String {
        if !output.text.isEmpty {
            return output.text
        }

        switch output.state {
        case .running:
            return NSLocalizedString("conversation.commandOutput.noOutputRunning", comment: "")
        case .waitingApproval:
            return NSLocalizedString("conversation.commandOutput.waitingApproval", comment: "")
        case .completed:
            return NSLocalizedString("conversation.commandOutput.noOutputCompleted", comment: "")
        case .interrupted:
            return NSLocalizedString("conversation.commandOutput.interrupted", comment: "")
        case .failed:
            return NSLocalizedString("conversation.commandOutput.failed", comment: "")
        }
    }

    private var statusLabel: String {
        switch output.state {
        case .running:
            return NSLocalizedString("conversation.commandStatus.running", comment: "")
        case .waitingApproval:
            return NSLocalizedString("conversation.commandStatus.waitingApproval", comment: "")
        case .completed:
            return NSLocalizedString("conversation.commandStatus.completed", comment: "")
        case .interrupted:
            return NSLocalizedString("conversation.commandStatus.interrupted", comment: "")
        case .failed:
            return NSLocalizedString("conversation.commandStatus.failed", comment: "")
        }
    }

    private var statusTint: Color {
        switch output.state {
        case .running:
            return .blue
        case .waitingApproval:
            return .orange
        case .completed:
            return .green
        case .interrupted:
            return .gray
        case .failed:
            return .red
        }
    }
}

private struct ApprovalCard: View {
    let approval: ApprovalCardModel
    let isResolving: Bool
    let canResolve: Bool
    let onApprove: () -> Void
    let onDeclineContinue: () -> Void
    let onCancelTurn: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    Label(approval.title, systemImage: "lock.shield")
                        .font(.headline)
                    Text(approval.summary)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 12)
                Text(approval.kind == .commandExecution ? NSLocalizedString("conversation.approval.command", comment: "") : NSLocalizedString("conversation.approval.file", comment: ""))
                    .font(.caption.weight(.bold))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 5)
                    .background(Color.orange.opacity(0.15), in: Capsule())
            }

            if let reason = approval.reason, !reason.isEmpty {
                detailLine(title: NSLocalizedString("conversation.approval.reason", comment: ""), value: reason)
            }

            if let command = approval.command, !command.isEmpty {
                detailLine(title: NSLocalizedString("conversation.approval.commandLabel", comment: ""), value: command, monospaced: true)
            }

            if let cwd = approval.cwd, !cwd.isEmpty {
                detailLine(title: NSLocalizedString("conversation.approval.directory", comment: ""), value: cwd, monospaced: true)
            }

            if let grantRoot = approval.grantRoot, !grantRoot.isEmpty {
                detailLine(title: NSLocalizedString("conversation.approval.grantRoot", comment: ""), value: grantRoot, monospaced: true)
            }

            if let aggregatedOutput = approval.aggregatedOutput, !aggregatedOutput.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text(NSLocalizedString("conversation.approval.currentOutput", comment: ""))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Text(aggregatedOutput)
                        .font(.system(.caption, design: .monospaced))
                        .textSelection(.enabled)
                }
                .padding(12)
                .background(Color.black.opacity(0.05), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }

            HStack(spacing: 10) {
                Button(action: onApprove) {
                    Label("conversation.approval.approve", systemImage: "checkmark")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(isResolving || !canResolve)

                Button(action: onDeclineContinue) {
                    Label("conversation.approval.declineAndContinue", systemImage: "arrow.triangle.branch")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .disabled(isResolving || !canResolve)
            }

            Button(role: .destructive, action: onCancelTurn) {
                Label("conversation.approval.cancelTurn", systemImage: "stop.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .disabled(isResolving || !canResolve)
        }
        .padding(16)
        .background(
            LinearGradient(
                colors: [Color.orange.opacity(0.16), Color.yellow.opacity(0.08)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            ),
            in: RoundedRectangle(cornerRadius: 22, style: .continuous)
        )
    }

    @ViewBuilder
    private func detailLine(title: String, value: String, monospaced: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            Text(value)
                .font(monospaced ? .system(.footnote, design: .monospaced) : .footnote)
                .foregroundStyle(.primary)
                .textSelection(.enabled)
        }
    }
}

private struct QueuedDraftBubble: View {
    let queuedDraft: QueuedDraftModel

    var body: some View {
        HStack {
            Spacer(minLength: 48)
            VStack(alignment: .leading, spacing: 6) {
                Label("conversation.queued", systemImage: "clock.badge")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Text(queuedDraft.text)
                    .font(.body)
                    .foregroundStyle(.primary)
            }
            .padding(14)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(style: StrokeStyle(lineWidth: 1.4, dash: [6, 4]))
                    .foregroundStyle(Color.blue.opacity(0.45))
            )
        }
    }
}

private struct PendingImageStrip: View {
    let attachments: [PendingImageAttachment]
    let onRemove: (String) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(attachments) { attachment in
                    HStack(spacing: 8) {
                        Image(systemName: "photo")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.blue)
                        Text("\(attachment.width)x\(attachment.height)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        Text(byteCountFormatter.string(fromByteCount: Int64(attachment.bytes)))
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        Button {
                            onRemove(attachment.id)
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(.thinMaterial, in: Capsule())
                }
            }
        }
    }

    private var byteCountFormatter: ByteCountFormatter {
        let formatter = ByteCountFormatter()
        formatter.allowedUnits = [.useKB, .useMB]
        formatter.countStyle = .file
        return formatter
    }
}

private struct ComposerBar: View {
    @Binding var text: String
    @Binding var photoSelection: [PhotosPickerItem]
    @FocusState private var isInputFocused: Bool

    let isTurnActive: Bool
    let hasQueuedDraft: Bool
    let hasPendingImages: Bool
    let isProcessingImages: Bool
    let canAttachImages: Bool
    let remainingImageSlots: Int
    let isInterrupting: Bool
    let canWriteToAgent: Bool
    let onSend: () -> Void
    let onStop: () -> Void

    var body: some View {
        HStack(alignment: .bottom, spacing: 12) {
            PhotosPicker(
                selection: $photoSelection,
                maxSelectionCount: max(1, remainingImageSlots),
                matching: .images
            ) {
                Image(systemName: isProcessingImages ? "hourglass.circle.fill" : "paperclip.circle.fill")
                    .font(.system(size: 28))
            }
            .disabled(!canAttachImages || isProcessingImages)

            TextField(placeholderText, text: $text, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .lineLimit(1...5)
                .focused($isInputFocused)
                .toolbar {
                    ToolbarItemGroup(placement: .keyboard) {
                        Spacer()
                        Button {
                            isInputFocused = false
                        } label: {
                            Image(systemName: "keyboard.chevron.compact.down")
                        }
                    }
                }

            if isTurnActive {
                Button(action: onStop) {
                    Image(systemName: isInterrupting ? "hourglass.circle.fill" : "stop.circle.fill")
                        .font(.system(size: 28))
                        .foregroundStyle(.pink)
                }
                .disabled(isInterrupting || !canWriteToAgent)
            }

            Button(action: onSend) {
                Image(systemName: primaryIcon)
                    .font(.system(size: 28))
            }
            .disabled(isPrimaryDisabled)
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 12)
    }

    private var placeholderText: String {
        if hasQueuedDraft {
            return NSLocalizedString("conversation.composer.queuedDraft", comment: "")
        }

        if isProcessingImages {
            return NSLocalizedString("conversation.composer.processingImages", comment: "")
        }

        if hasPendingImages {
            return isTurnActive ? NSLocalizedString("conversation.composer.activeWithImages", comment: "") : NSLocalizedString("conversation.composer.readyWithImages", comment: "")
        }

        return isTurnActive ? NSLocalizedString("conversation.composer.queueMessage", comment: "") : NSLocalizedString("conversation.composer.continueThread", comment: "")
    }

    private var primaryIcon: String {
        if isTurnActive {
            return hasQueuedDraft ? "clock.badge.checkmark.fill" : "plus.message.fill"
        }

        return "arrow.up.circle.fill"
    }

    private var isPrimaryDisabled: Bool {
        let hasText = !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        return !canWriteToAgent ||
            isProcessingImages ||
            (!hasText && !hasPendingImages) ||
            (isTurnActive && hasQueuedDraft) ||
            (isTurnActive && hasPendingImages)
    }
}

#Preview {
    NavigationStack {
        ConversationView(
            thread: ThreadSummary(
                id: "preview-thread",
                preview: NSLocalizedString("conversation.preview.continueThread", comment: ""),
                modelProvider: "openai",
                createdAt: 1_773_589_000,
                path: "/tmp",
                cwd: "/tmp",
                cliVersion: "0.1.0",
                source: "preview",
                gitInfo: nil
            )
        )
        .environmentObject(RelayConnection())
    }
}
