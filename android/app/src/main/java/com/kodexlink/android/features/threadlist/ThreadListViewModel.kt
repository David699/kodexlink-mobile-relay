package com.kodexlink.android.features.threadlist

// 对齐 iOS: ios/KodexLink/Features/ThreadList/ThreadListViewModel.swift
// 新增：归档、分节(sections)、分页错误、归档错误

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kodexlink.android.core.diagnostics.DiagnosticsLogger
import com.kodexlink.android.core.networking.RelayConnection
import com.kodexlink.android.core.protocol.ThreadSummary
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class ThreadListViewModel(
    private val relayConnection: RelayConnection
) : ViewModel() {

    private val _threads = MutableStateFlow<List<ThreadSummary>>(emptyList())
    val threads: StateFlow<List<ThreadSummary>> = _threads.asStateFlow()

    /** 按 cwd 分组的节列表，对应 iOS sections computed property */
    val sections: StateFlow<List<ThreadListSection>> = _threads
        .map { ThreadListSection.build(it) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    private val _isLoadingMore = MutableStateFlow(false)
    val isLoadingMore: StateFlow<Boolean> = _isLoadingMore.asStateFlow()

    private val _isCreating = MutableStateFlow(false)
    val isCreating: StateFlow<Boolean> = _isCreating.asStateFlow()

    private val _errorMessage = MutableStateFlow<String?>(null)
    val errorMessage: StateFlow<String?> = _errorMessage.asStateFlow()

    /** 加载更多时的分页错误，不覆盖主列表错误 */
    private val _paginationErrorMessage = MutableStateFlow<String?>(null)
    val paginationErrorMessage: StateFlow<String?> = _paginationErrorMessage.asStateFlow()

    /** 归档操作失败的错误消息 */
    private val _archiveErrorMessage = MutableStateFlow<String?>(null)
    val archiveErrorMessage: StateFlow<String?> = _archiveErrorMessage.asStateFlow()

    /** 正在归档中的 threadId 集合 */
    private val _archivingThreadIds = MutableStateFlow<Set<String>>(emptySet())
    val archivingThreadIds: StateFlow<Set<String>> = _archivingThreadIds.asStateFlow()

    private val _hasMoreThreads = MutableStateFlow(false)
    val hasMoreThreads: StateFlow<Boolean> = _hasMoreThreads.asStateFlow()

    /** 折叠的 section ID 集合，对应 iOS collapsedSectionIDs */
    private val _collapsedSectionIDs = MutableStateFlow<Set<String>>(emptySet())
    val collapsedSectionIDs: StateFlow<Set<String>> = _collapsedSectionIDs.asStateFlow()

    /** 当前正在为哪个 cwd 新建线程，对应 iOS creatingThreadCWD */
    private val _creatingThreadCWD = MutableStateFlow<String?>(null)
    val creatingThreadCWD: StateFlow<String?> = _creatingThreadCWD.asStateFlow()

    private var nextCursor: String? = null
    private var pageSize = 20
    private var pendingForcedReloadReason: String? = null

    fun isArchivingThread(threadId: String): Boolean =
        _archivingThreadIds.value.contains(threadId)

    /** 对应 iOS isSectionCollapsed(_:) */
    fun isSectionCollapsed(sectionId: String): Boolean =
        _collapsedSectionIDs.value.contains(sectionId)

    /** 对应 iOS toggleSection(_:) */
    fun toggleSection(sectionId: String) {
        val current = _collapsedSectionIDs.value
        _collapsedSectionIDs.value = if (current.contains(sectionId)) {
            current - sectionId
        } else {
            current + sectionId
        }
    }

    /** 对应 iOS isCreatingThread(in:) */
    fun isCreatingThread(sectionCwd: String): Boolean =
        _isCreating.value && _creatingThreadCWD.value == sectionCwd

    // ── 加载 ──────────────────────────────────────────────────────────────────

    fun loadThreads(limit: Int = 20, reason: String = "manual", force: Boolean = false) {
        if (_isLoading.value) {
            if (force) {
                pendingForcedReloadReason = reason
            }
            DiagnosticsLogger.info(
                "ThreadListViewModel",
                "load_threads_skipped_loading",
                mapOf(
                    "reason" to reason,
                    "force" to force.toString(),
                    "pendingForcedReloadReason" to (pendingForcedReloadReason ?: "null"),
                    "currentCount" to _threads.value.size.toString()
                )
            )
            return
        }
        pageSize = limit.coerceAtLeast(1)
        viewModelScope.launch {
            _isLoading.value = true
            _errorMessage.value = null
            _paginationErrorMessage.value = null
            DiagnosticsLogger.info(
                "ThreadListViewModel",
                "load_threads_start",
                mapOf(
                    "reason" to reason,
                    "force" to force.toString(),
                    "limit" to pageSize.toString(),
                    "currentCount" to _threads.value.size.toString()
                )
            )
            try {
                val response = relayConnection.requestThreadList(limit = pageSize)
                _threads.value = sortThreads(response.items)
                nextCursor = response.nextCursor
                _hasMoreThreads.value = response.nextCursor != null
                DiagnosticsLogger.info(
                    "ThreadListViewModel",
                    "load_threads_success",
                    DiagnosticsLogger.metadata(
                        mapOf(
                            "reason" to reason,
                            "force" to force.toString(),
                            "itemCount" to response.items.size.toString(),
                            "hasMore" to (response.nextCursor != null).toString(),
                            "firstThreadId" to response.items.firstOrNull()?.id,
                            "firstThreadPreview" to response.items.firstOrNull()?.preview
                        )
                    )
                )
            } catch (e: Exception) {
                nextCursor = null
                _hasMoreThreads.value = false
                _errorMessage.value = e.message
                DiagnosticsLogger.warning(
                    "ThreadListViewModel",
                    "load_threads_failed",
                    mapOf(
                        "reason" to reason,
                        "force" to force.toString(),
                        "error" to (e.message ?: "")
                    )
                )
            } finally {
                _isLoading.value = false
                val queuedReason = pendingForcedReloadReason
                pendingForcedReloadReason = null
                if (queuedReason != null) {
                    DiagnosticsLogger.info(
                        "ThreadListViewModel",
                        "load_threads_run_queued_refresh",
                        mapOf("reason" to queuedReason)
                    )
                    loadThreads(limit = pageSize, reason = queuedReason, force = true)
                }
            }
        }
    }

    fun loadMoreThreads() {
        if (_isLoading.value || _isLoadingMore.value) return
        val cursor = nextCursor ?: return
        viewModelScope.launch {
            _isLoadingMore.value = true
            _paginationErrorMessage.value = null
            try {
                val response = relayConnection.requestThreadList(limit = pageSize, cursor = cursor)
                _threads.value = mergeThreads(_threads.value, response.items)
                nextCursor = response.nextCursor
                _hasMoreThreads.value = response.nextCursor != null
            } catch (e: Exception) {
                _paginationErrorMessage.value = e.message // 不污染主 errorMessage
            } finally {
                _isLoadingMore.value = false
            }
        }
    }

    // ── 新建 ──────────────────────────────────────────────────────────────────

    fun createThread(cwd: String? = null, onCreated: (ThreadSummary?) -> Unit = {}) {
        if (_isCreating.value) { onCreated(null); return }
        viewModelScope.launch {
            _isCreating.value = true
            _creatingThreadCWD.value = cwd
            _errorMessage.value = null
            try {
                val response = relayConnection.requestThreadCreate(cwd = cwd)
                upsertThread(response.thread)
                onCreated(response.thread)
            } catch (e: Exception) {
                _errorMessage.value = e.message
                onCreated(null)
            } finally {
                _isCreating.value = false
                _creatingThreadCWD.value = null
            }
        }
    }

    fun createThread() { createThread(cwd = null) }

    // ── 归档 ──────────────────────────────────────────────────────────────────

    /**
     * 归档指定线程。对应 iOS archiveThread(_:using:)。
     * 成功后从本地列表移除；失败则设置 archiveErrorMessage。
     */
    fun archiveThread(threadId: String, onArchived: (Boolean) -> Unit = {}) {
        if (_archivingThreadIds.value.contains(threadId)) { onArchived(false); return }
        viewModelScope.launch {
            _archivingThreadIds.value = _archivingThreadIds.value + threadId
            _archiveErrorMessage.value = null
            try {
                relayConnection.requestThreadArchive(threadId = threadId)
                _threads.value = _threads.value.filter { it.id != threadId }
                onArchived(true)
            } catch (e: Exception) {
                _archiveErrorMessage.value = e.message
                onArchived(false)
            } finally {
                _archivingThreadIds.value = _archivingThreadIds.value - threadId
            }
        }
    }

    fun clearArchiveError() { _archiveErrorMessage.value = null }

    // ── 私有 ──────────────────────────────────────────────────────────────────

    private fun upsertThread(thread: ThreadSummary) {
        val existing = _threads.value.toMutableList()
        val idx = existing.indexOfFirst { it.id == thread.id }
        if (idx >= 0) existing[idx] = thread else existing.add(thread)
        _threads.value = sortThreads(existing)
    }

    private fun sortThreads(items: List<ThreadSummary>) = items.sortedWith(
        compareByDescending<ThreadSummary> { it.createdAt }.thenBy { it.id }
    )

    private fun mergeThreads(existing: List<ThreadSummary>, incoming: List<ThreadSummary>): List<ThreadSummary> {
        val merged = existing.associateBy { it.id }.toMutableMap()
        incoming.forEach { merged[it.id] = it }
        return sortThreads(merged.values.toList())
    }
}
