package com.kodexlink.android.features.conversation

// Auto-generated from iOS: ios/KodexLink/Features/Conversation/ConversationViewModel.swift
// @Published + ObservableObject → StateFlow + ViewModel + Coroutines

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kodexlink.android.core.diagnostics.DiagnosticsLogger
import com.kodexlink.android.core.networking.RelayConnection
import com.kodexlink.android.core.networking.TurnEventHandlers
import com.kodexlink.android.core.protocol.*
import com.kodexlink.android.core.storage.ApprovalCardModelDto
import com.kodexlink.android.core.storage.CommandOutputPanelDto
import com.kodexlink.android.core.storage.ConversationRuntimeSnapshot
import com.kodexlink.android.core.storage.ConversationRuntimeStore
import com.kodexlink.android.core.storage.QueuedDraftModelDto
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.time.Instant
import java.util.UUID

class ConversationViewModel(
    private val runtimeStore: ConversationRuntimeStore = ConversationRuntimeStore.shared
) : ViewModel() {

    private val silenceThresholdMs = 8_000L
    private val maxImagesPerTurn = 2
    private val displayPageSize = 20
    private val threadResumeWindowSize = 20

    // ── Observable state ──────────────────────────────────────────────────

    private val _rows = MutableStateFlow<List<ConversationRow>>(emptyList())
    val rows: StateFlow<List<ConversationRow>> = _rows.asStateFlow()

    private val _draft = MutableStateFlow("")
    var draft: StateFlow<String> = _draft.asStateFlow()

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    private val _errorMessage = MutableStateFlow<String?>(null)
    val errorMessage: StateFlow<String?> = _errorMessage.asStateFlow()

    private val _turnStatus = MutableStateFlow<TurnStatusValue?>(null)
    val turnStatus: StateFlow<TurnStatusValue?> = _turnStatus.asStateFlow()

    private val _statusDetail = MutableStateFlow<String?>(null)
    val statusDetail: StateFlow<String?> = _statusDetail.asStateFlow()

    private val _activeTurnId = MutableStateFlow<String?>(null)
    val activeTurnId: StateFlow<String?> = _activeTurnId.asStateFlow()

    private val _isInterrupting = MutableStateFlow(false)
    val isInterrupting: StateFlow<Boolean> = _isInterrupting.asStateFlow()

    private val _isResolvingApproval = MutableStateFlow(false)
    val isResolvingApproval: StateFlow<Boolean> = _isResolvingApproval.asStateFlow()

    private val _pendingImageAttachments = MutableStateFlow<List<PendingImageAttachment>>(emptyList())
    val pendingImageAttachments: StateFlow<List<PendingImageAttachment>> = _pendingImageAttachments.asStateFlow()

    private val _oldestVisibleIndex = MutableStateFlow(0)
    val oldestVisibleIndex: StateFlow<Int> = _oldestVisibleIndex.asStateFlow()

    private val _turnStartedAt = MutableStateFlow<Instant?>(null)
    val turnStartedAt: StateFlow<Instant?> = _turnStartedAt.asStateFlow()

    private val _hasMoreHistoryBefore = MutableStateFlow(false)
    val hasMoreHistoryBefore: StateFlow<Boolean> = _hasMoreHistoryBefore.asStateFlow()

    private val _isLoadingOlderHistory = MutableStateFlow(false)
    val isLoadingOlderHistory: StateFlow<Boolean> = _isLoadingOlderHistory.asStateFlow()

    // ── Internal state ────────────────────────────────────────────────────

    private var loadedThreadId: String? = null
    private val baseMessages = mutableListOf<ConversationMessage>()
    private var currentAssistantPlaceholderId: String? = null
    private val currentAssistantMessageIdsByItemId = mutableMapOf<String, String>()
    private val commandOutputs = mutableListOf<CommandOutputPanel>()
    private val orderedItemIds = mutableListOf<String>()
    private var activeApproval: ApprovalCardModel? = null
    private var queuedDraft: QueuedDraftModel? = null
    private var baseStatusDetail: String? = null
    private var pendingInterrupt = false
    private var lastVisibleActivityAt: Instant? = null
    private var statusMonitorJob: Job? = null
    private var restoreValidationJob: Job? = null
    private var restoredStatePendingValidation = false
    private var relayConnectionRef: RelayConnection? = null
    private var lastReconnectRefreshEpoch: Long? = null
    private var loadThreadJob: Job? = null
    private var loadThreadGeneration: Long = 0L

    // ── Computed properties ───────────────────────────────────────────────

    val isTurnActive: Boolean
        get() {
            if (restoredStatePendingValidation) return false
            return when (_turnStatus.value) {
                TurnStatusValue.COMPLETED, TurnStatusValue.FAILED, TurnStatusValue.INTERRUPTED, null -> false
                else -> true
            }
        }

    val hasQueuedDraft: Boolean get() = queuedDraft != null

    val remainingImageSlots: Int get() = (maxImagesPerTurn - _pendingImageAttachments.value.size).coerceAtLeast(0)

    /** 正在流式输出的消息 ID（供 UI 显示打字光标）。对应 iOS currentStreamingMessageId。*/
    val streamingMessageId: String?
        get() = if (_turnStatus.value == TurnStatusValue.STREAMING) currentAssistantPlaceholderId else null

    val visibleRows: List<ConversationRow>
        get() {
            val idx = _oldestVisibleIndex.value
            return if (idx <= 0) _rows.value else _rows.value.drop(idx)
        }

    val hasOlderRows: Boolean get() = _oldestVisibleIndex.value > 0
    val canLoadOlderRows: Boolean get() = hasOlderRows || _hasMoreHistoryBefore.value

    private fun threadResumeResponseMetadata(
        response: ThreadResumeResponsePayload,
        beforeItemId: String? = null
    ): Map<String, String> = DiagnosticsLogger.metadata(
        mapOf(
            "beforeItemId" to beforeItemId,
            "windowSize" to threadResumeWindowSize.toString(),
            "messageCount" to response.messages.size.toString(),
            "timelineItemCount" to response.timelineItems.orEmpty().size.toString(),
            "hasMoreBefore" to (response.hasMoreBefore == true).toString(),
            "responseWindowKind" to if (response.timelineItems.isNullOrEmpty()) "messages" else "timeline",
            "firstMessageId" to response.messages.firstOrNull()?.id,
            "lastMessageId" to response.messages.lastOrNull()?.id,
            "firstTimelineItemId" to response.timelineItems.orEmpty().firstOrNull()?.id,
            "lastTimelineItemId" to response.timelineItems.orEmpty().lastOrNull()?.id
        )
    )

    fun loadOlderRows() {
        if (_oldestVisibleIndex.value > 0) {
            _oldestVisibleIndex.value = (_oldestVisibleIndex.value - displayPageSize).coerceAtLeast(0)
            return
        }

        val relayConnection = relayConnectionRef ?: return
        val threadId = loadedThreadId ?: return
        val beforeItemId = earliestLoadedItemId() ?: return
        if (!_hasMoreHistoryBefore.value || _isLoadingOlderHistory.value || _isLoading.value) {
            DiagnosticsLogger.debug(
                "ConversationRuntime",
                "load_older_history_skipped",
                mapOf(
                    "threadId" to threadId,
                    "hasMoreHistoryBefore" to _hasMoreHistoryBefore.value.toString(),
                    "isLoadingOlderHistory" to _isLoadingOlderHistory.value.toString(),
                    "isLoading" to _isLoading.value.toString()
                )
            )
            return
        }

        _isLoadingOlderHistory.value = true
        viewModelScope.launch {
            try {
                DiagnosticsLogger.info(
                    "ConversationRuntime",
                    "load_older_history_start",
                    mapOf(
                        "threadId" to threadId,
                        "beforeItemId" to beforeItemId,
                        "windowSize" to threadResumeWindowSize.toString()
                    )
                )
                val response = relayConnection.requestThreadResume(
                    threadId = threadId,
                    beforeItemId = beforeItemId,
                    windowSize = threadResumeWindowSize
                )
                mergeConversationHistory(response)
                rebuildRows()
                DiagnosticsLogger.info(
                    "ConversationRuntime",
                    "load_older_history_success",
                    DiagnosticsLogger.metadata(
                        mapOf("threadId" to threadId) + threadResumeResponseMetadata(
                            response,
                            beforeItemId
                        )
                    )
                )
            } catch (e: Exception) {
                _errorMessage.value = e.message
                DiagnosticsLogger.warning(
                    "ConversationRuntime",
                    "load_older_history_failed",
                    mapOf(
                        "threadId" to threadId,
                        "beforeItemId" to beforeItemId,
                        "error" to (e.message ?: "")
                    )
                )
            } finally {
                _isLoadingOlderHistory.value = false
            }
        }
    }

    // ── Public API ────────────────────────────────────────────────────────

    fun setDraft(text: String) { _draft.value = text }

    fun loadThread(relayConnection: RelayConnection, threadId: String, trigger: String = "unknown") {
        relayConnectionRef = relayConnection
        if (loadedThreadId == threadId && baseMessages.isNotEmpty()) {
            DiagnosticsLogger.debug(
                "ConversationRuntime",
                "load_thread_skipped_cached",
                mapOf("threadId" to threadId, "trigger" to trigger)
            )
            return
        }
        loadThreadJob?.cancel()
        val generation = ++loadThreadGeneration
        val switchingThread = loadedThreadId != threadId
        if (switchingThread) {
            prepareForThreadLoad(threadId)
        } else {
            _isLoading.value = true
            _errorMessage.value = null
        }
        loadThreadJob = viewModelScope.launch {
            DiagnosticsLogger.info(
                "ConversationRuntime",
                "load_thread_start",
                mapOf(
                    "threadId" to threadId,
                    "trigger" to trigger,
                    "switchingThread" to switchingThread.toString(),
                    "generation" to generation.toString()
                )
            )
            try {
                val response = relayConnection.requestThreadResume(
                    threadId = threadId,
                    windowSize = threadResumeWindowSize
                )
                if (generation != loadThreadGeneration) {
                    DiagnosticsLogger.debug(
                        "ConversationRuntime",
                        "load_thread_result_ignored_stale",
                        mapOf(
                            "threadId" to threadId,
                            "trigger" to trigger,
                            "generation" to generation.toString(),
                            "currentGeneration" to loadThreadGeneration.toString()
                        )
                    )
                    return@launch
                }
                loadedThreadId = response.threadId
                clearTransientState(keepStatus = false)
                replaceConversationHistory(response)
                restoreRuntime(response.threadId)   // mirror iOS: attempt snapshot restore
                rebuildRows(resetVisibleWindow = true)
                DiagnosticsLogger.info(
                    "ConversationRuntime",
                    "load_thread_success",
                    DiagnosticsLogger.metadata(
                        mapOf(
                            "threadId" to threadId,
                            "trigger" to trigger
                        ) + threadResumeResponseMetadata(response)
                    )
                )
            } catch (_: CancellationException) {
                DiagnosticsLogger.debug(
                    "ConversationRuntime",
                    "load_thread_cancelled",
                    mapOf(
                        "threadId" to threadId,
                        "trigger" to trigger,
                        "generation" to generation.toString()
                    )
                )
            } catch (e: Exception) {
                if (generation != loadThreadGeneration) {
                    DiagnosticsLogger.debug(
                        "ConversationRuntime",
                        "load_thread_failed_stale_ignored",
                        mapOf(
                            "threadId" to threadId,
                            "trigger" to trigger,
                            "generation" to generation.toString(),
                            "currentGeneration" to loadThreadGeneration.toString(),
                            "error" to (e.message ?: "")
                        )
                    )
                    return@launch
                }
                _errorMessage.value = e.message
                DiagnosticsLogger.warning(
                    "ConversationRuntime",
                    "load_thread_failed",
                    mapOf(
                        "threadId" to threadId,
                        "trigger" to trigger,
                        "error" to (e.message ?: "")
                    )
                )
            } finally {
                if (generation == loadThreadGeneration) {
                    _isLoading.value = false
                }
            }
        }
    }

    fun send(relayConnection: RelayConnection, threadId: String) {
        relayConnectionRef = relayConnection
        val trimmed = _draft.value.trim()
        val images = _pendingImageAttachments.value
        if (trimmed.isEmpty() && images.isEmpty()) {
            DiagnosticsLogger.debug(
                "ConversationRuntime",
                "send_skipped_empty_input",
                mapOf("threadId" to threadId)
            )
            return
        }

        if (isTurnActive) {
            if (images.isNotEmpty()) {
                _errorMessage.value = "Turn 进行中，不能附加图片"
                DiagnosticsLogger.warning(
                    "ConversationRuntime",
                    "send_blocked_active_turn_with_images",
                    mapOf("threadId" to threadId)
                )
                return
            }
            queueDraft(trimmed)
            _draft.value = ""
            return
        }

        if (!ensureWritable(relayConnection)) return

        val turnInputs = buildTurnInputs(trimmed, images)
        val userText = buildUserMessageText(trimmed, images.size)

        viewModelScope.launch {
            startTurn(relayConnection, threadId, userText, turnInputs, trimmed, images)
        }
    }

    fun interrupt(relayConnection: RelayConnection, threadId: String) {
        relayConnectionRef = relayConnection
        if (!isTurnActive || _isInterrupting.value) return
        if (!ensureWritable(relayConnection)) return
        _isInterrupting.value = true
        _turnStatus.value = TurnStatusValue.INTERRUPTING
        baseStatusDetail = "中断中..."
        refreshStatusDetail()

        val turnId = _activeTurnId.value
        if (turnId == null) {
            pendingInterrupt = true
            rebuildRows()
            return
        }
        viewModelScope.launch { performInterrupt(relayConnection, threadId, turnId) }
    }

    fun approve(relayConnection: RelayConnection) {
        relayConnectionRef = relayConnection
        viewModelScope.launch { resolveApproval(relayConnection, ApprovalDecision.ACCEPT) }
    }

    fun declineAndContinue(relayConnection: RelayConnection) {
        relayConnectionRef = relayConnection
        viewModelScope.launch { resolveApproval(relayConnection, ApprovalDecision.DECLINE) }
    }

    fun cancelCurrentTurn(relayConnection: RelayConnection) {
        relayConnectionRef = relayConnection
        viewModelScope.launch { resolveApproval(relayConnection, ApprovalDecision.CANCEL) }
    }

    fun removePendingImage(id: String) {
        _pendingImageAttachments.value = _pendingImageAttachments.value.filter { it.id != id }
    }

    /**
     * 从 Gallery URI 读取图片，压缩后转为 base64 data URL 并加入附件列表。
     * 对应 iOS addImageAttachment(from:)。
     */
    fun addImageAttachment(context: Context, uri: Uri) {
        if (_pendingImageAttachments.value.size >= maxImagesPerTurn) {
            _errorMessage.value = "最多同时附加 $maxImagesPerTurn 张图片"
            return
        }
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val inputStream = context.contentResolver.openInputStream(uri) ?: return@launch
                val bitmap = BitmapFactory.decodeStream(inputStream)
                inputStream.close()

                // 长边缩放到 1024px 以节省传输带宽
                val maxSide = 1024
                val scaled = if (bitmap.width > maxSide || bitmap.height > maxSide) {
                    val scale = maxSide.toFloat() / maxOf(bitmap.width, bitmap.height)
                    Bitmap.createScaledBitmap(
                        bitmap,
                        (bitmap.width * scale).toInt(),
                        (bitmap.height * scale).toInt(),
                        true
                    )
                } else bitmap

                val baos = ByteArrayOutputStream()
                scaled.compress(Bitmap.CompressFormat.JPEG, 82, baos)
                val bytes = baos.toByteArray()
                val base64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
                val dataURL = "data:image/jpeg;base64,$base64"

                val attachment = PendingImageAttachment(
                    id = UUID.randomUUID().toString(),
                    dataURL = dataURL,
                    bytes = bytes.size,
                    width = scaled.width,
                    height = scaled.height
                )
                withContext(Dispatchers.Main) {
                    if (_pendingImageAttachments.value.size < maxImagesPerTurn) {
                        _pendingImageAttachments.value = _pendingImageAttachments.value + attachment
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    _errorMessage.value = "图片加载失败：${e.message}"
                }
            }
        }
    }

    /**
     * 重连后刷新历史（对应 iOS refreshAfterReconnect）。
     * 若当前 Turn 进行中则跳过（避免打断实时流）；否则静默重加载历史。
     */
    fun refreshAfterReconnect(
        relayConnection: RelayConnection,
        threadId: String,
        trigger: String,
        connectionEpoch: Long
    ) {
        val tid = loadedThreadId ?: return
        if (tid != threadId) return
        if (_isLoading.value || isTurnActive) {
            DiagnosticsLogger.debug(
                "ConversationRuntime",
                "refresh_after_reconnect_skipped_busy",
                mapOf(
                    "threadId" to threadId,
                    "trigger" to trigger,
                    "connectionEpoch" to connectionEpoch.toString(),
                    "isLoading" to _isLoading.value.toString(),
                    "isTurnActive" to isTurnActive.toString()
                )
            )
            return
        }
        if (lastReconnectRefreshEpoch == connectionEpoch) {
            DiagnosticsLogger.debug(
                "ConversationRuntime",
                "refresh_after_reconnect_skipped_duplicate",
                mapOf(
                    "threadId" to threadId,
                    "trigger" to trigger,
                    "connectionEpoch" to connectionEpoch.toString()
                )
            )
            return
        }
        relayConnectionRef = relayConnection
        lastReconnectRefreshEpoch = connectionEpoch
        viewModelScope.launch {
            try {
                DiagnosticsLogger.info(
                    "ConversationRuntime",
                    "refresh_after_reconnect_start",
                    mapOf(
                        "threadId" to threadId,
                        "trigger" to trigger,
                        "connectionEpoch" to connectionEpoch.toString()
                    )
                )
                val response = relayConnection.requestThreadResume(
                    threadId = threadId,
                    windowSize = threadResumeWindowSize
                )
                replaceConversationHistory(response)
                rebuildRows()
                DiagnosticsLogger.info(
                    "ConversationRuntime",
                    "refresh_after_reconnect_ok",
                    DiagnosticsLogger.metadata(
                        mapOf(
                            "threadId" to threadId,
                            "trigger" to trigger,
                            "connectionEpoch" to connectionEpoch.toString()
                        ) + threadResumeResponseMetadata(response)
                    )
                )
            } catch (e: Exception) {
                lastReconnectRefreshEpoch = null
                DiagnosticsLogger.warning(
                    "ConversationRuntime",
                    "refresh_after_reconnect_failed",
                    mapOf(
                        "threadId" to threadId,
                        "trigger" to trigger,
                        "connectionEpoch" to connectionEpoch.toString(),
                        "error" to (e.message ?: "")
                    )
                )
            }
        }
    }

    // ── Turn lifecycle ────────────────────────────────────────────────────

    private suspend fun startTurn(
        relayConnection: RelayConnection,
        threadId: String,
        userText: String,
        turnInputs: List<TurnInputItem>,
        originalDraft: String,
        originalImages: List<PendingImageAttachment>
    ) {
        val now = Instant.now()
        clearTransientState(keepStatus = false)
        _draft.value = ""
        _pendingImageAttachments.value = emptyList()
        _errorMessage.value = null
        _isInterrupting.value = false
        pendingInterrupt = false
        _activeTurnId.value = null
        commandOutputs.clear()
        activeApproval = null
        _turnStartedAt.value = now
        lastVisibleActivityAt = now
        _turnStatus.value = TurnStatusValue.STARTING
        baseStatusDetail = "启动中..."
        refreshStatusDetail()
        startStatusMonitor()

        val userMsg = ConversationMessage(
            id = UUID.randomUUID().toString(),
            role = ThreadMessageRole.USER,
            text = userText,
            turnId = null,
            createdAt = now
        )
        currentAssistantPlaceholderId = null
        currentAssistantMessageIdsByItemId.clear()
        baseMessages.add(userMsg)
        recordTimelineItemId(userMsg.id)
        rebuildRows()
        advanceVisibleWindow()

        DiagnosticsLogger.info("ConversationRuntime", "start_turn",
            mapOf("threadId" to threadId, "inputCount" to turnInputs.size.toString()))

        val handlers = TurnEventHandlers(
            onStatus = { payload -> handleTurnStatus(payload, relayConnection, threadId) },
            onDelta = { payload -> appendAssistantDelta(payload) },
            onCommandOutput = { payload -> appendCommandOutput(payload) },
            onApprovalRequested = { payload -> showApproval(payload) },
            completion = { result ->
                result.onSuccess { completed ->
                    finishTurnCompletion(completed)
                    if (completed.status == "failed") {
                        _errorMessage.value = completed.errorMessage ?: "发送失败"
                    }
                }.onFailure { e ->
                    if (e is com.kodexlink.android.core.networking.RelayConnectionError.TurnInterrupted) {
                        // 用户主动中断：不恢复草稿，仅清理状态
                        _turnStatus.value = TurnStatusValue.INTERRUPTED
                        _isInterrupting.value = false
                        baseStatusDetail = null
                        refreshStatusDetail()
                        stopStatusMonitor()
                        _turnStartedAt.value = null
                        rebuildRows()
                        persistRuntime(threadId)
                    } else {
                        // 网络或其他错误：恢复草稿，显示错误
                        _draft.value = originalDraft
                        _pendingImageAttachments.value = originalImages
                        _errorMessage.value = e.message
                        clearTransientState(keepStatus = false)
                        rebuildRows()
                    }
                }
            }
        )
        try {
            relayConnection.sendTurnStart(threadId, turnInputs, handlers)
        } catch (e: Exception) {
            _draft.value = originalDraft
            _pendingImageAttachments.value = originalImages
            _errorMessage.value = e.message
            clearTransientState(keepStatus = false)
            rebuildRows()
            DiagnosticsLogger.warning(
                "ConversationRuntime",
                "start_turn_send_failed",
                mapOf("threadId" to threadId, "error" to (e.message ?: ""))
            )
        }
    }

    private fun handleTurnStatus(
        payload: TurnStatusPayload,
        relayConnection: RelayConnection,
        threadId: String
    ) {
        confirmLiveTurnActivity()   // validates any restored snapshot
        noteVisibleActivity()
        payload.turnId?.let { tid ->
            _activeTurnId.value = tid
            if (pendingInterrupt && !_isInterrupting.value) {
                viewModelScope.launch { interrupt(relayConnection, threadId) }
            } else if (pendingInterrupt) {
                viewModelScope.launch { performInterrupt(relayConnection, threadId, tid) }
            }
        }
        _turnStatus.value = payload.status
        baseStatusDetail = payload.detail ?: fallbackStatusDetail(payload.status)

        when (payload.status) {
            TurnStatusValue.RUNNING_COMMAND -> {
                payload.turnId?.let { tid ->
                    upsertCommandOutput(tid, payload.itemId, payload.detail ?: "执行输出", CommandOutputState.RUNNING, payload.detail)
                }
            }
            TurnStatusValue.WAITING_APPROVAL -> {
                baseStatusDetail = payload.detail ?: "等待审批"
                payload.turnId?.let { tid ->
                    upsertCommandOutput(tid, payload.itemId, payload.detail ?: "执行输出", CommandOutputState.WAITING_APPROVAL, payload.detail)
                }
            }
            TurnStatusValue.COMPLETED, TurnStatusValue.FAILED, TurnStatusValue.INTERRUPTED -> {
                _isInterrupting.value = false
                stopStatusMonitor()
            }
            else -> {}
        }
        refreshStatusDetail()
        rebuildRows()
    }

    private fun appendAssistantDelta(payload: TurnDeltaPayload) {
        confirmLiveTurnActivity()
        noteVisibleActivity()
        _activeTurnId.value = payload.turnId
        val placeholderId = ensureAssistantMessagePlaceholder(payload.itemId, payload.turnId)
        currentAssistantPlaceholderId = placeholderId
        val idx = baseMessages.indexOfFirst { it.id == placeholderId }
        if (idx < 0) return
        baseMessages[idx] = baseMessages[idx].copy(text = baseMessages[idx].text + payload.delta)
        if (_turnStatus.value == TurnStatusValue.STARTING) {
            _turnStatus.value = TurnStatusValue.STREAMING
            baseStatusDetail = fallbackStatusDetail(TurnStatusValue.STREAMING)
            refreshStatusDetail()
        }
        patchLastAssistantRow()
    }

    private fun appendCommandOutput(payload: CommandOutputDeltaPayload) {
        confirmLiveTurnActivity()
        noteVisibleActivity()
        val title = if (payload.source == ExecutionOutputSource.COMMAND_EXECUTION) "执行输出" else "文件变更"
        upsertCommandOutput(payload.turnId, payload.itemId, title, CommandOutputState.RUNNING, null, payload.delta)
        if (_turnStatus.value != TurnStatusValue.WAITING_APPROVAL) {
            _turnStatus.value = TurnStatusValue.RUNNING_COMMAND
            baseStatusDetail = fallbackStatusDetail(TurnStatusValue.RUNNING_COMMAND)
            refreshStatusDetail()
        }
        rebuildRows()
    }

    private fun showApproval(payload: ApprovalRequestedPayload) {
        noteVisibleActivity()
        val title = if (payload.kind == ApprovalKind.COMMAND_EXECUTION) "需要审批命令" else "需要审批文件变更"
        val summary = payload.command?.takeIf { it.isNotEmpty() }
            ?: payload.reason?.takeIf { it.isNotEmpty() }
            ?: payload.grantRoot?.takeIf { it.isNotEmpty() }
            ?: "待审批"

        activeApproval = ApprovalCardModel(
            id = payload.approvalId,
            approvalId = payload.approvalId,
            threadId = payload.threadId,
            turnId = payload.turnId,
            kind = payload.kind,
            title = title,
            summary = summary,
            reason = payload.reason,
            command = payload.command,
            cwd = payload.cwd,
            aggregatedOutput = payload.aggregatedOutput,
            grantRoot = payload.grantRoot
        )
        _turnStatus.value = TurnStatusValue.WAITING_APPROVAL
        baseStatusDetail = "等待审批"
        refreshStatusDetail()
        rebuildRows()
    }

    private fun finishTurnCompletion(payload: TurnCompletedPayload) {
        _turnStatus.value = when (payload.status) {
            "failed" -> TurnStatusValue.FAILED
            "interrupted" -> TurnStatusValue.INTERRUPTED
            else -> TurnStatusValue.COMPLETED
        }
        _isInterrupting.value = false
        baseStatusDetail = null
        refreshStatusDetail()
        stopStatusMonitor()
        pendingInterrupt = false
        _turnStartedAt.value = null   // Bug fix: 清除计时器起点，防止后台计时持续

        // Finalize any streaming assistant message
        currentAssistantPlaceholderId?.let { pid ->
            val idx = baseMessages.indexOfFirst { it.id == pid }
            if (idx >= 0 && baseMessages[idx].text.isEmpty()) {
                baseMessages[idx] = baseMessages[idx].copy(text = payload.text)
            }
        }

        // Finalize command outputs
        commandOutputs.replaceAll { it.copy(state = CommandOutputState.COMPLETED) }

        activeApproval = null
        rebuildRows()
        persistRuntime(payload.threadId)
        DiagnosticsLogger.info("ConversationRuntime", "turn_completed",
            mapOf("turnId" to payload.turnId, "status" to payload.status))
    }

    private suspend fun performInterrupt(
        relayConnection: RelayConnection,
        threadId: String,
        turnId: String
    ) {
        DiagnosticsLogger.info(
            "ConversationRuntime",
            "interrupt_start",
            mapOf("threadId" to threadId, "turnId" to turnId)
        )
        try {
            relayConnection.sendTurnInterrupt(TurnInterruptRequestPayload(threadId, turnId))
            pendingInterrupt = false
            DiagnosticsLogger.info(
                "ConversationRuntime",
                "interrupt_success",
                mapOf("threadId" to threadId, "turnId" to turnId)
            )
        } catch (e: Exception) {
            _errorMessage.value = e.message
            DiagnosticsLogger.warning(
                "ConversationRuntime",
                "interrupt_failed",
                mapOf(
                    "threadId" to threadId,
                    "turnId" to turnId,
                    "error" to (e.message ?: "")
                )
            )
            throw e
        }
    }

    private suspend fun resolveApproval(relayConnection: RelayConnection, decision: ApprovalDecision) {
        val approval = activeApproval ?: return
        if (_isResolvingApproval.value) return
        if (!ensureWritable(relayConnection)) return
        _isResolvingApproval.value = true
        try {
            DiagnosticsLogger.info(
                "ConversationRuntime",
                "resolve_approval_start",
                mapOf(
                    "approvalId" to approval.approvalId,
                    "threadId" to approval.threadId,
                    "turnId" to approval.turnId,
                    "decision" to decision.name
                )
            )
            relayConnection.sendApprovalResolve(
                ApprovalResolveRequestPayload(approval.approvalId, approval.threadId, approval.turnId, decision)
            )
            activeApproval = null
            _turnStatus.value = if (decision == ApprovalDecision.CANCEL) TurnStatusValue.INTERRUPTING else TurnStatusValue.RUNNING_COMMAND
            baseStatusDetail = when (decision) {
                ApprovalDecision.ACCEPT -> "已批准"
                ApprovalDecision.DECLINE -> "已拒绝"
                ApprovalDecision.CANCEL -> "停止中..."
            }
            noteVisibleActivity()
            refreshStatusDetail()
            rebuildRows()
            DiagnosticsLogger.info(
                "ConversationRuntime",
                "resolve_approval_success",
                mapOf(
                    "approvalId" to approval.approvalId,
                    "decision" to decision.name
                )
            )
        } catch (e: Exception) {
            _errorMessage.value = e.message
            DiagnosticsLogger.warning(
                "ConversationRuntime",
                "resolve_approval_failed",
                mapOf(
                    "approvalId" to approval.approvalId,
                    "decision" to decision.name,
                    "error" to (e.message ?: "")
                )
            )
        } finally {
            _isResolvingApproval.value = false
        }
    }

    private fun ensureWritable(relayConnection: RelayConnection): Boolean {
        if (relayConnection.canWriteToAgent) return true

        val reason = relayConnection.writeUnavailableMessage
        _errorMessage.value = reason
        DiagnosticsLogger.warning(
            "ConversationRuntime",
            "ensure_writable_failed",
            mapOf("reason" to reason)
        )
        return false
    }

    // ── Row building ──────────────────────────────────────────────────────

    private fun rebuildRows(resetVisibleWindow: Boolean = false) {
        val result = mutableListOf<ConversationRow>()

        // Base messages and command outputs interleaved by orderedItemIds
        val commandOutputsById = commandOutputs.associateBy { it.id }
        val messagesById = baseMessages.associateBy { it.id }

        for (itemId in orderedItemIds) {
            messagesById[itemId]?.let { result.add(ConversationRow.Message(it)) }
            commandOutputsById[itemId]?.let { result.add(ConversationRow.CommandOutput(it)) }
        }

        // Remaining (not in orderedItemIds)
        val seen = orderedItemIds.toSet()
        baseMessages.filter { it.id !in seen }.forEach { result.add(ConversationRow.Message(it)) }
        commandOutputs.filter { it.id !in seen }.forEach { result.add(ConversationRow.CommandOutput(it)) }

        activeApproval?.let { result.add(ConversationRow.Approval(it)) }
        queuedDraft?.let { result.add(ConversationRow.QueuedDraft(it)) }

        _rows.value = result
        if (resetVisibleWindow) {
            _oldestVisibleIndex.value = (result.size - displayPageSize).coerceAtLeast(0)
        }
    }

    private data class ParsedConversationHistory(
        val messages: List<ConversationMessage>,
        val commandOutputs: List<CommandOutputPanel>,
        val orderedItemIds: List<String>
    )

    private fun patchLastAssistantRow() {
        val pid = currentAssistantPlaceholderId ?: return
        val msg = baseMessages.firstOrNull { it.id == pid } ?: return
        val rows = _rows.value.toMutableList()
        val idx = rows.indexOfFirst { it is ConversationRow.Message && it.message.id == pid }
        if (idx >= 0) rows[idx] = ConversationRow.Message(msg)
        else rows.add(ConversationRow.Message(msg))
        _rows.value = rows
    }

    private fun advanceVisibleWindow() {
        val rows = _rows.value
        if (_oldestVisibleIndex.value < rows.size - displayPageSize) {
            _oldestVisibleIndex.value = (rows.size - displayPageSize).coerceAtLeast(0)
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    private fun ensureAssistantMessagePlaceholder(itemId: String?, turnId: String?): String {
        if (itemId != null) {
            currentAssistantMessageIdsByItemId[itemId]?.let { id ->
                if (baseMessages.any { it.id == id }) return id
            }
        } else {
            currentAssistantPlaceholderId?.let { pid ->
                if (baseMessages.any { it.id == pid }) return pid
            }
        }
        val msgId = itemId ?: UUID.randomUUID().toString()
        val msg = ConversationMessage(msgId, ThreadMessageRole.ASSISTANT, "", turnId, Instant.now())
        baseMessages.add(msg)
        recordTimelineItemId(msgId)
        if (itemId != null) currentAssistantMessageIdsByItemId[itemId] = msgId
        else currentAssistantPlaceholderId = msgId
        return msgId
    }

    private fun upsertCommandOutput(
        turnId: String,
        itemId: String?,
        title: String,
        state: CommandOutputState,
        detail: String?,
        appendedText: String? = null
    ) {
        val id = itemId ?: turnId
        val existing = commandOutputs.indexOfFirst { it.id == id }
        if (existing >= 0) {
            commandOutputs[existing] = commandOutputs[existing].let { panel ->
                panel.copy(
                    state = state,
                    detail = detail ?: panel.detail,
                    text = panel.text + (appendedText ?: "")
                )
            }
        } else {
            commandOutputs.add(CommandOutputPanel(id, id, turnId, title, appendedText ?: "", state, detail, Instant.now()))
            recordTimelineItemId(id)
        }
    }

    private fun recordTimelineItemId(id: String, before: String? = null) {
        if (orderedItemIds.contains(id)) return
        if (before != null) {
            val idx = orderedItemIds.indexOf(before)
            if (idx >= 0) { orderedItemIds.add(idx, id); return }
        }
        orderedItemIds.add(id)
    }

    private fun parseConversationHistory(response: ThreadResumeResponsePayload): ParsedConversationHistory {
        val timelineItems = response.timelineItems
        if (!timelineItems.isNullOrEmpty()) {
            val nextMessages = mutableListOf<ConversationMessage>()
            val nextOutputs = mutableListOf<CommandOutputPanel>()
            val nextOrderedItemIds = mutableListOf<String>()
            for (item in timelineItems) {
                if (!nextOrderedItemIds.contains(item.id)) {
                    nextOrderedItemIds.add(item.id)
                }
                val msg = ConversationMessage.from(item)
                if (msg != null) { nextMessages.add(msg); continue }
                val output = CommandOutputPanel.from(item)
                if (output != null) nextOutputs.add(output)
            }
            return ParsedConversationHistory(
                messages = nextMessages,
                commandOutputs = nextOutputs,
                orderedItemIds = nextOrderedItemIds
            )
        }

        val nextMessages = response.messages.map { ConversationMessage.from(it) }
        return ParsedConversationHistory(
            messages = nextMessages,
            commandOutputs = emptyList(),
            orderedItemIds = nextMessages.map { it.id }
        )
    }

    private fun replaceConversationHistory(response: ThreadResumeResponsePayload) {
        val parsed = parseConversationHistory(response)
        baseMessages.clear()
        baseMessages.addAll(parsed.messages)
        commandOutputs.clear()
        commandOutputs.addAll(parsed.commandOutputs)
        orderedItemIds.clear()
        orderedItemIds.addAll(parsed.orderedItemIds)
        _hasMoreHistoryBefore.value = response.hasMoreBefore == true
    }

    private fun mergeConversationHistory(response: ThreadResumeResponsePayload) {
        val parsed = parseConversationHistory(response)
        val mergedMessages = linkedMapOf<String, ConversationMessage>()
        parsed.messages.forEach { mergedMessages[it.id] = it }
        baseMessages.forEach { mergedMessages.putIfAbsent(it.id, it) }
        baseMessages.clear()
        baseMessages.addAll(mergedMessages.values)

        val mergedOutputs = linkedMapOf<String, CommandOutputPanel>()
        parsed.commandOutputs.forEach { mergedOutputs[it.id] = it }
        commandOutputs.forEach { mergedOutputs.putIfAbsent(it.id, it) }
        commandOutputs.clear()
        commandOutputs.addAll(mergedOutputs.values)

        val mergedOrderedIds = linkedSetOf<String>()
        mergedOrderedIds.addAll(parsed.orderedItemIds)
        mergedOrderedIds.addAll(orderedItemIds)
        orderedItemIds.clear()
        orderedItemIds.addAll(mergedOrderedIds)

        _hasMoreHistoryBefore.value = response.hasMoreBefore == true
    }

    private fun earliestLoadedItemId(): String? {
        return orderedItemIds.firstOrNull() ?: baseMessages.firstOrNull()?.id
    }

    private fun prepareForThreadLoad(threadId: String) {
        loadedThreadId = threadId
        lastReconnectRefreshEpoch = null
        loadThreadJob = null
        stopStatusMonitor()
        restoreValidationJob?.cancel()
        restoreValidationJob = null
        clearTransientState(keepStatus = false)
        baseMessages.clear()
        orderedItemIds.clear()
        _rows.value = emptyList()
        _oldestVisibleIndex.value = 0
        _hasMoreHistoryBefore.value = false
        _isLoadingOlderHistory.value = false
        _turnStartedAt.value = null
        lastVisibleActivityAt = null
        _errorMessage.value = null
        _isLoading.value = true
    }

    private fun clearTransientState(keepStatus: Boolean) {
        if (!keepStatus) {
            _turnStatus.value = null
            baseStatusDetail = null
            _activeTurnId.value = null
        }
        currentAssistantPlaceholderId = null
        currentAssistantMessageIdsByItemId.clear()
        commandOutputs.clear()
        activeApproval = null
        queuedDraft = null
        pendingInterrupt = false
        _isInterrupting.value = false
        restoredStatePendingValidation = false
    }

    private fun queueDraft(text: String) {
        if (queuedDraft != null) { _errorMessage.value = "已有排队消息"; return }
        queuedDraft = QueuedDraftModel(UUID.randomUUID().toString(), text)
        _errorMessage.value = null
        rebuildRows()
    }

    private fun buildTurnInputs(text: String, attachments: List<PendingImageAttachment>): List<TurnInputItem> {
        val inputs = mutableListOf<TurnInputItem>()
        if (text.isNotEmpty()) inputs.add(TurnInputItem.text(text))
        attachments.forEach { inputs.add(TurnInputItem.image(it.dataURL)) }
        return inputs
    }

    private fun buildUserMessageText(text: String, imageCount: Int): String {
        if (imageCount == 0) return text
        if (text.isEmpty()) return "已发送 $imageCount 张图片"
        return "$text\n[附带 $imageCount 张图片]"
    }

    private fun fallbackStatusDetail(status: TurnStatusValue) = when (status) {
        TurnStatusValue.STARTING -> "启动中..."
        TurnStatusValue.STREAMING -> "正在回复..."
        TurnStatusValue.RUNNING_COMMAND -> "执行命令中..."
        TurnStatusValue.WAITING_APPROVAL -> "等待审批"
        TurnStatusValue.INTERRUPTING -> "中断中..."
        TurnStatusValue.COMPLETED -> null
        TurnStatusValue.INTERRUPTED -> null
        TurnStatusValue.FAILED -> "失败"
    }

    private fun refreshStatusDetail() {
        _statusDetail.value = baseStatusDetail
    }

    private fun noteVisibleActivity() {
        lastVisibleActivityAt = Instant.now()
    }

    private fun startStatusMonitor() {
        stopStatusMonitor()
        statusMonitorJob = viewModelScope.launch {
            while (true) {
                delay(silenceThresholdMs)
                val last = lastVisibleActivityAt ?: continue
                if (Instant.now().toEpochMilli() - last.toEpochMilli() >= silenceThresholdMs) {
                    DiagnosticsLogger.warning("ConversationRuntime", "status_monitor_silence_detected")
                }
            }
        }
    }

    private fun stopStatusMonitor() {
        statusMonitorJob?.cancel()
        statusMonitorJob = null
    }

    // ── Runtime persistence ───────────────────────────────────────────────

    /** Mirrors iOS persistRuntimeIfNeeded() */
    private fun persistRuntime(threadId: String) {
        val shouldPersist =
            _activeTurnId.value != null ||
            commandOutputs.isNotEmpty() ||
            activeApproval != null ||
            queuedDraft != null ||
            shouldPersistStatusOnly

        if (!shouldPersist) {
            runtimeStore.removeSnapshot(threadId)
            return
        }

        val snapshot = ConversationRuntimeSnapshot(
            threadId = threadId,
            turnStatus = _turnStatus.value,
            statusDetail = _statusDetail.value,
            activeTurnId = _activeTurnId.value,
            commandOutputs = commandOutputs.map { it.toDto() },
            orderedItemIds = orderedItemIds.toList(),
            activeApproval = activeApproval?.toDto(),
            queuedDraft = queuedDraft?.let { QueuedDraftModelDto(it.id, it.text) },
            turnStartedAtMs = _turnStartedAt.value?.toEpochMilli(),
            lastVisibleActivityAtMs = lastVisibleActivityAt?.toEpochMilli()
        )
        runtimeStore.save(snapshot)
    }

    private val shouldPersistStatusOnly: Boolean
        get() = !restoredStatePendingValidation && isRestorableInFlightStatus(_turnStatus.value)

    private fun isRestorableInFlightStatus(status: TurnStatusValue?): Boolean = when (status) {
        TurnStatusValue.STARTING, TurnStatusValue.STREAMING,
        TurnStatusValue.RUNNING_COMMAND, TurnStatusValue.WAITING_APPROVAL,
        TurnStatusValue.INTERRUPTING -> true
        else -> false
    }

    /** Mirrors iOS restoreRuntime(for:). Called after history loads. */
    private fun restoreRuntime(threadId: String) {
        val snapshot = runtimeStore.snapshot(threadId) ?: run {
            DiagnosticsLogger.debug("ConversationRuntime", "restore_runtime_no_snapshot",
                mapOf("threadId" to threadId))
            return
        }

        DiagnosticsLogger.info("ConversationRuntime", "restore_runtime_found_snapshot",
            mapOf("threadId" to threadId,
                  "snapshotTurnId" to (snapshot.activeTurnId ?: ""),
                  "snapshotStatus" to (snapshot.turnStatus?.name ?: "")))

        if (shouldDiscardSnapshot(snapshot)) {
            runtimeStore.removeSnapshot(threadId)
            DiagnosticsLogger.warning("ConversationRuntime", "restore_runtime_discard_snapshot",
                mapOf("threadId" to threadId, "turnId" to (snapshot.activeTurnId ?: "")))
            return
        }

        // Restore transient state from snapshot
        _turnStatus.value = snapshot.turnStatus
        _activeTurnId.value = snapshot.activeTurnId
        commandOutputs.clear()
        commandOutputs.addAll(snapshot.commandOutputs.map { it.toDomain() })
        orderedItemIds.clear()
        orderedItemIds.addAll(snapshot.orderedItemIds)
        activeApproval = snapshot.activeApproval?.toDomain()
        queuedDraft = snapshot.queuedDraft?.let { QueuedDraftModel(it.id, it.text) }
        _turnStartedAt.value = snapshot.turnStartedAtMs?.let { java.time.Instant.ofEpochMilli(it) }
        lastVisibleActivityAt = snapshot.lastVisibleActivityAtMs?.let { java.time.Instant.ofEpochMilli(it) }

        if (isRestorableInFlightStatus(snapshot.turnStatus)) {
            if (snapshot.activeTurnId != null) {
                beginRestoreValidation(threadId)
            } else {
                beginRestoreValidation(threadId)
            }
        } else {
            rebuildRows()
        }
    }

    private fun shouldDiscardSnapshot(snapshot: ConversationRuntimeSnapshot): Boolean {
        val activeTurnId = snapshot.activeTurnId ?: return false
        if (!isRestorableInFlightStatus(snapshot.turnStatus)) return false
        return baseMessages.any { msg ->
            msg.turnId == activeTurnId &&
            msg.role == ThreadMessageRole.ASSISTANT &&
            msg.text.trim().isNotEmpty()
        }
    }

    private fun beginRestoreValidation(threadId: String) {
        DiagnosticsLogger.info("ConversationRuntime", "restore_validation_begin",
            mapOf("threadId" to threadId))
        restoredStatePendingValidation = true
        baseStatusDetail = "正在校准状态..."
        _statusDetail.value = baseStatusDetail
        stopStatusMonitor()
        // Clear live turn fields but keep status display
        _activeTurnId.value = null
        activeApproval = null
        commandOutputs.clear()
        _isInterrupting.value = false
        pendingInterrupt = false
        _turnStartedAt.value = null
        lastVisibleActivityAt = null

        // If there's a queued draft and the input is empty, restore it
        queuedDraft?.let { q ->
            if (_draft.value.trim().isEmpty()) {
                _draft.value = q.text
                queuedDraft = null
            }
        }

        rebuildRows()
        cancelRestoreValidation()
        restoreValidationJob = viewModelScope.launch {
            delay(2_000L)
            downgradeRestoredInFlightState(threadId)
        }
    }

    fun confirmLiveTurnActivity() {
        if (!restoredStatePendingValidation) return
        DiagnosticsLogger.info("ConversationRuntime", "restore_validation_confirmed_live")
        restoredStatePendingValidation = false
        cancelRestoreValidation()
        if (baseStatusDetail == "正在校准状态...") {
            baseStatusDetail = _turnStatus.value?.let { fallbackStatusDetail(it) }
        }
        startStatusMonitorIfNeeded()
        refreshStatusDetail()
    }

    private fun downgradeRestoredInFlightState(threadId: String) {
        if (!restoredStatePendingValidation || loadedThreadId != threadId) return
        DiagnosticsLogger.warning("ConversationRuntime", "restore_validation_downgraded",
            mapOf("threadId" to threadId))
        clearTransientState(keepStatus = false)
        runtimeStore.removeSnapshot(threadId)
        rebuildRows()
    }

    private fun cancelRestoreValidation() {
        restoreValidationJob?.cancel()
        restoreValidationJob = null
    }

    private fun startStatusMonitorIfNeeded() {
        if (isRestorableInFlightStatus(_turnStatus.value) && statusMonitorJob == null) {
            startStatusMonitor()
        }
    }

    // ── DTO conversion helpers ─────────────────────────────────────────────

    private fun CommandOutputPanel.toDto() = CommandOutputPanelDto(
        id = id, itemId = itemId, turnId = turnId, title = title,
        text = text, state = state.name, detail = detail,
        createdAtMs = createdAt?.toEpochMilli()
    )

    private fun CommandOutputPanelDto.toDomain() = CommandOutputPanel(
        id = id, itemId = itemId, turnId = turnId, title = title,
        text = text,
        state = runCatching { CommandOutputState.valueOf(state) }.getOrElse { CommandOutputState.COMPLETED },
        detail = detail,
        createdAt = createdAtMs?.let { java.time.Instant.ofEpochMilli(it) }
    )

    private fun ApprovalCardModel.toDto() = ApprovalCardModelDto(
        id = id, approvalId = approvalId, threadId = threadId, turnId = turnId,
        kind = kind, title = title, summary = summary, reason = reason,
        command = command, cwd = cwd, aggregatedOutput = aggregatedOutput, grantRoot = grantRoot
    )

    private fun ApprovalCardModelDto.toDomain() = ApprovalCardModel(
        id = id, approvalId = approvalId, threadId = threadId, turnId = turnId,
        kind = kind, title = title, summary = summary, reason = reason,
        command = command, cwd = cwd, aggregatedOutput = aggregatedOutput, grantRoot = grantRoot
    )

    // ── Data class ────────────────────────────────────────────────────────

    data class PendingImageAttachment(
        val id: String,
        val dataURL: String,
        val bytes: Int,
        val width: Int,
        val height: Int
    )
}
