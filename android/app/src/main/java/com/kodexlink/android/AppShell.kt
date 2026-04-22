package com.kodexlink.android

// Auto-generated from iOS: ios/KodexLink/App/AppShellView.swift
// SwiftUI @EnvironmentObject → Compose parameter injection
// TabView → NavigationBar; NavigationStack → simple Compose navigation

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Message
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kodexlink.android.R
import com.kodexlink.android.core.auth.TokenManager
import com.kodexlink.android.core.config.RelayEnvironmentStore
import com.kodexlink.android.core.networking.AgentStatus
import com.kodexlink.android.core.networking.ConnectionState
import com.kodexlink.android.core.networking.RelayConnection
import com.kodexlink.android.core.pairing.PairingService
import com.kodexlink.android.core.protocol.AgentDegradedReason
import com.kodexlink.android.core.storage.BindingStore
import com.kodexlink.android.core.ui.UserAvatarStore
import com.kodexlink.android.core.protocol.ThreadSummary
import com.kodexlink.android.features.appstorepreview.AppStorePreviewView
import com.kodexlink.android.features.conversation.ConversationView
import com.kodexlink.android.features.conversation.ConversationViewModel
import com.kodexlink.android.features.onboarding.OnboardingView
import com.kodexlink.android.features.scanner.ScannerView
import com.kodexlink.android.features.settings.ChatAppearanceSettingsView
import com.kodexlink.android.features.settings.DeviceManagementView
import com.kodexlink.android.features.settings.NotificationPrefsView
import com.kodexlink.android.features.settings.RelaySettingsView
import com.kodexlink.android.features.settings.SettingsView
import com.kodexlink.android.features.settings.UserAvatarPickerView
import com.kodexlink.android.features.threadlist.ThreadListView
import com.kodexlink.android.features.threadlist.ThreadListViewModel
import kotlinx.coroutines.launch

/**
 * App shell — mirrors iOS AppShellView.swift
 * Routes between OnboardingView and main tab navigation based on BindingStore state.
 */
@Composable
fun AppShell(
    bindingStore: BindingStore,
    tokenManager: TokenManager,
    relayConnection: RelayConnection,
    relayEnvironmentStore: RelayEnvironmentStore,
    pairingService: PairingService,
    userAvatarStore: UserAvatarStore
) {
    val bindings by bindingStore.bindings.collectAsState()
    val preferredBindingId by bindingStore.preferredBindingId.collectAsState()
    val defaultBinding = remember(bindings, preferredBindingId) {
        preferredBindingId
            ?.let { preferredId -> bindings.firstOrNull { it.id == preferredId } }
            ?: bindings.firstOrNull { it.isDefault }
            ?: bindings.firstOrNull()
    }
    var showScannerFromOnboarding by remember { mutableStateOf(false) }
    var showScreenshotPreviewFromOnboarding by remember { mutableStateOf(false) }

    LaunchedEffect(defaultBinding?.id) {
        if (defaultBinding == null) {
            showScannerFromOnboarding = false
            showScreenshotPreviewFromOnboarding = false
        }
    }

    when {
        // No binding yet
        defaultBinding == null -> {
            if (showScreenshotPreviewFromOnboarding) {
                AppStorePreviewView(
                    onBack = { showScreenshotPreviewFromOnboarding = false }
                )
            } else if (showScannerFromOnboarding) {
                ScannerView(
                    pairingService = pairingService,
                    tokenManager = tokenManager,
                    bindingStore = bindingStore,
                    relayConnection = relayConnection,
                    relayEnvironmentStore = relayEnvironmentStore,
                    onPairingSuccess = { showScannerFromOnboarding = false }
                )
            } else {
                OnboardingView(
                    onScanQRCode = { showScannerFromOnboarding = true },
                    onNavigateToScreenshotPreview = { showScreenshotPreviewFromOnboarding = true }
                )
            }
        }
        // Authenticated — show main tab navigation
        else -> {
            key(defaultBinding.id) {
                MainTabShell(
                    bindingStore = bindingStore,
                    tokenManager = tokenManager,
                    relayConnection = relayConnection,
                    relayEnvironmentStore = relayEnvironmentStore,
                    pairingService = pairingService,
                    userAvatarStore = userAvatarStore,
                    sessionBindingId = defaultBinding.id
                )
            }
        }
    }
}

// ── Settings sub-page destination ───────────────────────────────────────────

private enum class SettingsDestination {
    RELAY, DEVICE, APPEARANCE, NOTIFICATIONS, AVATAR, SCREENSHOT_PREVIEW
}

// ── Main Tab Shell ───────────────────────────────────────────────────────────

@Composable
private fun MainTabShell(
    bindingStore: BindingStore,
    tokenManager: TokenManager,
    relayConnection: RelayConnection,
    relayEnvironmentStore: RelayEnvironmentStore,
    pairingService: PairingService,
    userAvatarStore: UserAvatarStore,
    sessionBindingId: String
) {
    var selectedTab by remember { mutableStateOf(0) }
    val threadListViewModel = remember { ThreadListViewModel(relayConnection) }

    // Conversation navigation
    var selectedThread by remember { mutableStateOf<ThreadSummary?>(null) }
    val conversationViewModel = remember { ConversationViewModel() }

    // Settings sub-page navigation
    var settingsDestination by remember { mutableStateOf<SettingsDestination?>(null) }

    LaunchedEffect(sessionBindingId) {
        selectedTab = 0
        selectedThread = null
        settingsDestination = null
    }

    // Full-screen conversation（覆盖 Tab + Status Chrome）
    val openThread = selectedThread
    if (openThread != null) {
        ConversationView(
            thread = openThread,
            viewModel = conversationViewModel,
            relayConnection = relayConnection,
            userAvatarStore = userAvatarStore,
            onBack = { selectedThread = null }
        )
        return
    }

    // Settings 子页也全屏展示（有返回箭头，等价于 iOS NavigationStack push）
    settingsDestination?.let { dest ->
        when (dest) {
            SettingsDestination.RELAY -> RelaySettingsView(
                relayEnvironmentStore = relayEnvironmentStore,
                bindingStore = bindingStore,
                tokenManager = tokenManager,
                relayConnection = relayConnection,
                onBack = { settingsDestination = null }
            )
            SettingsDestination.DEVICE -> DeviceManagementView(
                bindingStore = bindingStore,
                onBack = { settingsDestination = null }
            )
            SettingsDestination.APPEARANCE -> ChatAppearanceSettingsView(
                avatarStore = userAvatarStore,
                onBack = { settingsDestination = null }
            )
            SettingsDestination.NOTIFICATIONS -> NotificationPrefsView(
                onBack = { settingsDestination = null }
            )
            SettingsDestination.AVATAR -> UserAvatarPickerView(
                avatarStore = userAvatarStore,
                onBack = { settingsDestination = null }
            )
            SettingsDestination.SCREENSHOT_PREVIEW -> AppStorePreviewView(
                onBack = { settingsDestination = null }
            )
        }
        return
    }

    Scaffold(
        bottomBar = {
            NavigationBar {
                NavigationBarItem(
                    selected = selectedTab == 0,
                    onClick = { selectedTab = 0 },
                    icon = { Icon(Icons.AutoMirrored.Filled.Message, contentDescription = null) },
                    label = { Text(stringResource(R.string.tab_conversations)) }
                )
                NavigationBarItem(
                    selected = selectedTab == 1,
                    onClick = { selectedTab = 1 },
                    icon = { Icon(Icons.Default.QrCodeScanner, contentDescription = null) },
                    label = { Text(stringResource(R.string.tab_pair)) }
                )
                NavigationBarItem(
                    selected = selectedTab == 2,
                    onClick = { selectedTab = 2 },
                    icon = { Icon(Icons.Default.Settings, contentDescription = null) },
                    label = { Text(stringResource(R.string.tab_settings)) }
                )
            }
        }
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            // 连接状态徽标 — 始终显示在顶部
            ConnectionStatusChrome(relayConnection = relayConnection)

            Box(modifier = Modifier.fillMaxSize()) {
                when (selectedTab) {
                    0 -> ThreadListView(
                        viewModel = threadListViewModel,
                        relayConnection = relayConnection,
                        onSelectThread = { thread ->
                            selectedThread = thread
                        },
                        onCreateThread = {
                            threadListViewModel.createThread { newThread ->
                                if (newThread != null) {
                                    selectedThread = newThread
                                }
                            }
                        }
                    )
                    1 -> ScannerView(
                        pairingService = pairingService,
                        tokenManager = tokenManager,
                        bindingStore = bindingStore,
                        relayConnection = relayConnection,
                        relayEnvironmentStore = relayEnvironmentStore,
                        onPairingSuccess = { selectedTab = 0 }
                    )
                    2 -> SettingsView(
                        avatarStore = userAvatarStore,
                        onNavigateToAvatarPicker = { settingsDestination = SettingsDestination.AVATAR },
                        onNavigateToRelaySettings = { settingsDestination = SettingsDestination.RELAY },
                        onNavigateToDeviceManagement = { settingsDestination = SettingsDestination.DEVICE },
                        onNavigateToAppearance = { settingsDestination = SettingsDestination.APPEARANCE },
                        onNavigateToNotifications = { settingsDestination = SettingsDestination.NOTIFICATIONS },
                        onNavigateToScreenshotPreview = { settingsDestination = SettingsDestination.SCREENSHOT_PREVIEW },
                        onSignOut = {
                            tokenManager.clear()
                            bindingStore.clear()
                            relayConnection.clearSession()
                        }
                    )
                }
            }
        }
    }
}

// ── Connection Status Chrome ─────────────────────────────────────────────────

@Composable
internal fun ConnectionStatusChrome(relayConnection: RelayConnection) {
    val state by relayConnection.state.collectAsState()
    val agentStatus by relayConnection.agentStatus.collectAsState()
    val agentDegradedReason by relayConnection.agentDegradedReason.collectAsState()
    val requiresRePairing by relayConnection.requiresRePairing.collectAsState()
    val needsSessionRecovery by relayConnection.needsSessionRecovery.collectAsState()
    val isAcquiringCurrentBindingControl by relayConnection.isAcquiringCurrentBindingControl.collectAsState()
    val currentControlRevokedMessage by relayConnection.currentControlRevokedMessage.collectAsState()
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var controlTakeoverErrorMessage by remember { mutableStateOf<String?>(null) }

    val appearance = connectionStatusAppearance(
        state = state,
        agentStatus = agentStatus,
        agentDegradedReason = agentDegradedReason,
        isMissingCodexRuntimeDetail = relayConnection.isMissingCodexRuntimeDetail,
        requiresRePairing = requiresRePairing,
        needsSessionRecovery = needsSessionRecovery
    )

    controlTakeoverErrorMessage?.let { message ->
        AlertDialog(
            onDismissRequest = { controlTakeoverErrorMessage = null },
            title = { Text(stringResource(R.string.takeover_failed_title)) },
            text = { Text(message) },
            confirmButton = {
                TextButton(onClick = { controlTakeoverErrorMessage = null }) {
                    Text(stringResource(R.string.action_ok))
                }
            }
        )
    }

    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.Center
        ) {
            Surface(
                shape = RoundedCornerShape(50),
                tonalElevation = 2.dp,
                modifier = Modifier
                    .border(1.dp, appearance.tint.copy(alpha = 0.2f), RoundedCornerShape(50))
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        imageVector = appearance.icon,
                        contentDescription = null,
                        tint = appearance.tint,
                        modifier = Modifier.size(14.dp)
                    )
                    Text(
                        text = appearance.title,
                        fontSize = 12.sp,
                        fontFamily = FontFamily.Default,
                        color = appearance.tint
                    )
                }
            }
        }

        if (relayConnection.shouldShowControlTakeoverBanner) {
            ControlTakeoverBanner(
                message = currentControlRevokedMessage
                    ?: relayConnection.controlTakeoverBannerText,
                isLoading = isAcquiringCurrentBindingControl,
                canTakeover = relayConnection.canManuallyTakeoverCurrentBinding,
                takeover = {
                    scope.launch {
                        runCatching { relayConnection.takeoverCurrentBindingControl() }
                            .onFailure { error ->
                                controlTakeoverErrorMessage = error.message ?: context.getString(R.string.takeover_failed_message)
                            }
                    }
                }
            )
        }
    }
}

@Composable
private fun ControlTakeoverBanner(
    message: String,
    isLoading: Boolean,
    canTakeover: Boolean,
    takeover: () -> Unit
) {
    Surface(
        color = Color(0xFFFFF3E0),
        shape = RoundedCornerShape(18.dp),
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            if (isLoading) {
                CircularProgressIndicator(
                    modifier = Modifier.size(16.dp),
                    strokeWidth = 2.dp,
                    color = Color(0xFFFF9800)
                )
            } else {
                Icon(
                    Icons.Default.PhoneIphone,
                    contentDescription = null,
                    tint = Color(0xFFFF9800),
                    modifier = Modifier.size(16.dp)
                )
            }

            Text(
                text = message,
                modifier = Modifier.weight(1f),
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                color = Color(0xFF8A4B00)
            )

            TextButton(onClick = takeover, enabled = canTakeover) {
                Text(stringResource(if (isLoading) R.string.takeover_in_progress else R.string.takeover_action))
            }
        }
    }
}

private data class StatusAppearance(
    val title: String,
    val icon: ImageVector,
    val tint: Color
)

@Composable
private fun connectionStatusAppearance(
    state: ConnectionState,
    agentStatus: AgentStatus,
    agentDegradedReason: AgentDegradedReason?,
    isMissingCodexRuntimeDetail: Boolean,
    requiresRePairing: Boolean,
    needsSessionRecovery: Boolean
): StatusAppearance {
    if (requiresRePairing) {
        return StatusAppearance(stringResource(R.string.status_needs_repairing), Icons.Default.QrCodeScanner, Color(0xFFE53935))
    }
    if (needsSessionRecovery) {
        return StatusAppearance(stringResource(R.string.status_recovering_session), Icons.Default.Refresh, Color(0xFFFF9800))
    }
    return when (state) {
        is ConnectionState.Disconnected ->
            StatusAppearance(stringResource(R.string.status_relay_disconnected), Icons.Default.CloudOff, Color(0xFF9E9E9E))
        is ConnectionState.Connecting ->
            StatusAppearance(stringResource(R.string.status_connecting), Icons.Default.Cloud, Color(0xFFFF9800))
        is ConnectionState.Connected -> when (agentStatus) {
            AgentStatus.UNKNOWN ->
                StatusAppearance(stringResource(R.string.status_relay_connected), Icons.Default.CheckCircle, Color(0xFF4CAF50))
            AgentStatus.ONLINE ->
                StatusAppearance(stringResource(R.string.status_desktop_online), Icons.Default.DesktopWindows, Color(0xFF4CAF50))
            AgentStatus.OFFLINE ->
                StatusAppearance(stringResource(R.string.status_desktop_offline), Icons.Default.DesktopAccessDisabled, Color(0xFFFF9800))
            AgentStatus.DEGRADED -> when (agentDegradedReason) {
                AgentDegradedReason.RUNTIME_UNAVAILABLE ->
                    StatusAppearance(
                        stringResource(if (isMissingCodexRuntimeDetail) R.string.status_runtime_missing else R.string.status_runtime_error),
                        Icons.Default.Warning,
                        Color(0xFFFF9800)
                    )
                AgentDegradedReason.REQUEST_FAILURES ->
                    StatusAppearance(stringResource(R.string.status_request_error), Icons.Default.Warning, Color(0xFFFF9800))
                null ->
                    StatusAppearance(stringResource(R.string.status_status_error), Icons.Default.Warning, Color(0xFFFF9800))
            }
        }
        is ConnectionState.Failed ->
            StatusAppearance(stringResource(R.string.status_connection_failed), Icons.Default.Error, Color(0xFFE53935))
    }
}
