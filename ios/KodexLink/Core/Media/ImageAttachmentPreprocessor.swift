import CoreGraphics
import Foundation
import UIKit

struct ImageAttachmentLimits {
    let maxLongEdge: CGFloat
    let jpegQuality: CGFloat
    let maxBytes: Int

    static let `default` = ImageAttachmentLimits(
        maxLongEdge: 1600,
        jpegQuality: 0.7,
        maxBytes: 1_000_000
    )
}

struct PreparedImageAttachmentData {
    let jpegData: Data
    let dataURL: String
    let width: Int
    let height: Int
}

enum ImageAttachmentPreprocessorError: LocalizedError {
    case decodeFailed
    case tooLargeAfterProcessing(maxBytes: Int)

    var errorDescription: String? {
        switch self {
        case .decodeFailed:
            return String(localized: "imageError.decodeFailed")
        case .tooLargeAfterProcessing(let maxBytes):
            return String(format: String(localized: "imageError.tooLarge"), maxBytes / 1024)
        }
    }
}

enum ImageAttachmentPreprocessor {
    static func prepare(
        data: Data,
        limits: ImageAttachmentLimits = .default
    ) throws -> PreparedImageAttachmentData {
        guard let image = UIImage(data: data) else {
            throw ImageAttachmentPreprocessorError.decodeFailed
        }

        let baseSize = fittedSize(for: image.size, maxLongEdge: limits.maxLongEdge)
        let scaleCandidates: [CGFloat] = [1.0, 0.9, 0.8, 0.7, 0.6, 0.5]
        let qualityCandidates = normalizedQualityCandidates(preferred: limits.jpegQuality)

        for scale in scaleCandidates {
            let targetSize = CGSize(
                width: max(1, floor(baseSize.width * scale)),
                height: max(1, floor(baseSize.height * scale))
            )
            let resizedImage = resized(image: image, to: targetSize)

            for quality in qualityCandidates {
                guard let jpegData = resizedImage.jpegData(compressionQuality: quality) else {
                    continue
                }

                if jpegData.count <= limits.maxBytes {
                    let dataURL = "data:image/jpeg;base64,\(jpegData.base64EncodedString())"
                    return PreparedImageAttachmentData(
                        jpegData: jpegData,
                        dataURL: dataURL,
                        width: Int(targetSize.width),
                        height: Int(targetSize.height)
                    )
                }
            }
        }

        throw ImageAttachmentPreprocessorError.tooLargeAfterProcessing(maxBytes: limits.maxBytes)
    }

    private static func fittedSize(for sourceSize: CGSize, maxLongEdge: CGFloat) -> CGSize {
        let maxSourceEdge = max(sourceSize.width, sourceSize.height)
        guard maxSourceEdge > maxLongEdge else {
            return sourceSize
        }

        let scale = maxLongEdge / maxSourceEdge
        return CGSize(
            width: floor(sourceSize.width * scale),
            height: floor(sourceSize.height * scale)
        )
    }

    private static func resized(image: UIImage, to targetSize: CGSize) -> UIImage {
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        format.opaque = false

        let renderer = UIGraphicsImageRenderer(size: targetSize, format: format)
        return renderer.image { _ in
            image.draw(in: CGRect(origin: .zero, size: targetSize))
        }
    }

    private static func normalizedQualityCandidates(preferred: CGFloat) -> [CGFloat] {
        let rawValues: [CGFloat] = [preferred, 0.65, 0.6, 0.55, 0.5, 0.45, 0.4, 0.35]
        var values: [CGFloat] = []
        for value in rawValues {
            let bounded = min(1.0, max(0.2, value))
            if values.contains(where: { abs($0 - bounded) < 0.001 }) {
                continue
            }
            values.append(bounded)
        }
        return values
    }
}
