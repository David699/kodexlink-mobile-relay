import AVFoundation
import SwiftUI
import UIKit

struct QRCodeCaptureView: UIViewRepresentable {
    let isScanningEnabled: Bool
    let onPayload: (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onPayload: onPayload, isScanningEnabled: isScanningEnabled)
    }

    func makeUIView(context: Context) -> QRCodePreviewView {
        let view = QRCodePreviewView()
        context.coordinator.attach(to: view)
        return view
    }

    func updateUIView(_ uiView: QRCodePreviewView, context: Context) {
        context.coordinator.setScanningEnabled(isScanningEnabled)
    }

    static func dismantleUIView(_ uiView: QRCodePreviewView, coordinator: Coordinator) {
        coordinator.stop()
    }

    final class Coordinator: NSObject, AVCaptureMetadataOutputObjectsDelegate {
        private let onPayload: (String) -> Void
        private let session = AVCaptureSession()
        private let sessionQueue = DispatchQueue(label: "codexmobile.qrcode.capture")
        private var isScanningEnabled: Bool

        init(onPayload: @escaping (String) -> Void, isScanningEnabled: Bool) {
            self.onPayload = onPayload
            self.isScanningEnabled = isScanningEnabled
            super.init()
        }

        func attach(to view: QRCodePreviewView) {
            view.previewLayer.session = session
            view.previewLayer.videoGravity = .resizeAspectFill
            DiagnosticsLogger.info(
                "QRCodeCaptureView",
                "camera_session_attach",
                metadata: DiagnosticsLogger.metadata([
                    "traceTag": "PAIR_TRACE"
                ])
            )
            sessionQueue.async { [weak self] in
                self?.applyScanningState()
            }
        }

        func stop() {
            DiagnosticsLogger.info(
                "QRCodeCaptureView",
                "camera_session_stop_requested",
                metadata: DiagnosticsLogger.metadata([
                    "traceTag": "PAIR_TRACE",
                    "isRunning": session.isRunning ? "true" : "false"
                ])
            )
            sessionQueue.async { [session] in
                guard session.isRunning else {
                    return
                }

                session.stopRunning()
                DiagnosticsLogger.info(
                    "QRCodeCaptureView",
                    "camera_session_stopped",
                    metadata: DiagnosticsLogger.metadata([
                        "traceTag": "PAIR_TRACE"
                    ])
                )
            }
        }

        func setScanningEnabled(_ enabled: Bool) {
            guard isScanningEnabled != enabled else {
                return
            }

            isScanningEnabled = enabled
            DiagnosticsLogger.info(
                "QRCodeCaptureView",
                "camera_scanning_state_changed",
                metadata: DiagnosticsLogger.metadata([
                    "traceTag": "PAIR_TRACE",
                    "enabled": enabled ? "true" : "false"
                ])
            )
            sessionQueue.async { [weak self] in
                self?.applyScanningState()
            }
        }

        func metadataOutput(
            _ output: AVCaptureMetadataOutput,
            didOutput metadataObjects: [AVMetadataObject],
            from connection: AVCaptureConnection
        ) {
            guard let codeObject = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
                  codeObject.type == .qr,
                  let payload = codeObject.stringValue else {
                return
            }

            DiagnosticsLogger.info(
                "QRCodeCaptureView",
                "camera_payload_detected",
                metadata: DiagnosticsLogger.metadata([
                    "traceTag": "PAIR_TRACE",
                    "payloadLength": String(payload.count)
                ])
            )

            onPayload(payload)
        }

        private func applyScanningState() {
            if isScanningEnabled {
                configureAndStartSession()
                return
            }

            guard session.isRunning else {
                return
            }

            session.stopRunning()
            DiagnosticsLogger.info(
                "QRCodeCaptureView",
                "camera_session_paused",
                metadata: DiagnosticsLogger.metadata([
                    "traceTag": "PAIR_TRACE"
                ])
            )
        }

        private func configureAndStartSession() {
            DiagnosticsLogger.info(
                "QRCodeCaptureView",
                "camera_session_configure_start",
                metadata: DiagnosticsLogger.metadata([
                    "traceTag": "PAIR_TRACE"
                ])
            )
            if session.isRunning {
                return
            }

            if !session.inputs.isEmpty || !session.outputs.isEmpty {
                session.startRunning()
                DiagnosticsLogger.info(
                    "QRCodeCaptureView",
                    "camera_session_restarted",
                    metadata: DiagnosticsLogger.metadata([
                        "traceTag": "PAIR_TRACE"
                    ])
                )
                return
            }

            guard let camera = AVCaptureDevice.default(for: .video),
                  let input = try? AVCaptureDeviceInput(device: camera) else {
                DiagnosticsLogger.warning(
                    "QRCodeCaptureView",
                    "camera_session_camera_unavailable",
                    metadata: DiagnosticsLogger.metadata([
                        "traceTag": "PAIR_TRACE"
                    ])
                )
                return
            }

            let output = AVCaptureMetadataOutput()

            session.beginConfiguration()
            session.sessionPreset = .high

            guard session.canAddInput(input), session.canAddOutput(output) else {
                session.commitConfiguration()
                return
            }

            session.addInput(input)
            session.addOutput(output)
            output.setMetadataObjectsDelegate(self, queue: .main)
            output.metadataObjectTypes = [.qr]

            session.commitConfiguration()
            session.startRunning()
            DiagnosticsLogger.info(
                "QRCodeCaptureView",
                "camera_session_started",
                metadata: DiagnosticsLogger.metadata([
                    "traceTag": "PAIR_TRACE"
                ])
            )
        }
    }
}

final class QRCodePreviewView: UIView {
    override class var layerClass: AnyClass {
        AVCaptureVideoPreviewLayer.self
    }

    var previewLayer: AVCaptureVideoPreviewLayer {
        guard let layer = layer as? AVCaptureVideoPreviewLayer else {
            fatalError("QRCodePreviewView layer should be AVCaptureVideoPreviewLayer")
        }
        return layer
    }
}
