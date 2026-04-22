import UIKit

/// 负责用户头像的持久化存储与加载。
/// 头像以 JPEG 格式保存在 Documents 目录，通过 @EnvironmentObject 注入全局。
final class UserAvatarStore: ObservableObject {
    @Published var avatar: UIImage?

    private var avatarURL: URL? {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first?
            .appendingPathComponent("user_avatar.jpg")
    }

    init() {
        load()
    }

    func save(_ image: UIImage) {
        guard let url = avatarURL,
              let data = image.jpegData(compressionQuality: 0.88) else { return }
        try? data.write(to: url, options: .atomic)
        avatar = image
    }

    func remove() {
        guard let url = avatarURL else { return }
        try? FileManager.default.removeItem(at: url)
        avatar = nil
    }

    private func load() {
        guard let url = avatarURL,
              FileManager.default.fileExists(atPath: url.path),
              let data = try? Data(contentsOf: url),
              let image = UIImage(data: data) else { return }
        avatar = image
    }
}
