// Auto-generated from iOS: ios/KodexLink/Core/Pairing/QRScannerService.swift，生成时间：2026-03-26T00:00:00Z
package com.kodexlink.android.core.pairing

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import java.util.Base64

// ── Authorization state ──────────────────────────────────────────────────────

/**
 * Mirrors iOS AVAuthorizationStatus for camera access.
 */
enum class QRScannerAuthorizationState {
    NOT_DETERMINED,
    AUTHORIZED,
    DENIED,
    RESTRICTED,
    UNAVAILABLE
}

// ── Errors ───────────────────────────────────────────────────────────────────

/**
 * Errors that can be thrown during QR payload normalization.
 */
sealed class QRScannerError : Exception() {
    object UnsupportedPayload : QRScannerError() {
        override val message: String get() = "QR payload format is not supported."
    }
}

// ── Service ──────────────────────────────────────────────────────────────────

/**
 * Handles camera permission checks and QR payload normalization.
 *
 * iOS uses AVCaptureDevice for authorization; Android equivalent is
 * ContextCompat.checkSelfPermission(CAMERA).
 *
 * Runtime permission *requesting* (equivalent to AVCaptureDevice.requestAccess)
 * must be initiated from an Activity/Fragment via ActivityResultLauncher.
 * [requestCameraAccessIfNeeded] therefore returns the current state only;
 * the caller is responsible for launching the permission dialog if the result
 * is [QRScannerAuthorizationState.NOT_DETERMINED].
 */
class QRScannerService(private val context: Context) {

    /**
     * Returns the current camera authorization state without prompting the user.
     */
    val authorizationState: QRScannerAuthorizationState
        get() {
            if (!context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)) {
                return QRScannerAuthorizationState.UNAVAILABLE
            }
            return when (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA)) {
                PackageManager.PERMISSION_GRANTED -> QRScannerAuthorizationState.AUTHORIZED
                else -> QRScannerAuthorizationState.NOT_DETERMINED
            }
        }

    /**
     * Returns the current authorization state.
     *
     * On Android, actually *requesting* the permission requires Activity context
     * and must be done with ActivityResultLauncher<String>.  Call this method to
     * check the current state; if NOT_DETERMINED, trigger the launcher from your
     * Composable / Fragment.
     *
     * NOTE: Permission result callbacks are handled in the UI layer, not here.
     * TODO("需要适配 Android 平台 API：在 Activity/Fragment 中调用 ActivityResultLauncher 发起相机权限请求")
     */
    suspend fun requestCameraAccessIfNeeded(): QRScannerAuthorizationState {
        return authorizationState
    }

    /**
     * Normalizes a raw QR scan value into a JSON payload string.
     *
     * Accepts:
     *  1. A raw JSON string (starts with `{`)
     *  2. A URL with a `?payload=` query parameter containing a JSON string
     *  3. A Base64-encoded JSON string
     *
     * @throws QRScannerError.UnsupportedPayload if the value cannot be decoded.
     */
    @Throws(QRScannerError.UnsupportedPayload::class)
    fun normalizedPayload(scannedValue: String): String {
        val trimmed = scannedValue.trim()
        if (trimmed.isEmpty()) throw QRScannerError.UnsupportedPayload

        // 1. Direct JSON
        if (trimmed.startsWith("{")) return trimmed

        // 2. URL with ?payload= query param
        try {
            val uri = android.net.Uri.parse(trimmed)
            val payloadParam = uri.getQueryParameter("payload")
            if (!payloadParam.isNullOrBlank()) {
                val normalized = payloadParam.trim()
                if (normalized.startsWith("{")) return normalized
            }
        } catch (_: Exception) { /* not a valid URI – continue */ }

        // 3. Base64-encoded JSON
        try {
            val decoded = String(Base64.getDecoder().decode(trimmed), Charsets.UTF_8).trim()
            if (decoded.startsWith("{")) return decoded
        } catch (_: Exception) { /* not valid Base64 – fall through */ }

        throw QRScannerError.UnsupportedPayload
    }
}
