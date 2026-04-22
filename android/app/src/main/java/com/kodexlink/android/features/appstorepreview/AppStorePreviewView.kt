@file:OptIn(ExperimentalMaterial3Api::class)
package com.kodexlink.android.features.appstorepreview

// 对齐 iOS: ios/KodexLink/Features/AppStorePreview/AppStorePreviewView.swift
// SwiftUI ScrollView + LazyVStack → Compose LazyColumn
// DisclosureGroup → AnimatedVisibility
// .bar background → Surface with tonalElevation

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
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
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kodexlink.android.R
import kotlinx.coroutines.launch
import java.util.UUID

// ── 语言（对齐 iOS MockLanguage） ────────────────────────────────────────────

enum class MockLanguage(val label: String) {
    CHINESE("中文"),
    ENGLISH("English")
}

// ── 数据模型（对齐 iOS MockRole / MockMessage / MockCommandOutput / MockRow）──

private enum class MockRole { USER, ASSISTANT }

private data class MockMessage(
    val id: String = UUID.randomUUID().toString(),
    val role: MockRole,
    val text: String,
    val time: String
)

private data class MockCommandOutput(
    val id: String = UUID.randomUUID().toString(),
    val title: String,
    val detail: String,
    val output: String,
    val isSuccess: Boolean
)

private sealed class MockRow {
    abstract val id: String
    data class Message(val message: MockMessage) : MockRow() {
        override val id get() = message.id
    }
    data class Command(val command: MockCommandOutput) : MockRow() {
        override val id get() = command.id
    }
}

// ── 模拟对话内容（对齐 iOS mockRows） ────────────────────────────────────────

private fun mockRows(language: MockLanguage): List<MockRow> = when (language) {
    MockLanguage.CHINESE -> listOf(
        MockRow.Message(MockMessage(
            role = MockRole.USER,
            text = "帮我重构这个 URLSession 封装，支持 async/await 并发请求和指数退避重试",
            time = "10:21"
        )),
        MockRow.Message(MockMessage(
            role = MockRole.ASSISTANT,
            text = "好的！我来分析现有代码，然后给你一个更现代的实现。\n\n主要改动：\n• 用 `async throws` 替换回调闭包\n• 加入 `withRetry` 泛型包装器，支持指数退避\n• 请求/响应拦截器链式设计\n\n先跑一下测试确认基线\uD83D\uDC47",
            time = "10:21"
        )),
        MockRow.Command(MockCommandOutput(
            title = "swift test --filter NetworkClientTests",
            detail = "NetworkClientTests",
            output = "Test Suite 'NetworkClientTests' started\n...\nTest Case '-[NetworkClientTests testRetryOnTimeout]' passed (0.342s)\nTest Case '-[NetworkClientTests testConcurrentRequests]' passed (0.128s)\n\nExecuted 8 tests, with 0 failures in 1.203s",
            isSuccess = true
        )),
        MockRow.Message(MockMessage(
            role = MockRole.ASSISTANT,
            text = "基线测试全部通过 ✓ 重构完成，新的 `NetworkClient` 用法：\n\n```swift\nlet client = NetworkClient(\n    retryPolicy: .exponentialBackoff(maxAttempts: 3),\n    timeout: 30\n)\nlet data = try await client.fetch(UserProfile.self, from: .profile)\n```\n\n已更新 `Sources/Network/NetworkClient.swift` 和对应单元测试。",
            time = "10:23"
        )),
        MockRow.Message(MockMessage(
            role = MockRole.USER,
            text = "完美！顺手帮我加上请求日志和耗时统计吧",
            time = "10:24"
        )),
        MockRow.Message(MockMessage(
            role = MockRole.ASSISTANT,
            text = "已添加 `RequestLogger` 中间件，自动记录每次请求的耗时、状态码和错误信息。Debug 构建打印到控制台，Release 静默写入本地日志文件。\n\n需要我把日志也接入 Crashlytics 吗？",
            time = "10:25"
        ))
    )
    MockLanguage.ENGLISH -> listOf(
        MockRow.Message(MockMessage(
            role = MockRole.USER,
            text = "Refactor my URLSession wrapper to support async/await concurrent requests and exponential backoff retry",
            time = "10:21"
        )),
        MockRow.Message(MockMessage(
            role = MockRole.ASSISTANT,
            text = "Sure! Let me analyze the existing code and give you a modern implementation.\n\nKey changes:\n• Replace completion handlers with `async throws`\n• Add a generic `withRetry` wrapper with exponential backoff\n• Chain request/response interceptors\n\nRunning baseline tests first \uD83D\uDC47",
            time = "10:21"
        )),
        MockRow.Command(MockCommandOutput(
            title = "swift test --filter NetworkClientTests",
            detail = "NetworkClientTests",
            output = "Test Suite 'NetworkClientTests' started\n...\nTest Case '-[NetworkClientTests testRetryOnTimeout]' passed (0.342s)\nTest Case '-[NetworkClientTests testConcurrentRequests]' passed (0.128s)\n\nExecuted 8 tests, with 0 failures in 1.203s",
            isSuccess = true
        )),
        MockRow.Message(MockMessage(
            role = MockRole.ASSISTANT,
            text = "All baseline tests passed ✓ Refactoring complete. New `NetworkClient` usage:\n\n```swift\nlet client = NetworkClient(\n    retryPolicy: .exponentialBackoff(maxAttempts: 3),\n    timeout: 30\n)\nlet data = try await client.fetch(UserProfile.self, from: .profile)\n```\n\nUpdated `Sources/Network/NetworkClient.swift` and all unit tests.",
            time = "10:23"
        )),
        MockRow.Message(MockMessage(
            role = MockRole.USER,
            text = "Perfect! Can you also add request logging and performance monitoring?",
            time = "10:24"
        )),
        MockRow.Message(MockMessage(
            role = MockRole.ASSISTANT,
            text = "Added a `RequestLogger` middleware that automatically records latency, status codes, and errors. Logs print to the console in Debug builds, and are silently written to a local log file in Release.\n\nWant me to pipe the logs into Crashlytics as well?",
            time = "10:25"
        ))
    )
}

private fun mockTitle(language: MockLanguage) = when (language) {
    MockLanguage.CHINESE -> "NetworkClient 重构"
    MockLanguage.ENGLISH -> "NetworkClient Refactor"
}

private fun composerPlaceholder(language: MockLanguage) = when (language) {
    MockLanguage.CHINESE -> "继续对话…"
    MockLanguage.ENGLISH -> "Continue the conversation…"
}

private fun commandStatusLabel(isSuccess: Boolean, language: MockLanguage) = when (language) {
    MockLanguage.CHINESE -> if (isSuccess) "完成" else "失败"
    MockLanguage.ENGLISH -> if (isSuccess) "Done" else "Failed"
}

private fun meLabel(language: MockLanguage) = when (language) {
    MockLanguage.CHINESE -> "我"
    MockLanguage.ENGLISH -> "Me"
}

// ── 主视图（对齐 iOS AppStorePreviewView） ──────────────────────────────────

@Composable
fun AppStorePreviewView(
    onBack: () -> Unit
) {
    var language by remember { mutableStateOf(MockLanguage.CHINESE) }
    var languageMenuExpanded by remember { mutableStateOf(false) }
    val rows = remember(language) { mockRows(language) }
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()

    // 切换语言后滚动到底部（对齐 iOS onChange(of: language)）
    LaunchedEffect(language) {
        if (rows.isNotEmpty()) {
            listState.animateScrollToItem(rows.lastIndex)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(mockTitle(language), fontWeight = FontWeight.SemiBold)
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = null)
                    }
                },
                actions = {
                    // 语言切换菜单（对齐 iOS languageToggleButton Menu）
                    Box {
                        IconButton(onClick = { languageMenuExpanded = true }) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Default.Language, contentDescription = null,
                                    modifier = Modifier.size(18.dp))
                                Spacer(Modifier.width(4.dp))
                                Text(language.label, fontSize = 13.sp,
                                    fontWeight = FontWeight.Medium)
                            }
                        }
                        DropdownMenu(
                            expanded = languageMenuExpanded,
                            onDismissRequest = { languageMenuExpanded = false }
                        ) {
                            MockLanguage.entries.forEach { lang ->
                                DropdownMenuItem(
                                    text = { Text(lang.label) },
                                    onClick = {
                                        language = lang
                                        languageMenuExpanded = false
                                    },
                                    leadingIcon = if (lang == language) {
                                        { Icon(Icons.Default.Check, contentDescription = null,
                                            modifier = Modifier.size(16.dp)) }
                                    } else null
                                )
                            }
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface
                )
            )
        },
        bottomBar = {
            MockComposerBar(placeholder = composerPlaceholder(language))
        },
        containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f)
    ) { padding ->
        LazyColumn(
            state = listState,
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            items(rows, key = { it.id }) { row ->
                when (row) {
                    is MockRow.Message -> MockMessageBubble(
                        message = row.message,
                        meLabel = meLabel(language)
                    )
                    is MockRow.Command -> MockCommandCard(
                        output = row.command,
                        language = language
                    )
                }
            }
        }
    }
}

// ── 消息气泡（对齐 iOS MockMessageBubble） ──────────────────────────────────

@Composable
private fun MockMessageBubble(message: MockMessage, meLabel: String) {
    val isAssistant = message.role == MockRole.ASSISTANT

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (isAssistant) Arrangement.Start else Arrangement.End,
        verticalAlignment = Alignment.Top
    ) {
        if (isAssistant) {
            MockAssistantAvatar()
            Spacer(Modifier.width(8.dp))
        } else {
            Spacer(Modifier.weight(1f, fill = false).widthIn(min = 32.dp))
        }

        // 气泡
        val bubbleModifier = Modifier.fillMaxWidth(0.85f)

        Surface(
            modifier = bubbleModifier,
            shape = RoundedCornerShape(18.dp),
            color = if (isAssistant) {
                MaterialTheme.colorScheme.surfaceContainerHigh
            } else {
                Color.Transparent
            },
            tonalElevation = if (isAssistant) 1.dp else 0.dp
        ) {
            val bgModifier = if (!isAssistant) {
                Modifier.background(
                    Brush.linearGradient(listOf(Color(0xFF2196F3), Color(0xFF00BCD4)))
                )
            } else Modifier

            Column(
                modifier = bgModifier
                    .padding(horizontal = 14.dp, vertical = 12.dp)
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = if (isAssistant) "Codex" else meLabel,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = if (isAssistant) {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        } else {
                            Color.White.copy(alpha = 0.85f)
                        }
                    )
                    Spacer(Modifier.weight(1f))
                    Text(
                        text = message.time,
                        fontSize = 10.sp,
                        color = if (isAssistant) {
                            MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
                        } else {
                            Color.White.copy(alpha = 0.72f)
                        }
                    )
                }
                Spacer(Modifier.height(6.dp))
                Text(
                    text = message.text,
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (isAssistant) {
                        MaterialTheme.colorScheme.onSurface
                    } else {
                        Color.White
                    }
                )
            }
        }

        if (!isAssistant) {
            Spacer(Modifier.width(8.dp))
            MockUserAvatar()
        } else {
            Spacer(Modifier.weight(1f, fill = false).widthIn(min = 32.dp))
        }
    }
}

// ── 命令输出卡片（对齐 iOS MockCommandCard + DisclosureGroup） ───────────────

@Composable
private fun MockCommandCard(output: MockCommandOutput, language: MockLanguage) {
    var isExpanded by remember { mutableStateOf(false) }
    val statusTint = if (output.isSuccess) Color(0xFF4CAF50) else Color(0xFFF44336)

    Row(modifier = Modifier.fillMaxWidth()) {
        Card(
            modifier = Modifier.weight(1f),
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.surface
            ),
            elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
        ) {
            Column(
                modifier = Modifier
                    .clickable { isExpanded = !isExpanded }
                    .padding(horizontal = 12.dp, vertical = 10.dp)
            ) {
                // Header
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        Icons.Default.Terminal,
                        contentDescription = null,
                        modifier = Modifier.size(14.dp),
                        tint = statusTint
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(
                        output.detail,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f)
                    )
                    Spacer(Modifier.width(8.dp))
                    // 状态标签
                    Surface(
                        shape = RoundedCornerShape(50),
                        color = statusTint.copy(alpha = 0.12f)
                    ) {
                        Text(
                            commandStatusLabel(output.isSuccess, language),
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold,
                            color = statusTint
                        )
                    }
                    Spacer(Modifier.width(4.dp))
                    Icon(
                        if (isExpanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
                    )
                }
                // 命令标题
                Text(
                    output.title,
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 4.dp)
                )
                // 可折叠输出
                AnimatedVisibility(
                    visible = isExpanded,
                    enter = expandVertically(),
                    exit = shrinkVertically()
                ) {
                    Text(
                        output.output,
                        modifier = Modifier.padding(top = 8.dp),
                        fontFamily = FontFamily.Monospace,
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        lineHeight = 16.sp
                    )
                }
            }
        }
        // 右侧留白（对齐 iOS Spacer(minLength: 56)）
        Spacer(Modifier.width(56.dp))
    }
}

// ── 头像（对齐 iOS MockAssistantAvatar / MockUserAvatar） ────────────────────

@Composable
private fun MockAssistantAvatar() {
    Box(
        modifier = Modifier
            .size(32.dp)
            .clip(RoundedCornerShape(10.dp)),
        contentAlignment = Alignment.Center
    ) {
        androidx.compose.foundation.Image(
            painter = painterResource(id = R.drawable.codex),
            contentDescription = "Codex",
            modifier = Modifier.fillMaxSize()
        )
    }
}

@Composable
private fun MockUserAvatar() {
    Box(
        modifier = Modifier
            .size(32.dp)
            .clip(CircleShape)
            .background(
                Brush.linearGradient(listOf(Color(0xFF2196F3), Color(0xFF42A5F5)))
            ),
        contentAlignment = Alignment.Center
    ) {
        Icon(
            Icons.Default.Person,
            contentDescription = null,
            tint = Color.White,
            modifier = Modifier.size(20.dp)
        )
    }
}

// ── 静态输入栏（对齐 iOS MockComposerBar） ──────────────────────────────────

@Composable
private fun MockComposerBar(placeholder: String) {
    Surface(tonalElevation = 3.dp) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Icon(
                Icons.Default.AttachFile,
                contentDescription = null,
                modifier = Modifier.size(28.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Surface(
                modifier = Modifier.weight(1f),
                shape = RoundedCornerShape(8.dp),
                border = ButtonDefaults.outlinedButtonBorder(enabled = true),
                color = MaterialTheme.colorScheme.surface
            ) {
                Text(
                    placeholder,
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 7.dp),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
                )
            }
            Icon(
                Icons.Default.ArrowCircleUp,
                contentDescription = null,
                modifier = Modifier.size(28.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}
