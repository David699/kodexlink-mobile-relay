import Foundation
import Combine

@MainActor
final class ThreadListViewModel: ObservableObject {
    @Published var threads: [ThreadSummary] = []
    @Published var isLoading = false
    @Published var isLoadingMore = false
    @Published var isCreating = false
    @Published var errorMessage: String?
    @Published var paginationErrorMessage: String?
    @Published var archiveErrorMessage: String?
    @Published private var collapsedSectionIDs: Set<String> = []
    @Published private var archivingThreadIDs: Set<String> = []
    @Published private var creatingThreadCWD: String?
    @Published private(set) var hasMoreThreads = false

    private var nextCursor: String?
    private var pageSize = 20

    var sections: [ThreadListSection] {
        ThreadListSection.build(from: threads)
    }

    func isSectionCollapsed(_ section: ThreadListSection) -> Bool {
        collapsedSectionIDs.contains(section.id)
    }

    func toggleSection(_ section: ThreadListSection) {
        if collapsedSectionIDs.contains(section.id) {
            collapsedSectionIDs.remove(section.id)
        } else {
            collapsedSectionIDs.insert(section.id)
        }
    }

    func isArchivingThread(_ thread: ThreadSummary) -> Bool {
        archivingThreadIDs.contains(thread.id)
    }

    func isCreatingThread(in section: ThreadListSection) -> Bool {
        isCreating && creatingThreadCWD == section.cwd
    }

    func loadThreads(using relayConnection: RelayConnection, limit: Int = 20) async {
        guard !isLoading else {
            return
        }

        pageSize = max(1, limit)
        isLoading = true
        errorMessage = nil
        paginationErrorMessage = nil

        defer {
            isLoading = false
        }

        do {
            let response = try await relayConnection.requestThreadList(limit: pageSize)
            threads = sortThreads(response.items)
            nextCursor = response.nextCursor
            hasMoreThreads = response.nextCursor != nil
        } catch {
            nextCursor = nil
            hasMoreThreads = false
            errorMessage = error.localizedDescription
        }
    }

    func loadMoreThreads(using relayConnection: RelayConnection) async {
        guard !isLoading,
              !isLoadingMore,
              let nextCursor else {
            return
        }

        isLoadingMore = true
        paginationErrorMessage = nil

        defer {
            isLoadingMore = false
        }

        do {
            let response = try await relayConnection.requestThreadList(limit: pageSize, cursor: nextCursor)
            threads = mergeThreads(existing: threads, incoming: response.items)
            self.nextCursor = response.nextCursor
            hasMoreThreads = response.nextCursor != nil
        } catch {
            paginationErrorMessage = error.localizedDescription
        }
    }

    func createThread(using relayConnection: RelayConnection, cwd: String? = nil) async -> ThreadSummary? {
        guard !isCreating else {
            return nil
        }

        isCreating = true
        creatingThreadCWD = cwd
        errorMessage = nil
        defer {
            isCreating = false
            creatingThreadCWD = nil
        }

        do {
            let response = try await relayConnection.requestThreadCreate(cwd: cwd)
            let createdThread = response.thread
            upsertThread(createdThread)
            return createdThread
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func archiveThread(_ thread: ThreadSummary, using relayConnection: RelayConnection) async -> Bool {
        guard !archivingThreadIDs.contains(thread.id) else {
            return false
        }

        archivingThreadIDs.insert(thread.id)
        archiveErrorMessage = nil

        defer {
            archivingThreadIDs.remove(thread.id)
        }

        do {
            _ = try await relayConnection.requestThreadArchive(threadId: thread.id)
            threads.removeAll { $0.id == thread.id }
            return true
        } catch {
            archiveErrorMessage = error.localizedDescription
            return false
        }
    }

    private func upsertThread(_ thread: ThreadSummary) {
        var updatedThreads = threads

        if let existingIndex = updatedThreads.firstIndex(where: { $0.id == thread.id }) {
            updatedThreads[existingIndex] = thread
        } else {
            updatedThreads.append(thread)
        }

        threads = sortThreads(updatedThreads)
    }

    private func sortThreads(_ items: [ThreadSummary]) -> [ThreadSummary] {
        items.sorted { lhs, rhs in
            if lhs.createdAt != rhs.createdAt {
                return lhs.createdAt > rhs.createdAt
            }

            return lhs.id < rhs.id
        }
    }

    private func mergeThreads(existing: [ThreadSummary], incoming: [ThreadSummary]) -> [ThreadSummary] {
        var mergedById = Dictionary(uniqueKeysWithValues: existing.map { ($0.id, $0) })
        for thread in incoming {
            mergedById[thread.id] = thread
        }

        return sortThreads(Array(mergedById.values))
    }
}
