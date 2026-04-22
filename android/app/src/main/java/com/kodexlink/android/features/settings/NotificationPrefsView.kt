@file:OptIn(ExperimentalMaterial3Api::class)
package com.kodexlink.android.features.settings

// Auto-generated from iOS: ios/KodexLink/Features/Settings/NotificationPrefsView.swift

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.res.stringResource
import com.kodexlink.android.R
import com.kodexlink.android.core.diagnostics.DiagnosticsLogger

@Composable
fun NotificationPrefsView(onBack: () -> Unit = {}) {
    var approvalEnabled by remember { mutableStateOf(true) }
    var turnCompletedEnabled by remember { mutableStateOf(true) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.notifications_title), fontWeight = FontWeight.SemiBold) },
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
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {

            // ── 通知横幅 ──────────────────────────────────────────────────
            item {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(16.dp))
                        .background(
                            Brush.linearGradient(
                                listOf(Color(0xFFFF5722), Color(0xFFFF9800))
                            )
                        )
                        .padding(horizontal = 20.dp, vertical = 18.dp)
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(14.dp)
                    ) {
                        Icon(Icons.Default.Notifications, contentDescription = null,
                            tint = Color.White, modifier = Modifier.size(30.dp))
                        Column {
                            Text(stringResource(R.string.notifications_header_title), color = Color.White,
                                fontWeight = FontWeight.SemiBold,
                                style = MaterialTheme.typography.titleMedium)
                            Text(stringResource(R.string.notifications_header_subtitle),
                                color = Color.White.copy(alpha = 0.8f),
                                style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }

            // ── 通知开关 ─────────────────────────────────────────────────
            item {
                Text(stringResource(R.string.notifications_section),
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
                        NotificationToggleRow(
                            icon = Icons.Default.Gavel,
                            iconColor = Color(0xFFFF5722),
                            title = stringResource(R.string.notifications_approval_title),
                            subtitle = stringResource(R.string.notifications_approval_subtitle),
                            checked = approvalEnabled,
                            onCheckedChange = {
                                approvalEnabled = it
                                DiagnosticsLogger.info("NotificationPrefs",
                                    "approval_notifications_toggled",
                                    mapOf("enabled" to it.toString()))
                            }
                        )
                        HorizontalDivider(
                            modifier = Modifier.padding(start = 68.dp),
                            thickness = 0.5.dp,
                            color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f)
                        )
                        NotificationToggleRow(
                            icon = Icons.Default.TaskAlt,
                            iconColor = Color(0xFF10B981),
                            title = stringResource(R.string.notifications_completion_title),
                            subtitle = stringResource(R.string.notifications_completion_subtitle),
                            checked = turnCompletedEnabled,
                            onCheckedChange = {
                                turnCompletedEnabled = it
                                DiagnosticsLogger.info("NotificationPrefs",
                                    "turn_completed_notifications_toggled",
                                    mapOf("enabled" to it.toString()))
                            }
                        )
                    }
                }
            }

            // ── 提示说明 ──────────────────────────────────────────────────
            item {
                Card(
                    shape = RoundedCornerShape(14.dp),
                    colors = CardDefaults.cardColors(
                        containerColor = Color(0xFF2196F3).copy(alpha = 0.08f)
                    ),
                    elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier.padding(14.dp),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        verticalAlignment = Alignment.Top
                    ) {
                        Icon(Icons.Default.Info, contentDescription = null,
                            tint = Color(0xFF2196F3),
                            modifier = Modifier.size(18.dp).padding(top = 1.dp))
                        Text(stringResource(R.string.notifications_permission_note),
                            style = MaterialTheme.typography.bodySmall,
                            color = Color(0xFF2196F3))
                    }
                }
            }
        }
    }
}

@Composable
private fun NotificationToggleRow(
    icon: ImageVector,
    iconColor: Color,
    title: String,
    subtitle: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Box(
            modifier = Modifier
                .size(36.dp)
                .clip(RoundedCornerShape(9.dp))
                .background(iconColor),
            contentAlignment = Alignment.Center
        ) {
            Icon(icon, contentDescription = null,
                tint = Color.White, modifier = Modifier.size(20.dp))
        }
        Column(modifier = Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.Medium)
            Text(subtitle, style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(
            checked = checked,
            onCheckedChange = onCheckedChange,
            colors = SwitchDefaults.colors(
                checkedThumbColor = Color.White,
                checkedTrackColor = iconColor,
                checkedBorderColor = iconColor
            )
        )
    }
}
