package com.kodexlink.android.core.media

// Auto-generated from iOS: ios/KodexLink/Core/Media/ImageAttachmentPreprocessor.swift
// UIImage → android.graphics.Bitmap；UIGraphicsImageRenderer → Bitmap.createScaledBitmap
// Data → ByteArray；base64EncodedString → Base64.encodeToString

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import java.io.ByteArrayOutputStream
import kotlin.math.floor
import kotlin.math.max

// ── Limits ───────────────────────────────────────────────────────────────────

data class ImageAttachmentLimits(
    val maxLongEdge: Float = 1600f,
    val jpegQuality: Float = 0.7f,   // 0.0–1.0
    val maxBytes: Int = 1_000_000
) {
    companion object {
        val default = ImageAttachmentLimits()
    }
}

// ── Result ───────────────────────────────────────────────────────────────────

data class PreparedImageAttachmentData(
    val jpegData: ByteArray,
    val dataURL: String,
    val width: Int,
    val height: Int
)

// ── Errors ───────────────────────────────────────────────────────────────────

sealed class ImageAttachmentPreprocessorError(message: String) : Exception(message) {
    object DecodeFailed : ImageAttachmentPreprocessorError("图片解码失败")
    class TooLargeAfterProcessing(maxBytes: Int) :
        ImageAttachmentPreprocessorError("图片压缩后仍超出限制（${maxBytes / 1024} KB）")
}

// ── Preprocessor ─────────────────────────────────────────────────────────────

object ImageAttachmentPreprocessor {

    /**
     * Resize and compress [data] to fit within [limits].
     * Mirrors iOS ImageAttachmentPreprocessor.prepare(data:limits:).
     */
    @Throws(ImageAttachmentPreprocessorError::class)
    fun prepare(
        data: ByteArray,
        limits: ImageAttachmentLimits = ImageAttachmentLimits.default
    ): PreparedImageAttachmentData {
        val bitmap = BitmapFactory.decodeByteArray(data, 0, data.size)
            ?: throw ImageAttachmentPreprocessorError.DecodeFailed

        val baseSize = fittedSize(bitmap.width.toFloat(), bitmap.height.toFloat(), limits.maxLongEdge)
        val scaleCandidates = listOf(1.0f, 0.9f, 0.8f, 0.7f, 0.6f, 0.5f)
        val qualityCandidates = normalizedQualityCandidates(limits.jpegQuality)

        for (scale in scaleCandidates) {
            val targetW = max(1, floor(baseSize.first * scale).toInt())
            val targetH = max(1, floor(baseSize.second * scale).toInt())
            val resized = Bitmap.createScaledBitmap(bitmap, targetW, targetH, true)

            for (quality in qualityCandidates) {
                val jpegData = compress(resized, (quality * 100).toInt())
                if (jpegData.size <= limits.maxBytes) {
                    val dataURL = "data:image/jpeg;base64,${Base64.encodeToString(jpegData, Base64.NO_WRAP)}"
                    return PreparedImageAttachmentData(
                        jpegData = jpegData,
                        dataURL = dataURL,
                        width = targetW,
                        height = targetH
                    )
                }
            }
        }

        throw ImageAttachmentPreprocessorError.TooLargeAfterProcessing(limits.maxBytes)
    }

    // ── Private helpers ───────────────────────────────────────────────────

    private fun fittedSize(width: Float, height: Float, maxLongEdge: Float): Pair<Float, Float> {
        val maxEdge = max(width, height)
        if (maxEdge <= maxLongEdge) return Pair(width, height)
        val scale = maxLongEdge / maxEdge
        return Pair(floor(width * scale), floor(height * scale))
    }

    private fun compress(bitmap: Bitmap, quality: Int): ByteArray {
        val out = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, quality.coerceIn(1, 100), out)
        return out.toByteArray()
    }

    private fun normalizedQualityCandidates(preferred: Float): List<Int> {
        val rawValues = listOf(preferred, 0.65f, 0.60f, 0.55f, 0.50f, 0.45f, 0.40f, 0.35f)
        val result = mutableListOf<Int>()
        for (value in rawValues) {
            val bounded = value.coerceIn(0.2f, 1.0f)
            val intVal = (bounded * 100).toInt()
            if (result.none { kotlin.math.abs(it - intVal) < 1 }) {
                result.add(intVal)
            }
        }
        return result
    }
}
