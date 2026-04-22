@file:OptIn(ExperimentalMaterial3Api::class)
package com.kodexlink.android.features.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kodexlink.android.R
import com.kodexlink.android.core.ui.AssistantAvatarView
import com.kodexlink.android.core.ui.ChatAvatarStyle
import com.kodexlink.android.core.ui.UserAvatarStore
import com.kodexlink.android.core.ui.UserAvatarView

private data class StyleTheme(
    val gradient: List<Color>,
    val accentColor: Color
)

private val styleThemes = mapOf(
    ChatAvatarStyle.CODEX to StyleTheme(
        gradient = listOf(Color(0xFF1A1A2E), Color(0xFF16213E)),
        accentColor = Color(0xFF6C63FF)
    ),
    ChatAvatarStyle.CHATGPT to StyleTheme(
        gradient = listOf(Color(0xFF10A37F), Color(0xFF0E8B6C)),
        accentColor = Color(0xFF10A37F)
    ),
    ChatAvatarStyle.CLAUDE to StyleTheme(
        gradient = listOf(Color(0xFF8C45F2), Color(0xFFD170FF)),
        accentColor = Color(0xFFB156F7)
    ),
    ChatAvatarStyle.MINIMAL to StyleTheme(
        gradient = listOf(Color(0xFFF5F5F5), Color(0xFFEEEEEE)),
        accentColor = Color(0xFF9E9E9E)
    )
)

@Composable
fun ChatAppearanceSettingsView(
    avatarStore: UserAvatarStore,
    onBack: () -> Unit = {}
) {
    val context = LocalContext.current
    var selectedStyle by remember { mutableStateOf(ChatAvatarStyle.load(context)) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.appearance_title), fontWeight = FontWeight.SemiBold) },
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
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item {
                SectionLabel(stringResource(R.string.appearance_section_style))
                Card(
                    shape = RoundedCornerShape(16.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                    elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column {
                        ChatAvatarStyle.entries.forEachIndexed { idx, style ->
                            StyleOptionRow(
                                style = style,
                                selected = selectedStyle == style,
                                onSelect = {
                                    selectedStyle = style
                                    ChatAvatarStyle.save(context, style)
                                }
                            )
                            if (idx < ChatAvatarStyle.entries.lastIndex) {
                                HorizontalDivider(
                                    modifier = Modifier.padding(start = 72.dp),
                                    thickness = 0.5.dp,
                                    color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f)
                                )
                            }
                        }
                    }
                }
            }

            item {
                SectionLabel(stringResource(R.string.appearance_section_preview))
                ChatPreviewCard(
                    selectedStyle = selectedStyle,
                    avatarStore = avatarStore
                )
            }
        }
    }
}

@Composable
private fun StyleOptionRow(
    style: ChatAvatarStyle,
    selected: Boolean,
    onSelect: () -> Unit
) {
    val theme = styleThemes.getValue(style)

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onSelect)
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier
                .size(44.dp)
                .background(Brush.linearGradient(theme.gradient), RoundedCornerShape(12.dp))
                .then(
                    if (selected) {
                        Modifier.border(2.dp, theme.accentColor, RoundedCornerShape(12.dp))
                    } else {
                        Modifier
                    }
                ),
            contentAlignment = Alignment.Center
        ) {
            AssistantAvatarView(style = style, modifier = Modifier.size(44.dp))
        }

        Spacer(Modifier.size(14.dp))

        Column(modifier = Modifier.weight(1f)) {
            Text(
                styleDisplayName(style),
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal
            )
            Text(
                styleDescription(style),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        if (selected) {
            Box(
                modifier = Modifier
                    .size(24.dp)
                    .background(theme.accentColor, CircleShape),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    Icons.Default.Check,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(14.dp)
                )
            }
        }
    }
}

@Composable
private fun ChatPreviewCard(
    selectedStyle: ChatAvatarStyle,
    avatarStore: UserAvatarStore
) {
    val theme = styleThemes.getValue(selectedStyle)

    Card(
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Row(verticalAlignment = Alignment.Top) {
                AssistantAvatarView(style = selectedStyle, modifier = Modifier.size(36.dp))
                Spacer(Modifier.size(10.dp))
                Column {
                    Text(
                        stringResource(R.string.appearance_ai_name),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(bottom = 3.dp)
                    )
                    Surface(
                        shape = RoundedCornerShape(4.dp, 14.dp, 14.dp, 14.dp),
                        color = MaterialTheme.colorScheme.surfaceVariant
                    ) {
                        Text(
                            stringResource(R.string.appearance_preview_ai_msg),
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                            style = MaterialTheme.typography.bodyMedium
                        )
                    }
                }
                Spacer(Modifier.weight(1f))
            }

            Row(
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.Bottom,
                modifier = Modifier.fillMaxWidth()
            ) {
                Spacer(Modifier.weight(1f))
                Box(
                    modifier = Modifier
                        .background(
                            Brush.linearGradient(
                                listOf(Color(0xFF6C63FF), Color(0xFF2196F3))
                            ),
                            RoundedCornerShape(14.dp, 4.dp, 14.dp, 14.dp)
                        )
                        .padding(horizontal = 12.dp, vertical = 8.dp)
                ) {
                    Text(
                        stringResource(R.string.appearance_preview_user_msg),
                        color = Color.White,
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
                Spacer(Modifier.size(10.dp))
                UserAvatarView(avatarStore = avatarStore, modifier = Modifier.size(36.dp))
            }

            Row(verticalAlignment = Alignment.Top) {
                AssistantAvatarView(style = selectedStyle, modifier = Modifier.size(36.dp))
                Spacer(Modifier.size(10.dp))
                Surface(
                    shape = RoundedCornerShape(4.dp, 14.dp, 14.dp, 14.dp),
                    color = MaterialTheme.colorScheme.surfaceVariant
                ) {
                    Text(
                        stringResource(R.string.appearance_preview_ai_reply),
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
                Spacer(Modifier.weight(1f))
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.Center
            ) {
                Box(
                    modifier = Modifier
                        .background(theme.accentColor.copy(alpha = 0.12f), RoundedCornerShape(20.dp))
                        .padding(horizontal = 12.dp, vertical = 4.dp)
                ) {
                    Text(
                        stringResource(R.string.appearance_current_style, styleDisplayName(selectedStyle)),
                        color = theme.accentColor,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 12.sp
                    )
                }
            }
        }
    }
}

@Composable
private fun styleDisplayName(style: ChatAvatarStyle): String = when (style) {
    ChatAvatarStyle.CODEX -> stringResource(R.string.appearance_style_codex)
    ChatAvatarStyle.CHATGPT -> stringResource(R.string.appearance_style_chatgpt)
    ChatAvatarStyle.CLAUDE -> stringResource(R.string.appearance_style_claude)
    ChatAvatarStyle.MINIMAL -> stringResource(R.string.appearance_style_minimal)
}

@Composable
private fun styleDescription(style: ChatAvatarStyle): String = when (style) {
    ChatAvatarStyle.CODEX -> stringResource(R.string.appearance_desc_codex)
    ChatAvatarStyle.CHATGPT -> stringResource(R.string.appearance_desc_chatgpt)
    ChatAvatarStyle.CLAUDE -> stringResource(R.string.appearance_desc_claude)
    ChatAvatarStyle.MINIMAL -> stringResource(R.string.appearance_desc_minimal)
}

@Composable
private fun SectionLabel(title: String) {
    Text(
        title,
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier.padding(start = 4.dp, bottom = 6.dp)
    )
}
