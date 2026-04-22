@file:OptIn(ExperimentalMaterial3Api::class)
package com.kodexlink.android.features.settings

// Auto-generated from iOS: ios/KodexLink/Features/Settings/RelaySettingsView.swift

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.annotation.StringRes
import com.kodexlink.android.R
import com.kodexlink.android.core.config.RelayEnvironmentMode
import com.kodexlink.android.core.config.RelayEnvironmentStore
import com.kodexlink.android.core.networking.RelayConnection
import com.kodexlink.android.core.storage.BindingStore
import com.kodexlink.android.core.auth.TokenManager

// 每种模式的视觉定义
private data class ModeTheme(
    val icon: ImageVector,
    val gradient: List<Color>,
    @StringRes val labelRes: Int,
    @StringRes val descriptionRes: Int
)

private val RelayEnvironmentMode.theme: ModeTheme get() = when (this) {
    RelayEnvironmentMode.BINDING_DEFAULT -> ModeTheme(
        icon = Icons.Default.Link,
        gradient = listOf(Color(0xFF607D8B), Color(0xFF78909C)),
        labelRes = R.string.relay_mode_binding,
        descriptionRes = R.string.relay_binding_default_desc
    )
    RelayEnvironmentMode.HOSTED_REMOTE -> ModeTheme(
        icon = Icons.Default.Cloud,
        gradient = listOf(Color(0xFF2196F3), Color(0xFF00BCD4)),
        labelRes = R.string.relay_mode_hosted,
        descriptionRes = R.string.relay_hosted_desc
    )
    RelayEnvironmentMode.CUSTOM -> ModeTheme(
        icon = Icons.Default.Tune,
        gradient = listOf(Color(0xFF9C27B0), Color(0xFFE91E63)),
        labelRes = R.string.relay_mode_custom,
        descriptionRes = R.string.relay_custom_desc
    )
}

@Composable
fun RelaySettingsView(
    relayEnvironmentStore: RelayEnvironmentStore,
    bindingStore: BindingStore,
    tokenManager: TokenManager,
    relayConnection: RelayConnection,
    onBack: () -> Unit = {}
) {
    val mode by relayEnvironmentStore.mode.collectAsState()
    val customUrl by relayEnvironmentStore.customRelayBaseURL.collectAsState()
    val context = LocalContext.current

    var selectedMode by remember(mode) { mutableStateOf(mode) }
    var customInput  by remember(customUrl) { mutableStateOf(customUrl) }
    var infoMessage  by remember { mutableStateOf<String?>(null) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    fun apply(newMode: RelayEnvironmentMode, url: String = customInput) {
        val bindingDefault = bindingStore.defaultBinding
        relayEnvironmentStore.update(newMode, if (newMode == RelayEnvironmentMode.CUSTOM) url else null)
        if (relayEnvironmentStore.requiresSessionReset(bindingDefault)) {
            tokenManager.clear(); bindingStore.clear(); relayConnection.clearSession()
            infoMessage = context.getString(R.string.relay_env_reset); return
        }
        infoMessage = when (newMode) {
            RelayEnvironmentMode.BINDING_DEFAULT -> context.getString(R.string.relay_restored_default)
            RelayEnvironmentMode.HOSTED_REMOTE   -> context.getString(R.string.relay_switched_remote)
            RelayEnvironmentMode.CUSTOM          -> context.getString(R.string.relay_custom_saved)
        }
        errorMessage = null
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.relay_title), fontWeight = FontWeight.SemiBold) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.action_back))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface
                )
            )
        },
        containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f)
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {

            // ── 模式选择卡片 ────────────────────────────────────────────
            item {
                Text(stringResource(R.string.relay_section_mode),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.padding(start = 4.dp, bottom = 6.dp))

                Card(
                    shape = RoundedCornerShape(16.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                    elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column {
                        RelayEnvironmentMode.entries.forEachIndexed { idx, envMode ->
                            RelayModeRow(
                                envMode = envMode,
                                isSelected = selectedMode == envMode,
                                onClick = {
                                    selectedMode = envMode
                                    if (envMode != RelayEnvironmentMode.CUSTOM) apply(envMode)
                                }
                            )
                            if (idx < RelayEnvironmentMode.entries.lastIndex) {
                                HorizontalDivider(
                                    modifier = Modifier.padding(start = 68.dp),
                                    thickness = 0.5.dp,
                                    color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f)
                                )
                            }
                        }
                    }
                }
            }

            // ── 自定义地址输入 ──────────────────────────────────────────
            if (selectedMode == RelayEnvironmentMode.CUSTOM) {
                item {
                    Card(
                        shape = RoundedCornerShape(16.dp),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(modifier = Modifier.padding(16.dp),
                            verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            OutlinedTextField(
                                value = customInput,
                                onValueChange = { customInput = it },
                                label = { Text("https://relay.example.com") },
                                leadingIcon = {
                                    Icon(Icons.Default.Link, null,
                                        tint = Color(0xFF9C27B0))
                                },
                                shape = RoundedCornerShape(12.dp),
                                modifier = Modifier.fillMaxWidth(),
                                singleLine = true
                            )
                            Button(
                                onClick = {
                                    val normalized = RelayEnvironmentStore.normalizeRelayBaseURL(customInput)
                                    if (normalized == null) { errorMessage = context.getString(R.string.relay_invalid_url); return@Button }
                                    customInput = normalized
                                    apply(RelayEnvironmentMode.CUSTOM, normalized)
                                },
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = Color(0xFF9C27B0)
                                ),
                                shape = RoundedCornerShape(12.dp),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Icon(Icons.Default.Save, null, Modifier.size(16.dp))
                                Spacer(Modifier.width(6.dp))
                                Text(stringResource(R.string.action_save))
                            }
                        }
                    }
                }
            }

            // ── 当前地址信息 ────────────────────────────────────────────
            item {
                Text(stringResource(R.string.relay_section_info),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.padding(start = 4.dp, bottom = 6.dp))

                Card(
                    shape = RoundedCornerShape(16.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                    elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column {
                        // 当前地址
                        Row(
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
                            verticalAlignment = Alignment.Top,
                            horizontalArrangement = Arrangement.spacedBy(14.dp)
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(36.dp)
                                    .clip(RoundedCornerShape(9.dp))
                                    .background(Color(0xFF2196F3)),
                                contentAlignment = Alignment.Center
                            ) {
                                Icon(Icons.Default.Wifi, null, tint = Color.White,
                                    modifier = Modifier.size(20.dp))
                            }
                            Column(modifier = Modifier.weight(1f)) {
                                Text(stringResource(R.string.relay_current_address),
                                    style = MaterialTheme.typography.bodyMedium,
                                    fontWeight = FontWeight.Medium)
                                Spacer(Modifier.height(4.dp))
                                Box(
                                    modifier = Modifier
                                        .clip(RoundedCornerShape(6.dp))
                                        .background(MaterialTheme.colorScheme.surfaceVariant)
                                        .padding(horizontal = 8.dp, vertical = 4.dp)
                                ) {
                                    Text(
                                        relayEnvironmentStore.resolvedRelayBaseURL(
                                            bindingStore.defaultBinding?.relayBaseURL
                                        ) ?: stringResource(R.string.relay_awaiting_pair),
                                        fontFamily = FontFamily.Monospace,
                                        fontSize = 11.sp,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }
                            }
                        }

                        // 绑定 Mac
                        bindingStore.defaultBinding?.let { binding ->
                            HorizontalDivider(
                                modifier = Modifier.padding(start = 68.dp),
                                thickness = 0.5.dp,
                                color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f)
                            )
                            Row(
                                modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
                                verticalAlignment = Alignment.Top,
                                horizontalArrangement = Arrangement.spacedBy(14.dp)
                            ) {
                                Box(
                                    modifier = Modifier
                                        .size(36.dp)
                                        .clip(RoundedCornerShape(9.dp))
                                        .background(Color(0xFF4CAF50)),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Icon(Icons.Default.Computer, null, tint = Color.White,
                                        modifier = Modifier.size(20.dp))
                                }
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(stringResource(R.string.relay_bound_desktop),
                                        style = MaterialTheme.typography.bodyMedium,
                                        fontWeight = FontWeight.Medium)
                                    Text(binding.agentName,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    Text(binding.agentId,
                                        fontFamily = FontFamily.Monospace,
                                        fontSize = 10.sp,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f))
                                }
                            }
                        }
                    }
                }
            }

            // ── 提示信息 ───────────────────────────────────────────────
            infoMessage?.let { msg ->
                item {
                    Card(
                        shape = RoundedCornerShape(12.dp),
                        colors = CardDefaults.cardColors(
                            containerColor = Color(0xFF4CAF50).copy(alpha = 0.1f)
                        ),
                        elevation = CardDefaults.cardElevation(0.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Row(modifier = Modifier.padding(12.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Default.CheckCircle, null,
                                tint = Color(0xFF4CAF50), modifier = Modifier.size(18.dp))
                            Text(msg, color = Color(0xFF4CAF50),
                                style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }
            errorMessage?.let { msg ->
                item {
                    Card(
                        shape = RoundedCornerShape(12.dp),
                        colors = CardDefaults.cardColors(
                            containerColor = MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.5f)
                        ),
                        elevation = CardDefaults.cardElevation(0.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Row(modifier = Modifier.padding(12.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Default.Error, null,
                                tint = MaterialTheme.colorScheme.error,
                                modifier = Modifier.size(18.dp))
                            Text(msg, color = MaterialTheme.colorScheme.error,
                                style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }
        }
    }
}

// ── 模式选项行 ──────────────────────────────────────────────────────────────

@Composable
private fun RelayModeRow(
    envMode: RelayEnvironmentMode,
    isSelected: Boolean,
    onClick: () -> Unit
) {
    val theme = envMode.theme
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Box(
            modifier = Modifier
                .size(36.dp)
                .clip(RoundedCornerShape(9.dp))
                .background(Brush.linearGradient(theme.gradient)),
            contentAlignment = Alignment.Center
        ) {
            Icon(theme.icon, null, tint = Color.White, modifier = Modifier.size(20.dp))
        }
        Column(modifier = Modifier.weight(1f)) {
            Text(stringResource(theme.labelRes), style = MaterialTheme.typography.bodyLarge,
                fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal)
            Text(stringResource(theme.descriptionRes), style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (isSelected) {
            Box(
                modifier = Modifier
                    .size(22.dp)
                    .clip(CircleShape)
                    .background(Brush.linearGradient(theme.gradient)),
                contentAlignment = Alignment.Center
            ) {
                Icon(Icons.Default.Check, null, tint = Color.White,
                    modifier = Modifier.size(13.dp))
            }
        }
    }
}
