// Auto-generated from iOS: ios/KodexLink/Features/ThreadList/ThreadListSection.swift，生成时间：2026-03-26T00:00:00Z
package com.kodexlink.android.features.threadlist

import com.kodexlink.android.core.protocol.ThreadSummary

/**
 * Represents a group of threads sharing the same working-directory (cwd).
 *
 * Mirrors iOS ThreadListSection (struct → data class).
 * Identifiable.id + Hashable → data class equality.
 */
data class ThreadListSection(
    val id: String,
    val cwd: String,
    val title: String,
    val subtitle: String?,
    val threads: List<ThreadSummary>
) {
    companion object {
        /**
         * Groups a flat list of [ThreadSummary] into sections by cwd,
         * then sorts sections and threads within each section.
         *
         * Mirrors iOS: static func build(from threads: [ThreadSummary]) -> [ThreadListSection]
         */
        fun build(from: List<ThreadSummary>): List<ThreadListSection> {
            return from
                .groupBy { it.groupKey() }
                .map { (key, groupedThreads) ->
                    ThreadListSection(
                        id = key.id,
                        cwd = key.cwd,
                        title = key.title,
                        subtitle = key.subtitle,
                        threads = groupedThreads.sortedWith(threadComparator)
                    )
                }
                .sortedWith(sectionComparator)
        }

        // ── Comparators ──────────────────────────────────────────────────────

        /** Sections sorted by newest thread first, then title asc, then id asc. */
        private val sectionComparator: Comparator<ThreadListSection> =
            Comparator { lhs, rhs ->
                val lhsNewest = lhs.threads.firstOrNull()?.createdAt ?: 0L
                val rhsNewest = rhs.threads.firstOrNull()?.createdAt ?: 0L
                when {
                    lhsNewest != rhsNewest -> rhsNewest.compareTo(lhsNewest) // desc
                    lhs.title != rhs.title -> lhs.title.compareTo(rhs.title, ignoreCase = true)
                    else -> lhs.id.compareTo(rhs.id)
                }
            }

        /** Threads sorted by createdAt desc, then id asc. */
        private val threadComparator: Comparator<ThreadSummary> =
            Comparator { lhs, rhs ->
                when {
                    lhs.createdAt != rhs.createdAt -> rhs.createdAt.compareTo(lhs.createdAt)
                    else -> lhs.id.compareTo(rhs.id)
                }
            }
    }
}

// ── Private group-key helpers ────────────────────────────────────────────────

/**
 * Mirrors iOS ThreadListGroupKey + ThreadSummary.groupKey extension.
 */
private data class ThreadListGroupKey(
    val id: String,
    val cwd: String,
    val title: String,
    val subtitle: String?
)

private fun ThreadSummary.groupKey(): ThreadListGroupKey {
    val fallbackPath = cwd.nonEmptyTrimmed() ?: path.nonEmptyTrimmed() ?: "Unknown Project"
    val displayPath = fallbackPath.normalizedThreadDisplayPath()
    val title = displayPath.displayLastPathComponent()
    return ThreadListGroupKey(
        id = "cwd:$displayPath",
        cwd = fallbackPath,
        title = title,
        subtitle = displayPath.abbreviatingHomeDirectory()
    )
}

// ── String extensions ────────────────────────────────────────────────────────

/** Returns the trimmed string if non-empty, otherwise null. */
private fun String.nonEmptyTrimmed(): String? {
    val t = trim()
    return if (t.isEmpty()) null else t
}

/**
 * Replaces the user home directory prefix with "~".
 * Mirrors iOS String.abbreviatingHomeDirectory().
 */
private fun String.abbreviatingHomeDirectory(): String {
    val home = System.getProperty("user.home") ?: return this
    return if (startsWith(home)) "~" + substring(home.length) else this
}

/**
 * Normalizes Windows extended-length paths.
 * Mirrors iOS String.normalizedThreadDisplayPath().
 */
private fun String.normalizedThreadDisplayPath(): String {
    if (startsWith("\\\\?\\UNC\\")) return "\\\\" + substring(8)
    if (startsWith("\\\\?\\")) return substring(4)
    return this
}

/**
 * Extracts the last path component, handling both / and \ separators.
 * Mirrors iOS String.displayLastPathComponent().
 */
private fun String.displayLastPathComponent(): String {
    val normalized = normalizedThreadDisplayPath()
    val components = normalized.split('/', '\\').filter { it.isNotBlank() }
    return components.lastOrNull()?.nonEmptyTrimmed() ?: normalized
}
