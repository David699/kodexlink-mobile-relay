package com.kodexlink.android.features.onboarding

// Auto-generated from iOS: ios/KodexLink/Features/Onboarding/OnboardingView.swift
// NavigationStack + heroSection + OnboardingFeatureRow + macSetupSection → Compose equivalent

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.Image
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kodexlink.android.BuildConfig
import com.kodexlink.android.R

// ── Brand accent colour (mirrors iOS Color(red:0.42, green:0.32, blue:0.98)) ──
private val BrandPurple = Color(0xFF6B52FA)

@Composable
fun OnboardingView(
    onScanQRCode: () -> Unit,
    onNavigateToScreenshotPreview: () -> Unit = {}
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 28.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Spacer(Modifier.height(48.dp))

        // ── Hero section ─────────────────────────────────────────────────────
        HeroSection()

        Spacer(Modifier.height(32.dp))

        // ── Feature rows ─────────────────────────────────────────────────────
        Column(verticalArrangement = Arrangement.spacedBy(18.dp)) {
            OnboardingFeatureRow(
                icon = Icons.Default.Wifi,
                tint = Color(0xFF2196F3),
                title = stringResource(R.string.onboarding_wireless_title),
                desc = stringResource(R.string.onboarding_wireless_desc)
            )
            OnboardingFeatureRow(
                icon = Icons.Default.Forum,
                tint = BrandPurple,
                title = stringResource(R.string.onboarding_threads_title),
                desc = stringResource(R.string.onboarding_threads_desc)
            )
            OnboardingFeatureRow(
                icon = Icons.Default.Code,
                tint = Color(0xFF4CAF50),
                title = stringResource(R.string.onboarding_commands_title),
                desc = stringResource(R.string.onboarding_commands_desc)
            )
        }

        Spacer(Modifier.height(20.dp))

        // ── Mac setup section ────────────────────────────────────────────────
        MacSetupSection()

        Spacer(Modifier.height(32.dp))

        // ── CTA button ───────────────────────────────────────────────────────
        Button(
            onClick = onScanQRCode,
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp),
            shape = RoundedCornerShape(14.dp)
        ) {
            Text(stringResource(R.string.onboarding_start_pairing), fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
        }

        // ── 截图预览入口（对齐 iOS #if ENABLE_DEV_TOOLS） ────────────
        if (BuildConfig.ENABLE_DEV_TOOLS || BuildConfig.DEBUG) {
            TextButton(onClick = onNavigateToScreenshotPreview) {
                Icon(Icons.Default.CameraAlt, contentDescription = null,
                    modifier = Modifier.size(14.dp))
                Spacer(Modifier.width(4.dp))
                Text("截图预览模式", fontSize = 13.sp,
                    fontWeight = FontWeight.Medium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Spacer(Modifier.height(12.dp))
        } else {
            Spacer(Modifier.height(36.dp))
        }
    }
}

// ── Hero Section ──────────────────────────────────────────────────────────────

@Composable
private fun HeroSection() {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(20.dp)
    ) {
        // Icon + glow halo
        Box(
            modifier = Modifier.size(144.dp),
            contentAlignment = Alignment.Center
        ) {
            // Radial glow ring
            Box(
                modifier = Modifier
                    .size(144.dp)
                    .background(
                        brush = Brush.radialGradient(
                            colors = listOf(
                                BrandPurple.copy(alpha = 0.22f),
                                BrandPurple.copy(alpha = 0.0f)
                            ),
                            radius = 200f
                        ),
                        shape = CircleShape
                    )
            )

            // codex.png asset
            Image(
                painter = painterResource(id = R.drawable.codex),
                contentDescription = "KodexLink",
                contentScale = ContentScale.Fit,
                modifier = Modifier.size(96.dp)
            )
        }

        // App name
        Text(
            text = "KodexLink",
            fontSize = 32.sp,
            fontWeight = FontWeight.Bold
        )

        // Subtitle with "Codex" highlighted in brand purple
        Text(
            text = buildAnnotatedString {
                append(stringResource(R.string.onboarding_subtitle_prefix))
                withStyle(SpanStyle(color = BrandPurple, fontWeight = FontWeight.SemiBold)) {
                    append("Codex")
                }
                append(stringResource(R.string.onboarding_subtitle_suffix))
            },
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            style = MaterialTheme.typography.bodyLarge
        )
    }
}

// ── Feature Row ───────────────────────────────────────────────────────────────

@Composable
private fun OnboardingFeatureRow(
    icon: ImageVector,
    tint: Color,
    title: String,
    desc: String
) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        // Icon badge
        Box(
            modifier = Modifier
                .size(52.dp)
                .clip(RoundedCornerShape(14.dp))
                .background(tint.copy(alpha = 0.12f)),
            contentAlignment = Alignment.Center
        ) {
            Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(26.dp))
        }

        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(3.dp)
        ) {
            Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            Text(desc, style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

// ── Mac Setup Section ─────────────────────────────────────────────────────────

@Composable
private fun MacSetupSection() {
    Surface(
        shape = RoundedCornerShape(20.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(Icons.Default.Computer, contentDescription = null,
                    modifier = Modifier.size(18.dp))
                Text(stringResource(R.string.onboarding_setup_title),
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold)
            }

            MacSetupStepRow(1, stringResource(R.string.onboarding_setup_step1), null)
            MacSetupStepRow(2, stringResource(R.string.onboarding_setup_step2), "npm install -g kodexlink")
            MacSetupStepRow(3, stringResource(R.string.onboarding_setup_step3), "kodexlink start")

            Text(
                stringResource(R.string.onboarding_setup_hint),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
private fun MacSetupStepRow(number: Int, label: String, code: String?) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.Top
    ) {
        Box(
            modifier = Modifier
                .size(20.dp)
                .clip(CircleShape)
                .background(Color(0xFFFF9800)),
            contentAlignment = Alignment.Center
        ) {
            Text(
                "$number",
                style = MaterialTheme.typography.labelSmall,
                color = Color.White,
                fontWeight = FontWeight.Bold
            )
        }
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(label, style = MaterialTheme.typography.bodySmall)
            if (code != null) {
                Surface(
                    shape = RoundedCornerShape(6.dp),
                    color = Color(0xFFFF9800).copy(alpha = 0.10f)
                ) {
                    Text(
                        code,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                        fontFamily = FontFamily.Monospace,
                        style = MaterialTheme.typography.bodySmall,
                        color = Color(0xFFFF9800)
                    )
                }
            }
        }
    }
}
