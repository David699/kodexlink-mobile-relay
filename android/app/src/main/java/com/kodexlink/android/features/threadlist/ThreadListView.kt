@file:OptIn(ExperimentalMaterial3Api::class)
package com.kodexlink.android.features.threadlist

// 对齐 iOS: ios/KodexLink/Features/ThreadList/ThreadListView.swift

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Message
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.kodexlink.android.R
import com.kodexlink.android.core.diagnostics.DiagnosticsLogger
import com.kodexlink.android.core.networking.AgentStatus
import com.kodexlink.android.core.networking.ConnectionState
import com.kodexlink.android.core.networking.RelayConnection
import com.kodexlink.android.core.protocol.ThreadSummary
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter

// 会话行渐变色池 — 科技蓝主色系（按 id hash 取）
private val threadGradients = listOf(
    listOf(Color(0xFF0EA5E9), Color(0xFF3B82F6)),   // 天蓝→电蓝
    listOf(Color(0xFF2563EB), Color(0xFF4F46E5)),   // 蓝→靛蓝
    listOf(Color(0xFF0284C7), Color(0xFF0891B2)),   // 深蓝→青蓝
    listOf(Color(0xFF3B82F6), Color(0xFF06B6D4)),   // 蓝→青
    listOf(Color(0xFF1D4ED8), Color(0xFF2563EB)),   // 深蓝→蓝
    listOf(Color(0xFF0369A1), Color(0xFF0EA5E9)),   // 海蓝→亮蓝
    listOf(Color(0xFF4F46E5), Color(0xFF0EA5E9)),   // 靛→天蓝
    listOf(Color(0xFF0891B2), Color(0xFF0284C7)),   // 青→海蓝
)

private fun threadGradient(id: String): List<Color> =
    threadGradients[Math.abs(id.hashCode()) % threadGradients.size]

private val sectionColors = listOf(
    Color(0xFF0EA5E9), Color(0xFF2563EB), Color(0xFF0284C7),
    Color(0xFF4F46E5), Color(0xFF0891B2), Color(0xFF1D4ED8)
)
private fun sectionColor(id: String) =
    sectionColors[Math.abs(id.hashCode()) % sectionColors.size]

@Composable
fun ThreadListView(
    viewModel: ThreadListViewModel,
    relayConnection: RelayConnection,
    onSelectThread: (ThreadSummary) -> Unit,
    onCreateThread: () -> Unit
) {
    val sections        by viewModel.sections.collectAsState()
    val threads         by viewModel.threads.collectAsState()
    val isLoading       by viewModel.isLoading.collectAsState()
    val isCreating      by viewModel.isCreating.collectAsState()
    val errorMessage    by viewModel.errorMessage.collectAsState()
    val hasMoreThreads  by viewModel.hasMoreThreads.collectAsState()
    val isLoadingMore   by viewModel.isLoadingMore.collectAsState()
    val paginationError by viewModel.paginationErrorMessage.collectAsState()
    val archiveError    by viewModel.archiveErrorMessage.collectAsState()
    val archivingIds    by viewModel.archivingThreadIds.collectAsState()
    val collapsedIds    by viewModel.collapsedSectionIDs.collectAsState()

    val connectionState by relayConnection.state.collectAsState()
    val agentStatus     by relayConnection.agentStatus.collectAsState()
    val connectionEpoch by relayConnection.connectionEpoch.collectAsState()
    val canWrite = relayConnection.canWriteToAgent
    val lifecycleOwner = LocalLifecycleOwner.current

    LaunchedEffect(connectionState) {
        if (connectionState is ConnectionState.Connected && threads.isEmpty() && !isLoading) {
            DiagnosticsLogger.info(
                "ThreadListView",
                "thread_list_refresh_requested",
                mapOf(
                    "reason" to "connected_empty",
                    "threadCount" to threads.size.toString(),
                    "connectionEpoch" to connectionEpoch.toString()
                )
            )
            viewModel.loadThreads(reason = "connected_empty")
        }
    }
    LaunchedEffect(agentStatus) {
        if (agentStatus == AgentStatus.ONLINE) {
            DiagnosticsLogger.info(
                "ThreadListView",
                "thread_list_refresh_requested",
                mapOf(
                    "reason" to "agent_online",
                    "threadCount" to threads.size.toString(),
                    "connectionEpoch" to connectionEpoch.toString()
                )
            )
            viewModel.loadThreads(reason = "agent_online")
        }
    }
    LaunchedEffect(connectionEpoch) {
        if (connectionEpoch > 0L) {
            DiagnosticsLogger.info(
                "ThreadListView",
                "thread_list_refresh_requested",
                mapOf(
                    "reason" to "connection_epoch",
                    "threadCount" to threads.size.toString(),
                    "connectionEpoch" to connectionEpoch.toString()
                )
            )
            viewModel.loadThreads(reason = "connection_epoch", force = true)
        }
    }

    DisposableEffect(lifecycleOwner, connectionEpoch) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME && connectionEpoch > 0L) {
                DiagnosticsLogger.info(
                    "ThreadListView",
                    "thread_list_refresh_requested",
                    mapOf(
                        "reason" to "view_resumed",
                        "threadCount" to threads.size.toString(),
                        "connectionEpoch" to connectionEpoch.toString()
                    )
                )
                viewModel.loadThreads(reason = "view_resumed", force = true)
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    var isRefreshing by remember { mutableStateOf(false) }
    LaunchedEffect(isLoading) { if (!isLoading) isRefreshing = false }

    var pendingArchiveId by remember { mutableStateOf<String?>(null) }

    pendingArchiveId?.let { tid ->
        AlertDialog(
            onDismissRequest = { pendingArchiveId = null },
            title = { Text(stringResource(R.string.threads_archive_title)) },
            text = { Text(stringResource(R.string.threads_archive_msg)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        val id = tid; pendingArchiveId = null
                        viewModel.archiveThread(id) { if (it) viewModel.loadThreads() }
                    },
                    colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)
                ) { Text(stringResource(R.string.threads_archive)) }
            },
            dismissButton = { TextButton(onClick = { pendingArchiveId = null }) { Text(stringResource(R.string.action_cancel)) } }
        )
    }
    archiveError?.let { msg ->
        AlertDialog(
            onDismissRequest = { viewModel.clearArchiveError() },
            title = { Text(stringResource(R.string.threads_archive_failed)) },
            text = { Text(msg) },
            confirmButton = { TextButton(onClick = { viewModel.clearArchiveError() }) { Text(stringResource(R.string.action_ok)) } }
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.threads_title), fontWeight = FontWeight.SemiBold) },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface
                )
            )
        },
        containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f)
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = isRefreshing,
            onRefresh = {
                isRefreshing = true
                DiagnosticsLogger.info(
                    "ThreadListView",
                    "thread_list_refresh_requested",
                    mapOf(
                        "reason" to "pull_to_refresh",
                        "threadCount" to threads.size.toString(),
                        "connectionEpoch" to connectionEpoch.toString()
                    )
                )
                viewModel.loadThreads(reason = "pull_to_refresh", force = true)
            },
            modifier = Modifier.fillMaxSize().padding(padding)
        ) {
            when {
                isLoading && threads.isEmpty() -> {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(
                            color = Color(0xFF0EA5E9),
                            modifier = Modifier.size(40.dp),
                            strokeWidth = 3.dp
                        )
                    }
                }
                threads.isEmpty() -> {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        ThreadListEmptyState(
                            message = errorMessage ?: emptyStateMessage(relayConnection, connectionState, agentStatus),
                            isCreating = isCreating,
                            canCreate = canWrite,
                            onCreateThread = onCreateThread,
                            onReload = { viewModel.loadThreads(reason = "empty_state_reload", force = true) }
                        )
                    }
                }
                else -> {
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 12.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        // 每个 section 整体作为一个 Card
                        sections.forEach { section ->
                            item(key = "section_${section.id}") {
                                ThreadSectionCard(
                                    section = section,
                                    isCollapsed = collapsedIds.contains(section.id),
                                    isCreatingInSection = viewModel.isCreatingThread(section.cwd),
                                    archivingIds = archivingIds,
                                    canWrite = canWrite,
                                    isCreating = isCreating,
                                    onToggleCollapse = { viewModel.toggleSection(section.id) },
                                    onSelectThread = onSelectThread,
                                    onArchive = { pendingArchiveId = it },
                                    onCreateInSection = {
                                        viewModel.createThread(cwd = section.cwd) { newThread ->
                                            if (newThread != null) onSelectThread(newThread)
                                        }
                                    }
                                )
                            }
                        }

                        if (hasMoreThreads || isLoadingMore || paginationError != null) {
                            item {
                                Box(Modifier.fillMaxWidth().padding(16.dp),
                                    contentAlignment = Alignment.Center) {
                                    when {
                                        isLoadingMore -> CircularProgressIndicator(
                                            Modifier.size(24.dp), strokeWidth = 2.dp)
                                        hasMoreThreads -> OutlinedButton(
                                            onClick = { viewModel.loadMoreThreads() },
                                            shape = RoundedCornerShape(20.dp)
                                        ) {
                                            Icon(Icons.Default.History, null, Modifier.size(16.dp))
                                            Spacer(Modifier.width(6.dp))
                                            Text(stringResource(R.string.threads_load_more))
                                        }
                                        paginationError != null -> Text(
                                            paginationError ?: "",
                                            color = MaterialTheme.colorScheme.error,
                                            style = MaterialTheme.typography.bodySmall
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

// ── Section 整组卡片（header + 所有线程行） ──────────────────────────────────

@Composable
private fun ThreadSectionCard(
    section: ThreadListSection,
    isCollapsed: Boolean,
    isCreatingInSection: Boolean,
    archivingIds: Set<String>,
    canWrite: Boolean,
    isCreating: Boolean,
    onToggleCollapse: () -> Unit,
    onSelectThread: (ThreadSummary) -> Unit,
    onArchive: (String) -> Unit,
    onCreateInSection: () -> Unit
) {
    val color = sectionColor(section.id)
    Card(
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column {
            // ── Section Header（可折叠，对齐 iOS ThreadSectionHeaderRow）────
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(onClick = onToggleCollapse)
                    .padding(horizontal = 14.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                // 折叠指示器 chevron（对齐 iOS chevron.right / chevron.down）
                Icon(
                    Icons.Default.ChevronRight,
                    contentDescription = null,
                    modifier = Modifier
                        .size(14.dp)
                        .rotate(if (isCollapsed) 0f else 90f),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
                )
                Spacer(Modifier.width(6.dp))
                Box(
                    modifier = Modifier
                        .size(7.dp)
                        .clip(CircleShape)
                        .background(color)
                )
                Spacer(Modifier.width(8.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        section.title,
                        style = MaterialTheme.typography.labelLarge,
                        fontWeight = FontWeight.SemiBold,
                        color = color,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    section.subtitle?.let { sub ->
                        Text(
                            sub,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                }
                Spacer(Modifier.width(8.dp))
                // 数量徽章 + 新建按钮（per-section，对齐 iOS create: section.cwd）
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(10.dp))
                            .background(color.copy(alpha = 0.15f))
                            .padding(horizontal = 8.dp, vertical = 3.dp)
                    ) {
                        Text(
                            "${section.threads.size}",
                            style = MaterialTheme.typography.labelSmall,
                            color = color,
                            fontWeight = FontWeight.Bold
                        )
                    }
                    IconButton(
                        onClick = onCreateInSection,
                        enabled = canWrite && !isCreating,
                        modifier = Modifier.size(28.dp)
                    ) {
                        if (isCreatingInSection) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(16.dp),
                                strokeWidth = 2.dp,
                                color = color
                            )
                        } else {
                            Icon(
                                Icons.Default.AddCircle,
                                contentDescription = stringResource(R.string.threads_new),
                                tint = if (canWrite) color else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f),
                                modifier = Modifier.size(22.dp)
                            )
                        }
                    }
                }
            }
            HorizontalDivider(
                thickness = 0.5.dp,
                color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.6f)
            )
            // ── Thread 行（可折叠动画，对齐 iOS isSectionCollapsed）──────────
            AnimatedVisibility(
                visible = !isCollapsed,
                enter = expandVertically(),
                exit = shrinkVertically()
            ) {
                Column {
                    section.threads.forEachIndexed { idx, thread ->
                        val isArchiving = archivingIds.contains(thread.id)
                        SwipeToArchiveRow(
                            isArchiving = isArchiving,
                            canArchive = canWrite,
                            onArchive = { onArchive(thread.id) }
                        ) {
                            ThreadRow(thread = thread, onClick = { onSelectThread(thread) })
                        }
                        if (idx < section.threads.lastIndex) {
                            HorizontalDivider(
                                modifier = Modifier.padding(start = 68.dp),
                                thickness = 0.5.dp,
                                color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.4f)
                            )
                        }
                    }
                }
            }
        }
    }
}

// ── 滑动归档 ──────────────────────────────────────────────────────────────────

@Composable
private fun SwipeToArchiveRow(
    isArchiving: Boolean,
    canArchive: Boolean,
    onArchive: () -> Unit,
    content: @Composable () -> Unit
) {
    val dismissState = rememberSwipeToDismissBoxState(
        confirmValueChange = { value ->
            if (value == SwipeToDismissBoxValue.EndToStart && canArchive) onArchive()
            false
        }
    )
    SwipeToDismissBox(
        state = dismissState,
        enableDismissFromStartToEnd = false,
        backgroundContent = {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        Brush.horizontalGradient(
                            listOf(Color(0xFFFF6B6B).copy(alpha = 0f), Color(0xFFFF4757))
                        )
                    )
                    .padding(end = 20.dp),
                contentAlignment = Alignment.CenterEnd
            ) {
                if (isArchiving) {
                    CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp,
                        color = Color.White)
                } else {
                    Column(horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Icon(Icons.Default.Archive, contentDescription = null,
                            tint = Color.White, modifier = Modifier.size(20.dp))
                        Text(stringResource(R.string.threads_archive), color = Color.White, fontSize = 11.sp,
                            fontWeight = FontWeight.Medium)
                    }
                }
            }
        }
    ) { content() }
}

// ── 线程行（Card 外层由 ThreadSectionCard 提供） ──────────────────────────────

@Composable
private fun ThreadRow(thread: ThreadSummary, onClick: () -> Unit) {
    val grad = threadGradient(thread.id)
    val initial = thread.titleText.firstOrNull()?.uppercaseChar()?.toString() ?: "C"
    val yesterday = stringResource(R.string.date_yesterday)
    val formatMonthDay = stringResource(R.string.date_format_month_day)
    val formatFull = stringResource(R.string.date_format_full)

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surface)
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier
                .size(42.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(Brush.linearGradient(grad)),
            contentAlignment = Alignment.Center
        ) {
            Text(initial, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 16.sp)
        }
        Spacer(Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                thread.titleText,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                fontWeight = FontWeight.Medium,
                style = MaterialTheme.typography.bodyMedium
            )
        }
        Spacer(Modifier.width(8.dp))
        Text(
            thread.createdAtDate.threadRelativeFormatted(yesterday, formatMonthDay, formatFull),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = 11.sp
        )
    }
}

// ── 空状态 ────────────────────────────────────────────────────────────────────

@Composable
private fun ThreadListEmptyState(
    message: String,
    isCreating: Boolean,
    canCreate: Boolean,
    onCreateThread: () -> Unit,
    onReload: () -> Unit
) {
    Column(
        modifier = Modifier.padding(horizontal = 40.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Box(
            modifier = Modifier
                .size(80.dp)
                .clip(CircleShape)
                .background(Brush.linearGradient(
                    listOf(Color(0xFF0EA5E9).copy(alpha = 0.15f), Color(0xFF2196F3).copy(alpha = 0.15f))
                )),
            contentAlignment = Alignment.Center
        ) {
            Icon(Icons.AutoMirrored.Filled.Message, contentDescription = null,
                modifier = Modifier.size(36.dp),
                tint = Color(0xFF0EA5E9).copy(alpha = 0.7f))
        }
        Text(message, style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Button(
                onClick = onCreateThread,
                enabled = canCreate && !isCreating,
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0EA5E9)),
                shape = RoundedCornerShape(20.dp)
            ) {
                if (isCreating) {
                    CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp,
                        color = Color.White)
                    Spacer(Modifier.width(6.dp))
                    Text(stringResource(R.string.threads_creating))
                } else {
                    Icon(Icons.Default.Add, null, Modifier.size(16.dp))
                    Spacer(Modifier.width(4.dp))
                    Text(stringResource(R.string.threads_new))
                }
            }
            OutlinedButton(onClick = onReload, shape = RoundedCornerShape(20.dp)) {
                Icon(Icons.Default.Refresh, null, Modifier.size(16.dp))
                Spacer(Modifier.width(4.dp))
                Text(stringResource(R.string.action_refresh))
            }
        }
    }
}

// ── 辅助函数 ──────────────────────────────────────────────────────────────────

@Composable
private fun emptyStateMessage(
    relayConnection: RelayConnection,
    state: ConnectionState,
    agentStatus: AgentStatus
): String {
    if (!relayConnection.canWriteToAgent) return relayConnection.writeUnavailableMessage
    return when (state) {
        is ConnectionState.Disconnected -> stringResource(R.string.threads_empty_disconnected)
        is ConnectionState.Connecting   -> stringResource(R.string.threads_empty_connecting)
        is ConnectionState.Failed       -> stringResource(R.string.threads_empty_connection_failed, state.reason)
        is ConnectionState.Connected    -> when (agentStatus) {
            AgentStatus.OFFLINE  -> stringResource(R.string.threads_empty_desktop_offline)
            AgentStatus.DEGRADED -> stringResource(R.string.threads_empty_desktop_error)
            AgentStatus.UNKNOWN  -> stringResource(R.string.threads_empty_syncing)
            AgentStatus.ONLINE   -> stringResource(R.string.threads_empty_no_sessions)
        }
    }
}

private val ThreadSummary.createdAtDate: java.util.Date
    get() = java.util.Date(createdAt * 1000)

private fun java.util.Date.threadRelativeFormatted(
    yesterday: String,
    formatMonthDay: String,
    formatFull: String
): String {
    val zone = ZoneId.systemDefault()
    val instant = toInstant()
    val date = instant.atZone(zone).toLocalDate()
    val today = LocalDate.now(zone)
    return when {
        date.isEqual(today)              -> DateTimeFormatter.ofPattern("HH:mm").withZone(zone).format(instant)
        date.isEqual(today.minusDays(1)) -> yesterday
        date.year == today.year          -> DateTimeFormatter.ofPattern(formatMonthDay).withZone(zone).format(instant)
        else                             -> DateTimeFormatter.ofPattern(formatFull).withZone(zone).format(instant)
    }
}
