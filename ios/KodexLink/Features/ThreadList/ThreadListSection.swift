import Foundation

struct ThreadListSection: Identifiable, Hashable {
    let id: String
    let cwd: String
    let title: String
    let subtitle: String?
    let threads: [ThreadSummary]

    static func build(from threads: [ThreadSummary]) -> [ThreadListSection] {
        let grouped = Dictionary(grouping: threads, by: \.groupKey)

        return grouped
            .map { key, groupedThreads in
                ThreadListSection(
                    id: key.id,
                    cwd: key.cwd,
                    title: key.title,
                    subtitle: key.subtitle,
                    threads: groupedThreads.sorted(by: ThreadListSection.sortThreads)
                )
            }
            .sorted(by: sortSections)
    }

    private static func sortSections(lhs: ThreadListSection, rhs: ThreadListSection) -> Bool {
        let lhsNewest = lhs.threads.first?.createdAt ?? 0
        let rhsNewest = rhs.threads.first?.createdAt ?? 0

        if lhsNewest != rhsNewest {
            return lhsNewest > rhsNewest
        }

        if lhs.title != rhs.title {
            return lhs.title.localizedStandardCompare(rhs.title) == .orderedAscending
        }

        return lhs.id < rhs.id
    }

    private static func sortThreads(lhs: ThreadSummary, rhs: ThreadSummary) -> Bool {
        if lhs.createdAt != rhs.createdAt {
            return lhs.createdAt > rhs.createdAt
        }

        return lhs.id < rhs.id
    }
}

private struct ThreadListGroupKey: Hashable {
    let id: String
    let cwd: String
    let title: String
    let subtitle: String?
}

private extension ThreadSummary {
    var groupKey: ThreadListGroupKey {
        let fallbackPath = cwd.nonEmptyTrimmed ?? path.nonEmptyTrimmed ?? "Unknown Project"
        let displayPath = fallbackPath.normalizedThreadDisplayPath()
        let title = displayPath.displayLastPathComponent()

        return ThreadListGroupKey(
            id: "cwd:\(displayPath)",
            cwd: fallbackPath,
            title: title,
            subtitle: displayPath.abbreviatingHomeDirectory()
        )
    }
}

private extension String {
    var nonEmptyTrimmed: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    func abbreviatingHomeDirectory() -> String {
        let home = NSHomeDirectory()
        guard hasPrefix(home) else {
            return self
        }

        return "~" + dropFirst(home.count)
    }

    func normalizedThreadDisplayPath() -> String {
        if hasPrefix("\\\\?\\UNC\\") {
            return "\\\\" + dropFirst(8)
        }

        if hasPrefix("\\\\?\\") {
            return String(dropFirst(4))
        }

        return self
    }

    func displayLastPathComponent() -> String {
        let normalized = normalizedThreadDisplayPath()
        let components = normalized
            .split(whereSeparator: { $0 == "/" || $0 == "\\" })
            .map(String.init)

        return components.last?.nonEmptyTrimmed ?? normalized
    }
}
