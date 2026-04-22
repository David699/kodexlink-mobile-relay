import SwiftUI
import UIKit

/// 全屏头像裁剪视图：支持双指缩放 + 拖拽，圆形预览区，确认后输出裁剪好的方形图。
struct AvatarCropView: View {
    let inputImage: UIImage
    let onConfirm: (UIImage) -> Void
    let onCancel: () -> Void

    @State private var currentScale: CGFloat = 1.0
    @State private var lastScale: CGFloat = 1.0
    @State private var currentOffset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero
    /// 图片层（全屏）的实际尺寸，用于裁剪计算
    @State private var containerSize: CGSize = .zero

    private let cropDiameter: CGFloat = 280

    var body: some View {
        ZStack {
            // ── 背景 ────────────────────────────────────────────
            Color.black.ignoresSafeArea()

            // ── 图片层（全屏，含安全区）─────────────────────────
            GeometryReader { geo in
                Image(uiImage: inputImage)
                    .resizable()
                    .scaledToFill()
                    .frame(width: geo.size.width, height: geo.size.height)
                    .scaleEffect(currentScale)
                    .offset(currentOffset)
                    .clipped()
                    .onAppear { containerSize = geo.size }
                    .onChange(of: geo.size) { _, size in containerSize = size }
            }
            .ignoresSafeArea()                  // 图片延伸到状态栏 / 底部
            .gesture(cropGesture)

            // ── 遮罩层（全屏，含安全区）─────────────────────────
            CropMaskOverlay(cropDiameter: cropDiameter)
                .ignoresSafeArea()

            // ── 控制层（尊重安全区，按钮不被状态栏遮挡）────────
            VStack(spacing: 0) {
                HStack {
                    Button(NSLocalizedString("avatar.crop.cancel", comment: "")) {
                        onCancel()
                    }

                    Spacer()

                    Text(NSLocalizedString("avatar.crop.title", comment: ""))
                        .font(.headline)

                    Spacer()

                    Button(NSLocalizedString("avatar.crop.confirm", comment: "")) {
                        let cropped = cropImage()
                        onConfirm(cropped)
                    }
                    .fontWeight(.semibold)
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 20)
                .padding(.vertical, 16)

                Spacer()

                Text(NSLocalizedString("avatar.crop.hint", comment: ""))
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.65))
                    .padding(.bottom, 28)
            }
        }
    }

    // MARK: - Gestures

    private var cropGesture: some Gesture {
        SimultaneousGesture(
            MagnificationGesture()
                .onChanged { value in
                    currentScale = max(1.0, lastScale * value)
                }
                .onEnded { value in
                    lastScale = max(1.0, lastScale * value)
                    currentScale = lastScale
                },
            DragGesture()
                .onChanged { value in
                    currentOffset = CGSize(
                        width: lastOffset.width + value.translation.width,
                        height: lastOffset.height + value.translation.height
                    )
                }
                .onEnded { _ in
                    lastOffset = currentOffset
                }
        )
    }

    // MARK: - Crop Math

    private func cropImage() -> UIImage {
        guard containerSize != .zero else { return inputImage }

        let imageSize = inputImage.size
        let imageAspect = imageSize.width / imageSize.height
        let containerAspect = containerSize.width / containerSize.height

        // scaledToFill 在 containerSize 下的基础渲染尺寸
        let baseWidth: CGFloat
        let baseHeight: CGFloat
        if imageAspect > containerAspect {
            baseHeight = containerSize.height
            baseWidth = baseHeight * imageAspect
        } else {
            baseWidth = containerSize.width
            baseHeight = baseWidth / imageAspect
        }

        let displayWidth = baseWidth * currentScale
        let displayHeight = baseHeight * currentScale

        // 图片在视图坐标系中的左上角
        let imageOriginX = (containerSize.width - displayWidth) / 2 + currentOffset.width
        let imageOriginY = (containerSize.height - displayHeight) / 2 + currentOffset.height

        // 裁剪圆在视图坐标系中的位置（以全屏为基准居中）
        let cropLeft = (containerSize.width - cropDiameter) / 2
        let cropTop  = (containerSize.height - cropDiameter) / 2

        // 转换到原始图片坐标系
        let scaleToImage = imageSize.width / displayWidth
        let cropInImage = CGRect(
            x: (cropLeft - imageOriginX) * scaleToImage,
            y: (cropTop  - imageOriginY) * scaleToImage,
            width:  cropDiameter * scaleToImage,
            height: cropDiameter * scaleToImage
        )

        let clampedRect = cropInImage.intersection(CGRect(origin: .zero, size: imageSize))
        guard !clampedRect.isNull,
              let cgImage = inputImage.cgImage?.cropping(to: clampedRect) else {
            return inputImage
        }

        let outputSize = CGSize(width: 200, height: 200)
        let renderer = UIGraphicsImageRenderer(size: outputSize)
        return renderer.image { _ in
            UIImage(cgImage: cgImage).draw(in: CGRect(origin: .zero, size: outputSize))
        }
    }
}

// MARK: - CropMaskOverlay

private struct CropMaskOverlay: View {
    let cropDiameter: CGFloat

    var body: some View {
        Canvas { context, size in
            context.fill(
                Path(CGRect(origin: .zero, size: size)),
                with: .color(.black.opacity(0.55))
            )
            var env = context
            env.blendMode = .clear
            let center = CGPoint(x: size.width / 2, y: size.height / 2)
            let rect = CGRect(
                x: center.x - cropDiameter / 2,
                y: center.y - cropDiameter / 2,
                width: cropDiameter,
                height: cropDiameter
            )
            env.fill(Path(ellipseIn: rect), with: .color(.white))
        }
        .allowsHitTesting(false)
        .overlay(
            Circle()
                .strokeBorder(.white.opacity(0.55), lineWidth: 1.5)
                .frame(width: cropDiameter, height: cropDiameter)
        )
    }
}
