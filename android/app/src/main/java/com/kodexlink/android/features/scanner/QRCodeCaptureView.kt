// Auto-generated from iOS: ios/KodexLink/Features/Scanner/QRCodeCaptureView.swift，生成时间：2026-03-26T00:00:00Z
// AVFoundation (AVCaptureSession / AVCaptureVideoPreviewLayer / AVCaptureMetadataOutput)
//   → CameraX (ProcessCameraProvider / PreviewView / ImageAnalysis + ML Kit BarcodeScanning)
package com.kodexlink.android.features.scanner

import android.util.Log
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * QR コードキャプチャービュー（独立 Composable）。
 *
 * CameraX + ML Kit Barcode Scanning で QR コードを検出し、ペイロードを [onPayload] へ返す。
 * [ScannerView] から利用される低レイヤコンポーネント。
 *
 * iOS 対応:
 *   AVCaptureSession              → ProcessCameraProvider (CameraX)
 *   AVCaptureVideoPreviewLayer    → PreviewView (CameraX)
 *   AVCaptureMetadataOutput       → ML Kit BarcodeScanning + ImageAnalysis.Analyzer
 *   Coordinator (sessionQueue)    → single-thread Executor + DisposableEffect
 */
@Composable
fun QRCodeCaptureView(
    modifier: Modifier = Modifier,
    onPayload: (String) -> Unit
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current

    // rememberUpdatedState so the lambda always captures the latest onPayload
    // even if the caller recomposes (equivalent to iOS Coordinator holding a weak delegate).
    val currentOnPayload by rememberUpdatedState(onPayload)

    // Single-thread executor mirrors iOS's AVFoundation sessionQueue.
    // remember so it survives recompositions; DisposableEffect shuts it down on disposal.
    val cameraExecutor: ExecutorService = remember { Executors.newSingleThreadExecutor() }
    DisposableEffect(Unit) {
        onDispose { cameraExecutor.shutdown() }
    }

    AndroidView(
        modifier = modifier,
        factory = { ctx ->
            val previewView = PreviewView(ctx)
            val cameraProviderFuture = ProcessCameraProvider.getInstance(ctx)

            cameraProviderFuture.addListener({
                val cameraProvider = cameraProviderFuture.get()

                // Preview — mirrors AVCaptureVideoPreviewLayer
                val preview = Preview.Builder().build().also {
                    it.setSurfaceProvider(previewView.surfaceProvider)
                }

                // ImageAnalysis + ML Kit — mirrors AVCaptureMetadataOutput
                val barcodeScanner = BarcodeScanning.getClient()
                val analyzer = ImageAnalysis.Builder()
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()
                    .also { analysis ->
                        analysis.setAnalyzer(cameraExecutor) { imageProxy ->
                            val mediaImage = imageProxy.image
                            if (mediaImage != null) {
                                val inputImage = InputImage.fromMediaImage(
                                    mediaImage,
                                    imageProxy.imageInfo.rotationDegrees
                                )
                                barcodeScanner.process(inputImage)
                                    .addOnSuccessListener { barcodes ->
                                        // First QR code wins — mirrors iOS
                                        // metadataOutput(_:didOutput:from:) firing once per frame
                                        barcodes
                                            .firstOrNull { it.format == Barcode.FORMAT_QR_CODE }
                                            ?.rawValue
                                            ?.let { payload -> currentOnPayload(payload) }
                                    }
                                    .addOnFailureListener { e ->
                                        Log.e("QRCodeCaptureView", "Barcode scan error", e)
                                    }
                                    .addOnCompleteListener { imageProxy.close() }
                            } else {
                                imageProxy.close()
                            }
                        }
                    }

                // Bind to lifecycle — equivalent to iOS session.startRunning()
                try {
                    cameraProvider.unbindAll()
                    cameraProvider.bindToLifecycle(
                        lifecycleOwner,
                        CameraSelector.DEFAULT_BACK_CAMERA,
                        preview,
                        analyzer
                    )
                } catch (e: Exception) {
                    Log.e("QRCodeCaptureView", "Camera bind failed", e)
                }
            }, ContextCompat.getMainExecutor(ctx))

            previewView
        }
    )
}
