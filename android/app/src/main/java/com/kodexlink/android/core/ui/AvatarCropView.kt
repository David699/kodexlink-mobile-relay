// Auto-generated from iOS: ios/KodexLink/Core/UI/AvatarCropView.swift，生成时间：2026-03-26T00:00:00Z
// SwiftUI View → @Composable
// @State              → remember { mutableStateOf(...) }
// MagnificationGesture + DragGesture → detectTransformGestures
// UIImage             → android.graphics.Bitmap
// UIGraphicsImageRenderer → android.graphics.Canvas + Bitmap
// SwiftUI Canvas / blendMode(.clear) → Compose Canvas + drawIntoCanvas + BlendMode.Clear
package com.kodexlink.android.core.ui

import android.graphics.Bitmap
import android.graphics.Canvas as AndroidCanvas
import android.graphics.Paint as AndroidPaint
import android.graphics.RectF
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
// Modifier.weight is a scoped extension on ColumnScope — no import required inside Column { }
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Paint as ComposePaint
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kodexlink.android.R
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * 全屏头像裁剪 Composable。
 *
 * 支持双指缩放 + 拖拽，圆形预览区，确认后输出裁剪好的 200×200 px 方形 [Bitmap]。
 *
 * @param inputBitmap 原始图片。对应 iOS 的 inputImage: UIImage。
 * @param onConfirm   确认时回调，参数为裁剪后的 200×200 Bitmap。
 * @param onCancel    取消时回调。
 */
@Composable
fun AvatarCropView(
    inputBitmap: Bitmap,
    onConfirm: (Bitmap) -> Unit,
    onCancel: () -> Unit
) {
    val density = LocalDensity.current

    // cropDiameter in pixels — mirrors iOS's private let cropDiameter: CGFloat = 280
    val cropDiameterPx = with(density) { 280.dp.toPx() }

    // @State equivalents
    var currentScale by remember { mutableFloatStateOf(1f) }
    var offsetX by remember { mutableFloatStateOf(0f) }
    var offsetY by remember { mutableFloatStateOf(0f) }
    var containerSize by remember { mutableStateOf(IntSize.Zero) }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black)
    ) {
        // ── 图片层（全屏，含安全区）────────────────────────────────────────────
        // Mirrors: Image(uiImage:).resizable().scaledToFill() + scaleEffect + offset
        Box(
            modifier = Modifier
                .fillMaxSize()
                .onSizeChanged { containerSize = it }
                .clipToBounds()
                // SimultaneousGesture(MagnificationGesture, DragGesture)
                .pointerInput(Unit) {
                    detectTransformGestures { _, pan, zoom, _ ->
                        currentScale = max(1f, currentScale * zoom)
                        offsetX += pan.x
                        offsetY += pan.y
                    }
                }
                // Apply scale first (drawing-only, does not alter layout bounds),
                // then offset in layout coordinates.
                .scale(currentScale)
                .offset { IntOffset(offsetX.roundToInt(), offsetY.roundToInt()) }
        ) {
            Image(
                bitmap = inputBitmap.asImageBitmap(),
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize()
            )
        }

        // ── 遮罩层（全屏）─────────────────────────────────────────────────────
        // Mirrors: CropMaskOverlay(cropDiameter:).ignoresSafeArea()
        CropMaskOverlay(
            cropDiameterPx = cropDiameterPx,
            modifier = Modifier.fillMaxSize()
        )

        // ── 控制层（尊重安全区）────────────────────────────────────────────────
        Column(modifier = Modifier.fillMaxSize()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 16.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Cancel button — mirrors NSLocalizedString("avatar.crop.cancel")
                Button(
                    onClick = onCancel,
                    colors = ButtonDefaults.textButtonColors(contentColor = Color.White)
                ) {
                    Text(stringResource(R.string.avatar_crop_cancel))
                }

                // Title — mirrors NSLocalizedString("avatar.crop.title")
                Text(
                    text = stringResource(R.string.avatar_crop_title),
                    color = Color.White,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 17.sp
                )

                // Confirm button — mirrors NSLocalizedString("avatar.crop.confirm")
                Button(
                    onClick = {
                        val cropped = cropBitmap(
                            source = inputBitmap,
                            containerSize = containerSize,
                            currentScale = currentScale,
                            offsetX = offsetX,
                            offsetY = offsetY,
                            cropDiameterPx = cropDiameterPx
                        )
                        onConfirm(cropped)
                    },
                    colors = ButtonDefaults.textButtonColors(contentColor = Color.White)
                ) {
                    Text(text = stringResource(R.string.avatar_crop_confirm), fontWeight = FontWeight.Bold)
                }
            }

            Spacer(modifier = Modifier.weight(1f))

            // Hint — mirrors NSLocalizedString("avatar.crop.hint")
            Text(
                text = stringResource(R.string.avatar_crop_hint),
                color = Color.White.copy(alpha = 0.65f),
                fontSize = 12.sp,
                modifier = Modifier
                    .align(Alignment.CenterHorizontally)
                    .padding(bottom = 28.dp)
            )
        }
    }
}

// ── CropMaskOverlay ─────────────────────────────────────────────────────────────
// Mirrors iOS private struct CropMaskOverlay: View (Canvas + blendMode .clear + Circle stroke)

@Composable
private fun CropMaskOverlay(
    cropDiameterPx: Float,
    modifier: Modifier = Modifier
) {
    Canvas(modifier = modifier) {
        // 1. Semi-transparent black fill over the whole surface
        drawRect(color = Color.Black.copy(alpha = 0.55f))

        // 2. Cut out a circular hole using BlendMode.Clear
        //    Mirrors: var env = context; env.blendMode = .clear; env.fill(Path(ellipseIn:))
        drawIntoCanvas { canvas ->
            val holePaint = ComposePaint().apply {
                blendMode = BlendMode.Clear
            }
            canvas.drawCircle(
                center = Offset(size.width / 2f, size.height / 2f),
                radius = cropDiameterPx / 2f,
                paint = holePaint
            )
        }

        // 3. White stroke border around the circle
        //    Mirrors: Circle().strokeBorder(.white.opacity(0.55), lineWidth: 1.5)
        drawCircle(
            color = Color.White.copy(alpha = 0.55f),
            radius = cropDiameterPx / 2f,
            style = Stroke(width = 1.5f)
        )
    }
}

// ── cropBitmap ──────────────────────────────────────────────────────────────────
// Mirrors iOS AvatarCropView.cropImage() — coordinate-space math is a direct port.

private fun cropBitmap(
    source: Bitmap,
    containerSize: IntSize,
    currentScale: Float,
    offsetX: Float,
    offsetY: Float,
    cropDiameterPx: Float
): Bitmap {
    if (containerSize.width == 0 || containerSize.height == 0) return source

    val imgW = source.width.toFloat()
    val imgH = source.height.toFloat()
    val imgAspect = imgW / imgH
    val containerAspect = containerSize.width.toFloat() / containerSize.height.toFloat()

    // scaledToFill base render size (ContentScale.Crop equivalent)
    val baseW: Float
    val baseH: Float
    if (imgAspect > containerAspect) {
        baseH = containerSize.height.toFloat()
        baseW = baseH * imgAspect
    } else {
        baseW = containerSize.width.toFloat()
        baseH = baseW / imgAspect
    }

    val displayW = baseW * currentScale
    val displayH = baseH * currentScale

    // Image top-left in view coordinate space
    val imageOriginX = (containerSize.width - displayW) / 2f + offsetX
    val imageOriginY = (containerSize.height - displayH) / 2f + offsetY

    // Crop circle top-left in view coordinate space
    val cropLeft = (containerSize.width - cropDiameterPx) / 2f
    val cropTop = (containerSize.height - cropDiameterPx) / 2f

    // Map crop rect to original bitmap coordinate space
    val scaleToImage = imgW / displayW
    val cropX = ((cropLeft - imageOriginX) * scaleToImage).roundToInt()
    val cropY = ((cropTop - imageOriginY) * scaleToImage).roundToInt()
    val cropSize = (cropDiameterPx * scaleToImage).roundToInt()

    // Clamp to bitmap bounds
    val clampedX = max(0, cropX)
    val clampedY = max(0, cropY)
    val clampedW = min(cropSize, source.width - clampedX)
    val clampedH = min(cropSize, source.height - clampedY)

    if (clampedW <= 0 || clampedH <= 0) return source

    val cropped = Bitmap.createBitmap(source, clampedX, clampedY, clampedW, clampedH)

    // Scale to 200×200 output — mirrors UIGraphicsImageRenderer(size: CGSize(200, 200))
    val outputPx = 200
    val output = Bitmap.createBitmap(outputPx, outputPx, Bitmap.Config.ARGB_8888)
    val canvas = AndroidCanvas(output)
    val paint = AndroidPaint(AndroidPaint.FILTER_BITMAP_FLAG or AndroidPaint.ANTI_ALIAS_FLAG)
    canvas.drawBitmap(cropped, null, RectF(0f, 0f, outputPx.toFloat(), outputPx.toFloat()), paint)
    return output
}
