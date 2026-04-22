@file:OptIn(ExperimentalMaterial3Api::class)
package com.kodexlink.android.features.conversation

// 对齐 iOS: ios/KodexLink/Features/Conversation/ConversationView.swift
// Round 3+4: ThinkingTimePill、计时器、连接横幅、动态 Composer、图片附件条、流式光标

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.kodexlink.android.core.diagnostics.DiagnosticsLogger
import com.kodexlink.android.core.networking.AgentStatus
import com.kodexlink.android.core.networking.ConnectionState
import com.kodexlink.android.core.networking.RelayConnection
import com.kodexlink.android.core.protocol.*
import com.kodexlink.android.R
import com.kodexlink.android.ConnectionStatusChrome
import com.kodexlink.android.core.ui.AssistantAvatarView
import com.kodexlink.android.core.ui.ChatAvatarStyle
import com.kodexlink.android.core.ui.MessageTextView
import com.kodexlink.android.core.ui.UserAvatarStore
import com.kodexlink.android.core.ui.UserAvatarView
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlin.math.max

@Composable
fun ConversationView(
    thread: ThreadSummary,
    viewModel: ConversationViewModel,
    relayConnection: RelayConnection,
    userAvatarStore: UserAvatarStore,
    onBack: () -> Unit
) {
    val rows by viewModel.rows.collectAsState()
    val draft by viewModel.draft.collectAsState()
    val isLoading by viewModel.isLoading.collectAsState()
    val turnStatus by viewModel.turnStatus.collectAsState()
    val statusDetail by viewModel.statusDetail.collectAsState()
    val errorMessage by viewModel.errorMessage.collectAsState()
    val isInterrupting by viewModel.isInterrupting.collectAsState()
    val turnStartedAt by viewModel.turnStartedAt.collectAsState()
    val pendingImages by viewModel.pendingImageAttachments.collectAsState()
    val oldestVisibleIndex by viewModel.oldestVisibleIndex.collectAsState()
    val hasMoreHistoryBefore by viewModel.hasMoreHistoryBefore.collectAsState()
    val isLoadingOlderHistory by viewModel.isLoadingOlderHistory.collectAsState()
    val connectionState by relayConnection.state.collectAsState()
    val agentStatus by relayConnection.agentStatus.collectAsState()
    val connectionEpoch by relayConnection.connectionEpoch.collectAsState()
    val canWriteToAgent = relayConnection.canWriteToAgent
    val shouldShowTransportBanner = connectionState !is ConnectionState.Connected

    val context = LocalContext.current
    val assistantAvatarStyle = ChatAvatarStyle.load(context)

    BackHandler(onBack = onBack)

    val listState = rememberLazyListState()
    val threadId = thread.id
    val visibleRows = remember(rows, oldestVisibleIndex) {
        if (oldestVisibleIndex <= 0) rows else rows.drop(oldestVisibleIndex)
    }
    val canLoadOlderRows = oldestVisibleIndex > 0 || hasMoreHistoryBefore

    // ── 思考计时器 ────────────────────────────────────────────────────────────
    var thinkingSeconds by remember { mutableStateOf(0) }
    LaunchedEffect(turnStartedAt) {
        val startedAt = turnStartedAt
        if (startedAt == null) { thinkingSeconds = 0; return@LaunchedEffect }
        while (true) {
            thinkingSeconds = max(0, ((System.currentTimeMillis() - startedAt.toEpochMilli()) / 1000).toInt())
            delay(1_000)
        }
    }

    // ── 加载当前线程 ──────────────────────────────────────────────────────────
    LaunchedEffect(threadId) {
        DiagnosticsLogger.info(
            "ConversationView",
            "load_thread_requested",
            mapOf("threadId" to threadId, "trigger" to "conversation_screen_enter")
        )
        viewModel.loadThread(relayConnection, threadId, trigger = "conversation_screen_enter")
    }

    // ── 新消息自动滚动 ────────────────────────────────────────────────────────
    LaunchedEffect(visibleRows.size) {
        val targetIndex = visibleRows.indices.lastOrNull() ?: return@LaunchedEffect
        runCatching {
            listState.animateScrollToItem(targetIndex)
        }.onFailure { error ->
            if (error is CancellationException) {
                throw error
            }
            DiagnosticsLogger.warning(
                "ConversationView",
                "auto_scroll_failed",
                mapOf(
                    "threadId" to threadId,
                    "targetIndex" to targetIndex.toString(),
                    "visibleRowCount" to visibleRows.size.toString(),
                    "error" to (error.message ?: error.javaClass.simpleName)
                )
            )
        }
    }

    // ── 认证成功后的单次刷新 ───────────────────────────────────────────────────
    LaunchedEffect(threadId, connectionEpoch) {
        if (connectionEpoch <= 0L) return@LaunchedEffect
        DiagnosticsLogger.info(
            "ConversationView",
            "refresh_after_reconnect_requested",
            mapOf(
                "threadId" to threadId,
                "trigger" to "connection_epoch",
                "connectionEpoch" to connectionEpoch.toString(),
                "connectionState" to connectionState.javaClass.simpleName,
                "agentStatus" to agentStatus.name
            )
        )
        viewModel.refreshAfterReconnect(
            relayConnection = relayConnection,
            threadId = threadId,
            trigger = "connection_epoch",
            connectionEpoch = connectionEpoch
        )
    }

    // ── 图片选取器 ────────────────────────────────────────────────────────────
    val imagePickerLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.GetContent()
    ) { uri -> uri?.let { viewModel.addImageAttachment(context, it) } }

    // 当前流式消息 ID（触发重组时读取，turnStatus/rows 变化均会刷新）
    val streamingMessageId = viewModel.streamingMessageId

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(thread.titleText) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.action_back))
                    }
                },
                actions = {
                    if (viewModel.isTurnActive && turnStartedAt != null) {
                        ThinkingTimePill(
                            seconds = thinkingSeconds,
                            turnStatus = turnStatus,
                            modifier = Modifier.padding(end = 8.dp)
                        )
                    }
                }
            )
        },
        bottomBar = {
            ConversationComposer(
                draft = draft,
                onDraftChange = { viewModel.setDraft(it) },
                onSend = { viewModel.send(relayConnection, threadId) },
                onStop = { viewModel.interrupt(relayConnection, threadId) },
                onAttachImage = { imagePickerLauncher.launch("image/*") },
                isTurnActive = viewModel.isTurnActive,
                isInterrupting = isInterrupting,
                statusDetail = statusDetail,
                canWriteToAgent = canWriteToAgent,
                pendingImages = pendingImages,
                onRemoveImage = { viewModel.removePendingImage(it) },
                remainingImageSlots = viewModel.remainingImageSlots
            )
        }
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            ConnectionStatusChrome(relayConnection = relayConnection)

            // 连接断开横幅
            if (shouldShowTransportBanner) {
                ConnectionBanner(
                    message = relayConnection.writeUnavailableMessage,
                    state = connectionState
                )
            }

            // 错误横幅
            errorMessage?.let { msg ->
                Surface(color = MaterialTheme.colorScheme.errorContainer, modifier = Modifier.fillMaxWidth()) {
                    Text(
                        msg,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                        color = MaterialTheme.colorScheme.onErrorContainer,
                        style = MaterialTheme.typography.bodySmall
                    )
                }
            }

            if (isLoading && rows.isNotEmpty()) {
                LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            }

            if (isLoading && rows.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            } else {
                LazyColumn(
                    state = listState,
                    contentPadding = PaddingValues(vertical = 12.dp),
                    modifier = Modifier.weight(1f)
                ) {
                    if (canLoadOlderRows) {
                        item {
                            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                                TextButton(
                                    enabled = !isLoadingOlderHistory,
                                    onClick = { viewModel.loadOlderRows() }
                                ) {
                                    if (isLoadingOlderHistory) {
                                        CircularProgressIndicator(
                                            modifier = Modifier.size(16.dp),
                                            strokeWidth = 2.dp
                                        )
                                    } else {
                                        Icon(Icons.Default.History, null, Modifier.size(16.dp))
                                    }
                                    Spacer(Modifier.width(4.dp))
                                    Text(stringResource(R.string.conversation_load_older))
                                }
                            }
                        }
                    }
                    items(visibleRows, key = { it.rowId }) { row ->
                        when (row) {
                            is ConversationRow.Message -> MessageBubble(
                                message = row.message,
                                isStreaming = row.message.id == streamingMessageId,
                                assistantAvatarStyle = assistantAvatarStyle,
                                userAvatarStore = userAvatarStore
                            )
                            is ConversationRow.CommandOutput -> CommandOutputCard(row.panel)
                            is ConversationRow.Approval -> ApprovalCard(
                                card = row.card,
                                onApprove = { viewModel.approve(relayConnection) },
                                onDecline = { viewModel.declineAndContinue(relayConnection) },
                                onCancel = { viewModel.cancelCurrentTurn(relayConnection) }
                            )
                            is ConversationRow.QueuedDraft -> QueuedDraftRow(row.draft)
                        }
                    }
                }
            }
        }
    }
}

// ── ThinkingTimePill ─────────────────────────────────────────────────────────

@Composable
private fun ThinkingTimePill(
    seconds: Int,
    turnStatus: TurnStatusValue?,
    modifier: Modifier = Modifier
) {
    val icon: ImageVector = when (turnStatus) {
        TurnStatusValue.STREAMING -> Icons.Default.Keyboard
        TurnStatusValue.INTERRUPTING -> Icons.Default.Stop
        TurnStatusValue.WAITING_APPROVAL -> Icons.Default.HourglassBottom
        TurnStatusValue.RUNNING_COMMAND -> Icons.Default.Terminal
        else -> Icons.Default.AutoAwesome
    }
    val tint: Color = when (turnStatus) {
        TurnStatusValue.INTERRUPTING -> MaterialTheme.colorScheme.error
        TurnStatusValue.WAITING_APPROVAL -> MaterialTheme.colorScheme.tertiary
        TurnStatusValue.RUNNING_COMMAND -> MaterialTheme.colorScheme.secondary
        else -> MaterialTheme.colorScheme.primary
    }
    Surface(shape = RoundedCornerShape(50), color = tint.copy(alpha = 0.12f), modifier = modifier) {
        Row(
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(13.dp))
            Text("${seconds}s", fontSize = 12.sp, color = tint, fontWeight = FontWeight.SemiBold)
        }
    }
}

// ── Connection Banner ─────────────────────────────────────────────────────────

@Composable
private fun ConnectionBanner(message: String, state: ConnectionState) {
    val (color, icon) = when (state) {
        is ConnectionState.Connecting ->
            Pair(Color(0xFFFF9800), Icons.Default.Cloud)
        is ConnectionState.Failed ->
            Pair(MaterialTheme.colorScheme.error, Icons.Default.Error)
        is ConnectionState.Connected ->
            Pair(Color(0xFFFF9800), Icons.Default.DesktopWindows)
        else ->
            Pair(MaterialTheme.colorScheme.onSurfaceVariant, Icons.Default.CloudOff)
    }
    Surface(color = color.copy(alpha = 0.10f), modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Icon(icon, contentDescription = null, tint = color, modifier = Modifier.size(14.dp))
            Text(message, style = MaterialTheme.typography.labelSmall, color = color)
        }
    }
}

// ── MessageBubble（含流式光标）────────────────────────────────────────────────

@Composable
private fun MessageBubble(
    message: ConversationMessage,
    isStreaming: Boolean = false,
    assistantAvatarStyle: ChatAvatarStyle,
    userAvatarStore: UserAvatarStore
) {
    val isUser = message.role == ThreadMessageRole.USER
    val bubbleColor = if (isUser) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant
    val textColor = if (isUser) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant
    val avatarSlotWidth: Dp = 40.dp

    BoxWithConstraints(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 4.dp)
    ) {
        val bubbleMaxWidth: Dp = (maxWidth - avatarSlotWidth).coerceAtLeast(160.dp)

        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.Top
        ) {
            if (isUser) {
                Spacer(Modifier.weight(1f))
            } else {
                Box(
                    modifier = Modifier.width(avatarSlotWidth),
                    contentAlignment = Alignment.TopStart
                ) {
                    AssistantAvatarView(style = assistantAvatarStyle, modifier = Modifier.size(32.dp))
                }
            }

            Surface(
                shape = RoundedCornerShape(
                    topStart = 16.dp, topEnd = 16.dp,
                    bottomStart = if (isUser) 16.dp else 4.dp,
                    bottomEnd = if (isUser) 4.dp else 16.dp
                ),
                color = bubbleColor,
                modifier = Modifier.widthIn(max = bubbleMaxWidth)
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.Bottom,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    MessageTextView(
                        text = message.text,
                        textSizeSp = 14f,
                        textColor = textColor.toArgb(),
                        modifier = Modifier.weight(1f)
                    )
                    if (isStreaming) {
                        StreamingCursor(color = textColor.copy(alpha = 0.7f))
                    }
                }
            }

            if (isUser) {
                Box(
                    modifier = Modifier.requiredWidth(avatarSlotWidth),
                    contentAlignment = Alignment.TopEnd
                ) {
                    UserAvatarView(
                        avatarStore = userAvatarStore,
                        modifier = Modifier.requiredSize(32.dp)
                    )
                }
            } else {
                Spacer(Modifier.weight(1f))
            }
        }
    }
}

// ── Streaming Cursor（脉动圆点）──────────────────────────────────────────────

@Composable
private fun StreamingCursor(color: Color) {
    val infiniteTransition = rememberInfiniteTransition(label = "cursor")
    val alpha by infiniteTransition.animateFloat(
        initialValue = 0.2f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(500, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "cursor_alpha"
    )
    Box(
        modifier = Modifier
            .size(7.dp)
            .background(color.copy(alpha = alpha), CircleShape)
    )
}

// ── CommandOutputCard（支持横向滚动）─────────────────────────────────────────

@Composable
private fun CommandOutputCard(panel: CommandOutputPanel) {
    val stateColor = when (panel.state) {
        CommandOutputState.RUNNING -> MaterialTheme.colorScheme.primary
        CommandOutputState.WAITING_APPROVAL -> MaterialTheme.colorScheme.tertiary
        CommandOutputState.COMPLETED -> Color(0xFF4CAF50)
        CommandOutputState.INTERRUPTED -> MaterialTheme.colorScheme.secondary
        CommandOutputState.FAILED -> MaterialTheme.colorScheme.error
    }
    Card(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                if (panel.state == CommandOutputState.RUNNING) {
                    CircularProgressIndicator(modifier = Modifier.size(13.dp), strokeWidth = 2.dp)
                }
                Text(panel.title, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, color = stateColor)
            }
            panel.detail?.let {
                Text(it, fontSize = 12.sp, fontFamily = FontFamily.Monospace,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 4.dp))
            }
            if (panel.text.isNotEmpty()) {
                val hScroll = rememberScrollState()
                Text(
                    panel.text.takeLast(800),
                    fontSize = 11.sp,
                    fontFamily = FontFamily.Monospace,
                    softWrap = false,
                    maxLines = 12,
                    modifier = Modifier
                        .padding(top = 6.dp)
                        .background(MaterialTheme.colorScheme.surface, RoundedCornerShape(6.dp))
                        .horizontalScroll(hScroll)
                        .padding(8.dp)
                )
            }
        }
    }
}

// ── ApprovalCard ──────────────────────────────────────────────────────────────

@Composable
private fun ApprovalCard(
    card: ApprovalCardModel,
    onApprove: () -> Unit,
    onDecline: () -> Unit,
    onCancel: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.tertiaryContainer)
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon(Icons.Default.Shield, null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.tertiary)
                Text(card.title, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.height(6.dp))
            Text(card.summary, fontFamily = FontFamily.Monospace, fontSize = 13.sp)
            card.cwd?.let {
                Text(stringResource(R.string.conversation_dir, it), fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.onTertiaryContainer.copy(alpha = 0.7f),
                    modifier = Modifier.padding(top = 4.dp))
            }
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = onApprove, modifier = Modifier.weight(1f)) {
                    Icon(Icons.Default.Check, null, Modifier.size(14.dp))
                    Spacer(Modifier.width(4.dp))
                    Text(stringResource(R.string.conversation_approve))
                }
                OutlinedButton(onClick = onDecline, modifier = Modifier.weight(1f)) {
                    Icon(Icons.Default.Close, null, Modifier.size(14.dp))
                    Spacer(Modifier.width(4.dp))
                    Text(stringResource(R.string.conversation_decline))
                }
                TextButton(onClick = onCancel) { Text(stringResource(R.string.conversation_cancel)) }
            }
        }
    }
}

// ── QueuedDraftRow ────────────────────────────────────────────────────────────

@Composable
private fun QueuedDraftRow(draft: QueuedDraftModel) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.End
    ) {
        Surface(
            shape = RoundedCornerShape(12.dp),
            color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f)
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                Icon(Icons.Default.Schedule, null, Modifier.size(12.dp),
                    tint = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.7f))
                Text(stringResource(R.string.conversation_queued, draft.text),
                    color = MaterialTheme.colorScheme.onPrimaryContainer,
                    style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

// ── PendingImageStrip ─────────────────────────────────────────────────────────

@Composable
private fun PendingImageStrip(
    attachments: List<ConversationViewModel.PendingImageAttachment>,
    onRemove: (String) -> Unit
) {
    Column {
        LazyRow(
            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            items(attachments, key = { it.id }) { attachment ->
                Box {
                    AsyncImage(
                        model = attachment.dataURL,
                        contentDescription = null,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier
                            .size(64.dp)
                            .clip(RoundedCornerShape(10.dp))
                    )
                    // 移除按钮
                    Box(
                        modifier = Modifier
                            .size(20.dp)
                            .align(Alignment.TopEnd)
                            .background(MaterialTheme.colorScheme.errorContainer, CircleShape),
                        contentAlignment = Alignment.Center
                    ) {
                        IconButton(
                            onClick = { onRemove(attachment.id) },
                            modifier = Modifier.size(20.dp)
                        ) {
                            Icon(Icons.Default.Close, contentDescription = stringResource(R.string.conversation_remove_image),
                                modifier = Modifier.size(11.dp),
                                tint = MaterialTheme.colorScheme.onErrorContainer)
                        }
                    }
                }
            }
        }
        HorizontalDivider()
    }
}

// ── ConversationComposer ──────────────────────────────────────────────────────

@Composable
private fun ConversationComposer(
    draft: String,
    onDraftChange: (String) -> Unit,
    onSend: () -> Unit,
    onStop: () -> Unit,
    onAttachImage: () -> Unit,
    isTurnActive: Boolean,
    isInterrupting: Boolean,
    statusDetail: String?,
    canWriteToAgent: Boolean,
    pendingImages: List<ConversationViewModel.PendingImageAttachment>,
    onRemoveImage: (String) -> Unit,
    remainingImageSlots: Int
) {
    Column {
        // 图片附件预览条
        if (pendingImages.isNotEmpty()) {
            PendingImageStrip(attachments = pendingImages, onRemove = onRemoveImage)
        }

        // 状态进度条
        if (isTurnActive && statusDetail != null) {
            Surface(color = MaterialTheme.colorScheme.surfaceVariant) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    CircularProgressIndicator(modifier = Modifier.size(12.dp), strokeWidth = 2.dp)
                    Text(statusDetail, style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }

        HorizontalDivider()

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 4.dp, end = 12.dp, top = 8.dp, bottom = 8.dp)
                .navigationBarsPadding(),
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            // 图片附加按钮（Turn 非活跃、已连接、还有剩余名额时可用）
            if (!isTurnActive && remainingImageSlots > 0) {
                IconButton(
                    onClick = onAttachImage,
                    enabled = canWriteToAgent
                ) {
                    Icon(
                        Icons.Default.AttachFile,
                        contentDescription = stringResource(R.string.conversation_attach_image),
                        tint = if (canWriteToAgent) MaterialTheme.colorScheme.primary
                        else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f)
                    )
                }
            } else {
                Spacer(Modifier.width(8.dp))
            }

            // 输入框
            val placeholder = when {
                !canWriteToAgent && !isTurnActive -> stringResource(R.string.conversation_placeholder_disabled)
                isTurnActive -> stringResource(R.string.conversation_placeholder_active)
                else -> stringResource(R.string.conversation_placeholder_idle)
            }
            TextField(
                value = draft,
                onValueChange = onDraftChange,
                placeholder = { Text(placeholder) },
                enabled = canWriteToAgent || isTurnActive,
                modifier = Modifier.weight(1f),
                shape = RoundedCornerShape(24.dp),
                colors = TextFieldDefaults.colors(
                    unfocusedIndicatorColor = Color.Transparent,
                    focusedIndicatorColor = Color.Transparent
                ),
                maxLines = 5
            )

            Spacer(Modifier.width(4.dp))

            if (isTurnActive) {
                // 停止 / 中断中
                val stopBg = if (isInterrupting) MaterialTheme.colorScheme.surfaceVariant
                else MaterialTheme.colorScheme.errorContainer
                IconButton(
                    onClick = onStop,
                    enabled = !isInterrupting,
                    modifier = Modifier.size(48.dp).background(stopBg, RoundedCornerShape(50))
                ) {
                    if (isInterrupting) {
                        CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                    } else {
                        Icon(Icons.Default.Stop, null,
                            tint = MaterialTheme.colorScheme.onErrorContainer)
                    }
                }
            } else {
                // 发送
                val canSend = draft.trim().isNotEmpty() && canWriteToAgent
                IconButton(
                    onClick = onSend,
                    enabled = canSend,
                    modifier = Modifier.size(48.dp)
                        .background(
                            if (canSend) MaterialTheme.colorScheme.primary
                            else MaterialTheme.colorScheme.surfaceVariant,
                            RoundedCornerShape(50)
                        )
                ) {
                    Icon(
                        Icons.AutoMirrored.Filled.Send,
                        contentDescription = null,
                        tint = if (canSend) MaterialTheme.colorScheme.onPrimary
                        else MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }
    }
}
