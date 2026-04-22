@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalPermissionsApi::class)
package com.kodexlink.android.features.scanner

// Auto-generated from iOS: ios/KodexLink/Features/Scanner/ScannerView.swift
// AVFoundation → CameraX + ML Kit；DisclosureGroup → AnimatedVisibility card

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.google.accompanist.permissions.ExperimentalPermissionsApi
import com.google.accompanist.permissions.isGranted
import com.google.accompanist.permissions.rememberPermissionState
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import com.kodexlink.android.core.auth.TokenManager
import com.kodexlink.android.core.config.RelayEnvironmentStore
import com.kodexlink.android.core.diagnostics.DiagnosticsLogger
import com.kodexlink.android.core.networking.RelayConnection
import com.kodexlink.android.core.pairing.PairingService
import com.kodexlink.android.core.pairing.QRScannerService
import com.kodexlink.android.core.storage.BindingStore
import com.kodexlink.android.R
import kotlinx.coroutines.launch
import java.util.concurrent.Executors
import java.util.UUID

// ── Public entry point ─────────────────────────────────────────────────────

@Composable
fun ScannerView(
    pairingService: PairingService,
    tokenManager: TokenManager,
    bindingStore: BindingStore,
    relayConnection: RelayConnection,
    relayEnvironmentStore: RelayEnvironmentStore,
    onPairingSuccess: () -> Unit = {}
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val cameraPermission = rememberPermissionState(Manifest.permission.CAMERA)
    val qrScannerService = remember { QRScannerService(context) }

    var pairingPayload by remember { mutableStateOf("") }
    var isClaiming by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var isManualEntryExpanded by remember { mutableStateOf(false) }
    var isMacSetupExpanded by remember { mutableStateOf(false) }
    var lastHandledPayload by remember { mutableStateOf<String?>(null) }
    // 每次扫码失败后自增，强制 QRCameraPreview 重建（重置其内部 hasScanned 状态）
    var cameraResetKey by remember { mutableStateOf(0) }

    val preferredRelayBaseURL = relayEnvironmentStore.preferredRelayBaseURL

    // Auto-request camera on entry; expand manual if denied
    LaunchedEffect(Unit) {
        if (!cameraPermission.status.isGranted) {
            cameraPermission.launchPermissionRequest()
        }
        if (!cameraPermission.status.isGranted) {
            isManualEntryExpanded = true
        }
    }

    // When permission changes to denied, expand manual entry
    LaunchedEffect(cameraPermission.status.isGranted) {
        if (!cameraPermission.status.isGranted) isManualEntryExpanded = true
    }

    fun makePairTraceId(): String {
        val suffix = UUID.randomUUID().toString()
            .lowercase()
            .replace("-", "")
            .take(10)
        return "pt_$suffix"
    }

    fun handleScannedPayload(scannedValue: String) {
        if (isClaiming) return
        val normalized = runCatching {
            qrScannerService.normalizedPayload(scannedValue)
        }.getOrElse {
            errorMessage = it.message; return
        }
        if (normalized == lastHandledPayload) return
        val pairTraceId = makePairTraceId()
        lastHandledPayload = normalized
        pairingPayload = normalized
        errorMessage = null
        scope.launch {
            val claimStartedAt = System.currentTimeMillis()
            isClaiming = true
            errorMessage = null
            DiagnosticsLogger.info(
                "ScannerView",
                "claim_pairing_ui_start",
                DiagnosticsLogger.pairTraceMetadata(pairTraceId, mapOf(
                    "payloadLength" to normalized.length.toString(),
                    "isManualEntryExpanded" to isManualEntryExpanded.toString()
                ))
            )
            try {
                val binding = pairingService.claimPairingSession(
                    rawPayload = normalized,
                    tokenManager = tokenManager,
                    bindingStore = bindingStore,
                    expectedRelayBaseURL = preferredRelayBaseURL,
                    pairTraceId = pairTraceId
                )
                DiagnosticsLogger.info(
                    "ScannerView",
                    "claim_pairing_ui_binding_ready",
                    DiagnosticsLogger.pairTraceMetadata(pairTraceId, mapOf(
                        "bindingId" to binding.id,
                        "agentId" to binding.agentId,
                        "durationMs" to DiagnosticsLogger.durationMilliseconds(claimStartedAt)
                    ))
                )
                val deviceId = tokenManager.mobileDeviceId ?: error("No device ID")
                val deviceToken = tokenManager.deviceToken ?: error("No device token")
                relayConnection.updateSession(
                    relayBaseURL = binding.relayBaseURL,
                    deviceId = deviceId,
                    deviceToken = deviceToken,
                    bindingId = binding.id,
                    pairTraceId = pairTraceId,
                    resetRePairingState = true
                )
                relayConnection.connect()
                relayConnection.refreshBindingPresenceAfterPairing()
                pairingPayload = ""
                isManualEntryExpanded = false
                DiagnosticsLogger.info(
                    "ScannerView",
                    "claim_pairing_ui_success",
                    DiagnosticsLogger.pairTraceMetadata(pairTraceId, mapOf(
                        "bindingId" to binding.id,
                        "agentId" to binding.agentId,
                        "deviceId" to deviceId,
                        "durationMs" to DiagnosticsLogger.durationMilliseconds(claimStartedAt)
                    ))
                )
                onPairingSuccess()
            } catch (e: Exception) {
                lastHandledPayload = null
                errorMessage = e.message ?: context.getString(R.string.scanner_pairing_failed)
                cameraResetKey++ // 重建摄像头，使 hasScanned 归零，允许重新扫码
                DiagnosticsLogger.warning(
                    "ScannerView",
                    "claim_pairing_ui_failed",
                    DiagnosticsLogger.pairTraceMetadata(pairTraceId, mapOf(
                        "error" to (e.message ?: "配对失败"),
                        "durationMs" to DiagnosticsLogger.durationMilliseconds(claimStartedAt)
                    ))
                )
            } finally {
                isClaiming = false
            }
        }
    }

    fun claimManual() {
        val trimmed = pairingPayload.trim()
        if (trimmed.isEmpty()) { errorMessage = context.getString(R.string.scanner_empty_content); return }
        handleScannedPayload(trimmed)
    }

    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)) {

        // Header
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(stringResource(R.string.scanner_title), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Text(stringResource(R.string.scanner_subtitle), color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodyMedium)
        }

        // Fixed relay notice
        if (preferredRelayBaseURL != null) {
            StatusCard(icon = Icons.Default.Wifi, tint = MaterialTheme.colorScheme.primary,
                title = stringResource(R.string.scanner_relay_locked), message = preferredRelayBaseURL)
        }

        // Camera section
        when {
            cameraPermission.status.isGranted -> {
                CameraSection(isClaiming = isClaiming, cameraResetKey = cameraResetKey, onScanned = { handleScannedPayload(it) })
            }
            else -> {
                StatusCard(icon = Icons.Default.CameraAlt, tint = Color(0xFFFF9800),
                    title = stringResource(R.string.scanner_camera_permission_title),
                    message = stringResource(R.string.scanner_camera_permission_msg))
                Button(onClick = {
                    if (!cameraPermission.status.isGranted) {
                        // Try to open settings if permanently denied
                        context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                            data = Uri.fromParts("package", context.packageName, null)
                        })
                    } else {
                        cameraPermission.launchPermissionRequest()
                    }
                }, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Default.Settings, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text(stringResource(R.string.scanner_open_settings))
                }
            }
        }

        // Error card
        if (errorMessage != null) {
            StatusCard(icon = Icons.Default.Warning, tint = MaterialTheme.colorScheme.error,
                title = stringResource(R.string.scanner_pairing_failed), message = errorMessage ?: "")
        }

        // ── Mac Setup disclosure ──────────────────────────────────────────
        DisclosureCard(
            title = stringResource(R.string.scanner_desktop_setup_title),
            icon = Icons.Default.Computer,
            isExpanded = isMacSetupExpanded,
            onToggle = { isMacSetupExpanded = !isMacSetupExpanded }
        ) {
            Text(stringResource(R.string.scanner_desktop_setup_desc),
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(bottom = 12.dp))
            SetupStepRow(1, stringResource(R.string.scanner_setup_step1), null)
            SetupStepRow(2, stringResource(R.string.scanner_setup_step2), "npm install -g kodexlink")
            SetupStepRow(3, stringResource(R.string.scanner_setup_step3), "kodexlink start")
        }

        // ── Manual entry disclosure ───────────────────────────────────────
        DisclosureCard(
            title = stringResource(R.string.scanner_manual_title),
            icon = Icons.Default.Keyboard,
            isExpanded = isManualEntryExpanded,
            onToggle = { isManualEntryExpanded = !isManualEntryExpanded }
        ) {
            Text(stringResource(R.string.scanner_manual_desc),
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(bottom = 8.dp))

            OutlinedTextField(
                value = pairingPayload,
                onValueChange = { pairingPayload = it },
                modifier = Modifier.fillMaxWidth().height(160.dp),
                placeholder = { Text("{ \"v\": 1, \"relayUrl\": ... }", fontFamily = FontFamily.Monospace,
                    style = MaterialTheme.typography.bodySmall) },
                textStyle = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                shape = RoundedCornerShape(14.dp)
            )
            Spacer(Modifier.height(10.dp))
            Button(
                onClick = { claimManual() },
                enabled = !isClaiming && pairingPayload.trim().isNotEmpty(),
                modifier = Modifier.fillMaxWidth()
            ) {
                if (isClaiming) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp,
                        color = MaterialTheme.colorScheme.onPrimary)
                    Spacer(Modifier.width(8.dp))
                    Text(stringResource(R.string.scanner_pairing))
                } else {
                    Icon(Icons.Default.Link, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text(stringResource(R.string.scanner_pair_manual))
                }
            }
        }

        Spacer(Modifier.height(24.dp))
    }
}

// ── Camera section ─────────────────────────────────────────────────────────

@Composable
private fun CameraSection(isClaiming: Boolean, cameraResetKey: Int, onScanned: (String) -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(300.dp)
            .clip(RoundedCornerShape(24.dp))
            .background(Color.Black)
    ) {
        // key(cameraResetKey) 确保扫码失败后强制重建 QRCameraPreview，重置 hasScanned 状态
        key(cameraResetKey) {
            QRCameraPreview(onScanned = onScanned)
        }

        // Overlay hint
        Box(Modifier.fillMaxSize().padding(16.dp), contentAlignment = Alignment.BottomStart) {
            Surface(shape = RoundedCornerShape(12.dp), color = Color.Black.copy(alpha = 0.55f),
                tonalElevation = 0.dp) {
                Text(
                    text = stringResource(if (isClaiming) R.string.scanner_camera_pairing else R.string.scanner_camera_scan),
                    color = Color.White, modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                    style = MaterialTheme.typography.bodySmall
                )
            }
        }
    }
}

@Composable
private fun QRCameraPreview(onScanned: (String) -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    var hasScanned by remember { mutableStateOf(false) }
    val executor = remember { Executors.newSingleThreadExecutor() }

    AndroidView(
        factory = { ctx ->
            val previewView = PreviewView(ctx)
            val cameraProviderFuture = ProcessCameraProvider.getInstance(ctx)
            cameraProviderFuture.addListener({
                val cameraProvider = cameraProviderFuture.get()
                val preview = Preview.Builder().build().also {
                    it.setSurfaceProvider(previewView.surfaceProvider)
                }
                val analyzer = ImageAnalysis.Builder()
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build().also { analysis ->
                        analysis.setAnalyzer(executor) { imageProxy ->
                            if (!hasScanned) {
                                val mediaImage = imageProxy.image
                                if (mediaImage != null) {
                                    val image = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)
                                    BarcodeScanning.getClient().process(image)
                                        .addOnSuccessListener { barcodes ->
                                            barcodes.firstOrNull { it.format == Barcode.FORMAT_QR_CODE }
                                                ?.rawValue?.let { value ->
                                                    if (!hasScanned) { hasScanned = true; onScanned(value) }
                                                }
                                        }
                                        .addOnCompleteListener { imageProxy.close() }
                                } else imageProxy.close()
                            } else imageProxy.close()
                        }
                    }
                runCatching {
                    cameraProvider.unbindAll()
                    cameraProvider.bindToLifecycle(lifecycleOwner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analyzer)
                }
            }, ContextCompat.getMainExecutor(ctx))
            previewView
        },
        modifier = Modifier.fillMaxSize()
    )
}

// ── Shared UI components ───────────────────────────────────────────────────

@Composable
private fun StatusCard(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    tint: Color,
    title: String,
    message: String
) {
    Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceVariant,
        modifier = Modifier.fillMaxWidth()) {
        Row(modifier = Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(22.dp).padding(top = 2.dp))
            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(title, style = MaterialTheme.typography.titleSmall)
                Text(message, style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun DisclosureCard(
    title: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    isExpanded: Boolean,
    onToggle: () -> Unit,
    content: @Composable ColumnScope.() -> Unit
) {
    Surface(shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surfaceVariant,
        modifier = Modifier.fillMaxWidth()) {
        Column {
            Row(
                modifier = Modifier.fillMaxWidth().clickable(onClick = onToggle).padding(18.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(icon, contentDescription = null, modifier = Modifier.size(20.dp))
                    Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                }
                Icon(
                    if (isExpanded) Icons.Default.KeyboardArrowUp else Icons.Default.KeyboardArrowDown,
                    contentDescription = stringResource(if (isExpanded) R.string.scanner_collapse else R.string.scanner_expand),
                    modifier = Modifier.size(20.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            AnimatedVisibility(visible = isExpanded, enter = expandVertically(), exit = shrinkVertically()) {
                Column(modifier = Modifier.padding(start = 18.dp, end = 18.dp, bottom = 18.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    content()
                }
            }
        }
    }
}

@Composable
private fun SetupStepRow(number: Int, label: String, code: String?) {
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Box(modifier = Modifier.size(20.dp).clip(CircleShape).background(Color(0xFFFF9800)),
            contentAlignment = Alignment.Center) {
            Text("$number", style = MaterialTheme.typography.labelSmall, color = Color.White,
                fontWeight = FontWeight.Bold)
        }
        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(label, style = MaterialTheme.typography.bodySmall)
            if (code != null) {
                Surface(shape = RoundedCornerShape(6.dp), color = Color(0xFFFF9800).copy(alpha = 0.10f)) {
                    Text(code, modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                        fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall,
                        color = Color(0xFFFF9800))
                }
            }
        }
    }
}
