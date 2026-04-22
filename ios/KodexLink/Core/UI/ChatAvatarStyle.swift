import SwiftUI

/// AI 头像风格，存储在 UserDefaults 中，可由用户在"外观"设置页切换。
enum ChatAvatarStyle: String, CaseIterable, Identifiable {
    /// 默认：Codex 图标（codex.png）
    case codex
    /// ChatGPT 图标（chatgpt.png）
    case chatgpt
    /// Claude 风格：紫色渐变 + 魔法棒图标
    case claude
    /// 极简风格：蓝色渐变 + 闪烁图标
    case minimal

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .codex:    return NSLocalizedString("avatar.style.codex", comment: "")
        case .chatgpt:  return NSLocalizedString("avatar.style.chatgpt", comment: "")
        case .claude:   return NSLocalizedString("avatar.style.claude", comment: "")
        case .minimal:  return NSLocalizedString("avatar.style.minimal", comment: "")
        }
    }
}

// MARK: - AssistantAvatarView

/// assistant 侧头像，根据用户选择的风格渲染。
struct AssistantAvatarView: View {
    let style: ChatAvatarStyle

    var body: some View {
        Group {
            switch style {
            case .codex:
                Image("codex")
                    .resizable()
                    .scaledToFill()
            case .chatgpt:
                Image("chatgpt")
                    .resizable()
                    .scaledToFill()
            case .claude:
                ZStack {
                    LinearGradient(
                        colors: [Color(red: 0.55, green: 0.27, blue: 0.95),
                                 Color(red: 0.82, green: 0.44, blue: 1.0)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                    Image(systemName: "wand.and.stars")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.white)
                }
            case .minimal:
                ZStack {
                    LinearGradient(
                        colors: [Color(red: 0.2, green: 0.5, blue: 1.0),
                                 Color(red: 0.1, green: 0.8, blue: 0.9)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                    Image(systemName: "sparkle")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.white)
                }
            }
        }
        .frame(width: 32, height: 32)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

// MARK: - UserAvatarView

/// 用户侧头像：有自定义头像时显示用户图片，否则显示默认人形图标。
struct UserAvatarView: View {
    @EnvironmentObject private var avatarStore: UserAvatarStore

    var body: some View {
        Group {
            if let avatar = avatarStore.avatar {
                Image(uiImage: avatar)
                    .resizable()
                    .scaledToFill()
            } else {
                Image(systemName: "person.circle.fill")
                    .font(.system(size: 32))
                    .foregroundStyle(.secondary)
            }
        }
        .frame(width: 32, height: 32)
        .clipShape(Circle())
    }
}
