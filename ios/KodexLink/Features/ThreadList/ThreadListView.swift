import SwiftUI

struct ThreadListView: View {
    @EnvironmentObject private var relayConnection: RelayConnection
    @StateObject private var viewModel = ThreadListViewModel()
    @State private var createdThread: ThreadSummary?
    @State private var pendingArchiveThread: ThreadSummary?

    var body: some View {
        Group {
            if viewModel.threads.isEmpty {
                ScrollView {
                    if viewModel.isLoading {
                        ProgressView("threads.loading")
                            .frame(maxWidth: .infinity)
                            .padding(.top, 120)
                    } else {
                        ThreadListEmptyState(
                            message: viewModel.errorMessage ?? emptyStateMessage,
                            isCreating: viewModel.isCreating,
                            canCreate: canCreateThread,
                            create: createThreadAndNavigate,
                            reload: reloadThreads
                        )
                        .padding(.top, 96)
                    }
                }
                .refreshable {
                    await reloadThreads()
                }
            } else {
                List {
                    ForEach(viewModel.sections) { section in
                        Section {
                            ThreadSectionHeaderRow(
                                section: section,
                                isCollapsed: viewModel.isSectionCollapsed(section),
                                isCreating: viewModel.isCreatingThread(in: section),
                                canCreate: canCreateThread && !viewModel.isCreating,
                                toggle: {
                                    viewModel.toggleSection(section)
                                },
                                create: {
                                    Task {
                                        await createThreadAndNavigate(cwd: section.cwd)
                                    }
                                }
                            )

                            if !viewModel.isSectionCollapsed(section) {
                                ForEach(section.threads) { thread in
                                    NavigationLink(destination: ConversationView(thread: thread)) {
                                        ThreadRow(thread: thread)
                                    }
                                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                        Button(role: .destructive) {
                                            pendingArchiveThread = thread
                                        } label: {
                                            Label(
                                                viewModel.isArchivingThread(thread) ? "threads.archiving" : "threads.archive",
                                                systemImage: "archivebox"
                                            )
                                        }
                                        .disabled(viewModel.isArchivingThread(thread) || !relayConnection.canWriteToAgent)
                                    }
                                }
                            }
                        }
                    }

                    if viewModel.hasMoreThreads || viewModel.isLoadingMore || viewModel.paginationErrorMessage != nil {
                        Section {
                            VStack(alignment: .center, spacing: 10) {
                                if viewModel.isLoadingMore {
                                    ProgressView("threads.loadingMore")
                                        .frame(maxWidth: .infinity)
                                } else if viewModel.hasMoreThreads {
                                    Button {
                                        Task {
                                            await loadMoreThreads()
                                        }
                                    } label: {
                                        Label("threads.loadMore", systemImage: "clock.arrow.trianglehead.counterclockwise.rotate.90")
                                            .frame(maxWidth: .infinity)
                                    }
                                    .buttonStyle(.bordered)
                                }

                                if let paginationErrorMessage = viewModel.paginationErrorMessage {
                                    Text(paginationErrorMessage)
                                        .font(.footnote)
                                        .foregroundStyle(.red)
                                        .frame(maxWidth: .infinity, alignment: .center)
                                }
                            }
                            .padding(.vertical, 8)
                            .frame(maxWidth: .infinity)
                        }
                    }
                }
                .listStyle(.insetGrouped)
                .refreshable {
                    await reloadThreads()
                }
            }
        }
        .navigationTitle(String(localized: "app.tab.threads"))
        .navigationDestination(item: $createdThread) { thread in
            ConversationView(thread: thread)
        }
        .confirmationDialog(
            "threads.archiveThread",
            isPresented: Binding(
                get: { pendingArchiveThread != nil },
                set: { isPresented in
                    if !isPresented {
                        pendingArchiveThread = nil
                    }
                }
            ),
            titleVisibility: .visible
        ) {
            Button("threads.archive", role: .destructive) {
                guard let thread = pendingArchiveThread else {
                    return
                }

                pendingArchiveThread = nil
                Task {
                    let archived = await viewModel.archiveThread(thread, using: relayConnection)
                    if archived {
                        await reloadThreads()
                    }
                }
            }

            Button("common.cancel", role: .cancel) {
                pendingArchiveThread = nil
            }
        } message: {
            Text("threads.archiveConfirm")
        }
        .alert(
            "threads.archiveFailed",
            isPresented: Binding(
                get: { viewModel.archiveErrorMessage != nil },
                set: { isPresented in
                    if !isPresented {
                        viewModel.archiveErrorMessage = nil
                    }
                }
            )
        ) {
            Button("common.ok", role: .cancel) {
                viewModel.archiveErrorMessage = nil
            }
        } message: {
            Text(viewModel.archiveErrorMessage ?? String(localized: "threads.archiveFailedMessage"))
        }
        .task {
            await reloadThreads()
        }
        .onChange(of: relayConnection.currentAgentStatus) { _, newStatus in
            guard newStatus == .online else {
                return
            }

            Task {
                await reloadThreads()
            }
        }
    }

    private func reloadThreads() async {
        await viewModel.loadThreads(using: relayConnection)
    }

    private func loadMoreThreads() async {
        await viewModel.loadMoreThreads(using: relayConnection)
    }

    private func createThreadAndNavigate() async {
        await createThreadAndNavigate(cwd: nil)
    }

    private func createThreadAndNavigate(cwd: String?) async {
        guard let thread = await viewModel.createThread(using: relayConnection, cwd: cwd) else {
            return
        }
        createdThread = thread
    }

    private var canCreateThread: Bool {
        relayConnection.canWriteToAgent
    }

    private var emptyStateMessage: String {
        if !relayConnection.canWriteToAgent {
            return relayConnection.writeUnavailableMessage
        }

        switch relayConnection.state {
        case .disconnected:
            return String(localized: "threads.emptyState.relayDisconnected")
        case .connecting:
            return String(localized: "threads.emptyState.relayConnecting")
        case .failed(let message):
            return String(format: String(localized: "threads.emptyState.relayFailed"), message)
        case .connected:
            break
        }

        switch relayConnection.currentAgentStatus {
        case .offline:
            return String(localized: "threads.emptyState.agentOffline")
        case .degraded:
            switch relayConnection.currentAgentDegradedReason {
            case .runtimeUnavailable:
                return String(localized: "threads.emptyState.runtimeUnavailable")
            case .requestFailures:
                return String(localized: "threads.emptyState.requestFailures")
            case nil:
                return String(localized: "threads.emptyState.degraded")
            }
        case .online:
            return String(localized: "threads.emptyState.noThreads")
        case .unknown:
            return String(localized: "threads.emptyState.syncing")
        }
    }
}

private struct ThreadSectionHeaderRow: View {
    let section: ThreadListSection
    let isCollapsed: Bool
    let isCreating: Bool
    let canCreate: Bool
    let toggle: () -> Void
    let create: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: 0) {
            Button(action: toggle) {
                HStack(spacing: 10) {
                    Image(systemName: isCollapsed ? "chevron.right" : "chevron.down")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(.tertiary)
                        .frame(width: 12)

                    Image(systemName: "folder.fill")
                        .font(.subheadline)
                        .foregroundStyle(.orange)

                    VStack(alignment: .leading, spacing: 1) {
                        Text(section.title)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.primary)
                        if let subtitle = section.subtitle {
                            Text(subtitle)
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                                .lineLimit(1)
                                .truncationMode(.middle)
                        }
                    }

                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            HStack(spacing: 8) {
                Text("\(section.threads.count)")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(Color(.systemFill), in: Capsule())

                Button(action: create) {
                    Image(systemName: isCreating ? "hourglass.circle.fill" : "plus.circle.fill")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(canCreate ? Color.accentColor : Color(.tertiaryLabel))
                }
                .buttonStyle(.plain)
                .disabled(!canCreate)
                .accessibilityLabel(Text("threads.newThread"))
            }
        }
        .padding(.vertical, 8)
        .listRowBackground(Color(.tertiarySystemGroupedBackground))
    }
}

private struct ThreadRow: View {
    let thread: ThreadSummary

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(Color.accentColor.opacity(0.12))
                    .frame(width: 40, height: 40)
                Image(systemName: "bubble.left.fill")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Color.accentColor)
            }
            .padding(.top, 2)

            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(thread.titleText)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                    Text(thread.createdAtDate.threadRelativeFormatted)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                        .fixedSize()
                }
            }
            .padding(.vertical, 2)
        }
        .padding(.vertical, 4)
    }
}

private extension Date {
    var threadRelativeFormatted: String {
        let calendar = Calendar.current
        let now = Date()
        if calendar.isDateInToday(self) {
            return formatted(date: .omitted, time: .shortened)
        } else if calendar.isDateInYesterday(self) {
            return String(localized: "threads.yesterday")
        } else if calendar.isDate(self, equalTo: now, toGranularity: .year) {
            return formatted(.dateTime.month(.abbreviated).day())
        } else {
            return formatted(.dateTime.year().month(.abbreviated).day())
        }
    }
}

private struct ThreadListEmptyState: View {
    let message: String
    let isCreating: Bool
    let canCreate: Bool
    let create: () async -> Void
    let reload: () async -> Void

    var body: some View {
        ContentUnavailableView {
            Label("threads.empty", systemImage: "message.badge")
        } description: {
            Text(message)
        } actions: {
            Button {
                Task {
                    await create()
                }
            } label: {
                Label(isCreating ? "threads.creating" : "threads.newThread", systemImage: "square.and.pencil")
            }
            .buttonStyle(.borderedProminent)
            .disabled(isCreating || !canCreate)

            Button {
                Task {
                    await reload()
                }
            } label: {
                Label("threads.reload", systemImage: "arrow.clockwise")
            }
            .buttonStyle(.bordered)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 24)
    }
}

#Preview {
    NavigationStack {
        ThreadListView()
    }
}
