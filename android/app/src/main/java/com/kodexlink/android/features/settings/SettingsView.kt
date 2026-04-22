@file:OptIn(ExperimentalMaterial3Api::class)
package com.kodexlink.android.features.settings

// 对齐 iOS: ios/KodexLink/Features/Settings/SettingsView.swift
// 彩色 icon 卡片风格，分组 Card 布局

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForwardIos
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.res.stringResource
import com.kodexlink.android.BuildConfig
import com.kodexlink.android.R
import com.kodexlink.android.core.ui.UserAvatarStore

// ── 彩色 icon 颜色定义 ─────────────────────────────────────────────────────
private val ColorRelay        = Color(0xFF2196F3)   // 蓝  — Relay 服务器
private val ColorDevices      = Color(0xFF9C27B0)   // 紫  — 设备管理
private val ColorAppearance   = Color(0xFFE91E63)   // 玫红 — 外观
private val ColorNotifications= Color(0xFFFF5722)   // 橙红 — 通知
private val ColorPrivacy      = Color(0xFF4CAF50)   // 绿  — 隐私
private val ColorTerms        = Color(0xFF009688)   // 青绿 — 服务条款
private val ColorInfo         = Color(0xFF607D8B)   // 蓝灰 — 版本

@Composable
fun SettingsView(
    versionName: String = BuildConfig.VERSION_NAME,
    avatarStore: UserAvatarStore? = null,
    onNavigateToAvatarPicker: () -> Unit = {},
    onNavigateToRelaySettings: () -> Unit,
    onNavigateToDeviceManagement: () -> Unit,
    onNavigateToAppearance: () -> Unit,
    onNavigateToNotifications: () -> Unit,
    onNavigateToScreenshotPreview: () -> Unit = {},
    onSignOut: () -> Unit
) {
    val uriHandler = LocalUriHandler.current
    val avatar = avatarStore?.avatar?.collectAsState()?.value

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.settings_title), fontWeight = FontWeight.SemiBold) },
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

            // ── 头像卡片 ────────────────────────────────────────────────────
            item {
                Card(
                    shape = RoundedCornerShape(16.dp),
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.surface
                    ),
                    elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
                    modifier = Modifier.fillMaxWidth().clickable(onClick = onNavigateToAvatarPicker)
                ) {
                    Row(
                        modifier = Modifier.padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        // 渐变头像圈
                        Box(
                            modifier = Modifier
                                .size(56.dp)
                                .clip(CircleShape)
                                .background(
                                    Brush.linearGradient(
                                        listOf(Color(0xFF6C63FF), Color(0xFF2196F3))
                                    )
                                ),
                            contentAlignment = Alignment.Center
                        ) {
                            if (avatar != null) {
                                Image(
                                    bitmap = avatar.asImageBitmap(),
                                    contentDescription = null,
                                    contentScale = ContentScale.Crop,
                                    modifier = Modifier.fillMaxSize().clip(CircleShape)
                                )
                            } else {
                                Image(
                                    painter = painterResource(id = R.drawable.codex),
                                    contentDescription = null,
                                    contentScale = ContentScale.Fit,
                                    modifier = Modifier
                                        .fillMaxSize()
                                        .padding(8.dp)
                                )
                            }
                        }
                        Spacer(Modifier.width(14.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                stringResource(R.string.settings_avatar_title),
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.SemiBold
                            )
                            Text(
                                if (avatar != null) stringResource(R.string.settings_avatar_change) else stringResource(R.string.settings_avatar_set),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowForwardIos,
                            contentDescription = null,
                            modifier = Modifier.size(14.dp),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f)
                        )
                    }
                }
            }

            // ── 主功能组 ────────────────────────────────────────────────────
            item {
                SettingsSectionLabel(stringResource(R.string.settings_section_general))
                SettingsCardGroup {
                    ColoredSettingsRow(
                        icon = Icons.Default.Wifi,
                        iconColor = ColorRelay,
                        title = stringResource(R.string.settings_relay_server),
                        onClick = onNavigateToRelaySettings
                    )
                    SettingsInternalDivider()
                    ColoredSettingsRow(
                        icon = Icons.Default.Devices,
                        iconColor = ColorDevices,
                        title = stringResource(R.string.settings_device_management),
                        onClick = onNavigateToDeviceManagement
                    )
                    SettingsInternalDivider()
                    ColoredSettingsRow(
                        icon = Icons.Default.Palette,
                        iconColor = ColorAppearance,
                        title = stringResource(R.string.settings_appearance),
                        onClick = onNavigateToAppearance
                    )
                    SettingsInternalDivider()
                    ColoredSettingsRow(
                        icon = Icons.Default.Notifications,
                        iconColor = ColorNotifications,
                        title = stringResource(R.string.settings_notifications),
                        onClick = onNavigateToNotifications
                    )
                }
            }

            // ── 关于组 ──────────────────────────────────────────────────────
            item {
                SettingsSectionLabel(stringResource(R.string.settings_section_about))
                SettingsCardGroup {
                    ColoredSettingsRow(
                        icon = Icons.Default.PrivacyTip,
                        iconColor = ColorPrivacy,
                        title = stringResource(R.string.settings_privacy_policy),
                        onClick = { uriHandler.openUri("https://my-muffin.pages.dev/privacy/kodexlink") }
                    )
                    SettingsInternalDivider()
                    ColoredSettingsRow(
                        icon = Icons.Default.Description,
                        iconColor = ColorTerms,
                        title = stringResource(R.string.settings_terms),
                        onClick = { uriHandler.openUri("https://my-muffin.pages.dev/terms") }
                    )
                    SettingsInternalDivider()
                    ColoredSettingsRow(
                        icon = Icons.Default.Info,
                        iconColor = ColorInfo,
                        title = stringResource(R.string.settings_version),
                        trailingLabel = versionName,
                        onClick = {}
                    )
                }
            }

            // ── 开发者工具（对齐 iOS #if ENABLE_DEV_TOOLS） ──────────────────
            if (BuildConfig.ENABLE_DEV_TOOLS || BuildConfig.DEBUG) {
                item {
                    SettingsSectionLabel("Developer")
                    SettingsCardGroup {
                        ColoredSettingsRow(
                            icon = Icons.Default.CameraAlt,
                            iconColor = Color(0xFF795548),
                            title = "App Store 截图预览",
                            onClick = onNavigateToScreenshotPreview
                        )
                    }
                }
            }

            // ── 退出登录 ────────────────────────────────────────────────────
            item {
                Spacer(Modifier.height(8.dp))
                Button(
                    onClick = onSignOut,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Color(0xFFFF3B30).copy(alpha = 0.12f),
                        contentColor = Color(0xFFFF3B30)
                    ),
                    elevation = ButtonDefaults.buttonElevation(0.dp),
                    shape = RoundedCornerShape(14.dp),
                    modifier = Modifier.fillMaxWidth().height(52.dp)
                ) {
                    Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = null,
                        modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(stringResource(R.string.settings_sign_out),
                        fontWeight = FontWeight.Medium,
                        fontSize = 15.sp)
                }
                Spacer(Modifier.height(12.dp))
            }
        }
    }
}

// ── 子组件 ─────────────────────────────────────────────────────────────────

@Composable
private fun SettingsSectionLabel(title: String) {
    Text(
        title,
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier.padding(start = 4.dp, bottom = 6.dp)
    )
}

@Composable
private fun SettingsCardGroup(content: @Composable ColumnScope.() -> Unit) {
    Card(
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column { content() }
    }
}

@Composable
private fun ColoredSettingsRow(
    icon: ImageVector,
    iconColor: Color,
    title: String,
    trailingLabel: String? = null,
    iconSize: Dp = 18.dp,
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        // 彩色圆角方形 icon 背景
        Box(
            modifier = Modifier
                .size(34.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(iconColor),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                icon,
                contentDescription = null,
                tint = Color.White,
                modifier = Modifier.size(iconSize)
            )
        }
        Spacer(Modifier.width(14.dp))
        Text(
            title,
            style = MaterialTheme.typography.bodyLarge,
            modifier = Modifier.weight(1f)
        )
        if (trailingLabel != null) {
            Text(
                trailingLabel,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(Modifier.width(4.dp))
        } else {
            Icon(
                Icons.AutoMirrored.Filled.ArrowForwardIos,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f),
                modifier = Modifier.size(14.dp)
            )
        }
    }
}

@Composable
private fun SettingsInternalDivider() {
    HorizontalDivider(
        modifier = Modifier.padding(start = 64.dp),
        thickness = 0.5.dp,
        color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.6f)
    )
}
