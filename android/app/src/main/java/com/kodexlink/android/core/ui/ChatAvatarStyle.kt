package com.kodexlink.android.core.ui

// Auto-generated from iOS: ios/KodexLink/Core/UI/ChatAvatarStyle.swift

import android.content.Context
import android.content.SharedPreferences
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import com.kodexlink.android.R
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

// ── ChatAvatarStyle ────────────────────────────────────────────────────────

enum class ChatAvatarStyle(val key: String, val displayName: String) {
    CODEX("codex", "Codex"),
    CHATGPT("chatgpt", "ChatGPT"),
    CLAUDE("claude", "Claude"),
    MINIMAL("minimal", "极简");

    companion object {
        fun fromKey(key: String?) = entries.firstOrNull { it.key == key } ?: CODEX

        private const val PREFS_NAME = "kodexlink_appearance"
        private const val KEY_AVATAR_STYLE = "chat_avatar_style"

        fun load(context: Context): ChatAvatarStyle {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            return fromKey(prefs.getString(KEY_AVATAR_STYLE, null))
        }

        fun save(context: Context, style: ChatAvatarStyle) {
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit().putString(KEY_AVATAR_STYLE, style.key).apply()
        }
    }
}

// ── AssistantAvatarView ────────────────────────────────────────────────────

@Composable
fun AssistantAvatarView(style: ChatAvatarStyle, modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(10.dp)
    Box(
        modifier = modifier
            .size(32.dp)
            .clip(shape)
            .then(avatarBackground(style)),
        contentAlignment = Alignment.Center
    ) {
        when (style) {
            ChatAvatarStyle.CODEX -> {
                Image(
                    painter = painterResource(id = R.drawable.codex),
                    contentDescription = style.displayName,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize()
                )
            }
            ChatAvatarStyle.CHATGPT -> {
                Icon(
                    imageVector = Icons.Default.AutoAwesome,
                    contentDescription = style.displayName,
                    tint = Color.White,
                    modifier = Modifier.size(20.dp)
                )
            }
            ChatAvatarStyle.CLAUDE -> {
                Icon(
                    imageVector = Icons.Default.AutoAwesome,
                    contentDescription = "Claude",
                    tint = Color.White,
                    modifier = Modifier.size(18.dp)
                )
            }
            ChatAvatarStyle.MINIMAL -> {
                Icon(
                    imageVector = Icons.Default.Person,
                    contentDescription = "Minimal",
                    tint = Color.White,
                    modifier = Modifier.size(18.dp)
                )
            }
        }
    }
}

@Composable
private fun Modifier.then(extra: Modifier): Modifier = this.then(extra)

private fun avatarBackground(style: ChatAvatarStyle): Modifier = when (style) {
    ChatAvatarStyle.CODEX -> Modifier.background(Color(0xFF1A1A2E))
    ChatAvatarStyle.CHATGPT -> Modifier.background(Color(0xFF10A37F))
    ChatAvatarStyle.CLAUDE -> Modifier.background(
        Brush.linearGradient(
            colors = listOf(Color(0xFF8C45F2), Color(0xFFD170FF))
        )
    )
    ChatAvatarStyle.MINIMAL -> Modifier.background(
        Brush.linearGradient(
            colors = listOf(Color(0xFF3380FF), Color(0xFF19CCE6))
        )
    )
}

// ── UserAvatarView ─────────────────────────────────────────────────────────

@Composable
fun UserAvatarView(avatarStore: UserAvatarStore, modifier: Modifier = Modifier) {
    val bitmap by avatarStore.avatar.collectAsState()
    Box(
        modifier = modifier
            .requiredSize(32.dp)
            .clip(CircleShape),
        contentAlignment = Alignment.Center
    ) {
        if (bitmap != null) {
            Image(
                bitmap = bitmap!!.asImageBitmap(),
                contentDescription = "User avatar",
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize()
            )
        } else {
            Icon(
                imageVector = Icons.Default.Person,
                contentDescription = "Default avatar",
                tint = Color.Gray,
                modifier = Modifier.size(18.dp)
            )
        }
    }
}
