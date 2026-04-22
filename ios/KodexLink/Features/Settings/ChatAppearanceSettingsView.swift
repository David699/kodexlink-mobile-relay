import SwiftUI

struct ChatAppearanceSettingsView: View {
    @AppStorage("chatAvatarStyle") private var avatarStyle: String = ChatAvatarStyle.codex.rawValue
    @EnvironmentObject private var avatarStore: UserAvatarStore

    private var currentStyle: ChatAvatarStyle {
        ChatAvatarStyle(rawValue: avatarStyle) ?? .codex
    }

    var body: some View {
        List {
            // ── 用户头像 ──────────────────────────────────────────
            Section {
                NavigationLink(destination: UserAvatarPickerView()) {
                    HStack(spacing: 14) {
                        userAvatarPreview
                        VStack(alignment: .leading, spacing: 2) {
                            Text("settings.appearance.myAvatar")
                                .font(.body)
                            Text(avatarStore.avatar != nil
                                 ? NSLocalizedString("settings.appearance.myAvatarSet", comment: "")
                                 : NSLocalizedString("settings.appearance.myAvatarDefault", comment: ""))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 4)
                }
            } header: {
                Text("settings.appearance.myAvatarSection")
            }

            // ── AI 头像 ───────────────────────────────────────────
            Section {
                ForEach(ChatAvatarStyle.allCases) { (style: ChatAvatarStyle) in
                    Button {
                        avatarStyle = style.rawValue
                    } label: {
                        HStack(spacing: 14) {
                            AssistantAvatarView(style: style)
                            Text(style.displayName)
                                .foregroundStyle(.primary)
                            Spacer(minLength: 0)
                            if currentStyle == style {
                                Image(systemName: "checkmark")
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundStyle(Color.accentColor)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                    .buttonStyle(.plain)
                }
            } header: {
                Text("settings.appearance.aiAvatarSection")
            } footer: {
                Text("settings.appearance.aiAvatarFooter")
            }

            Section {
                previewRow(role: .assistant)
                previewRow(role: .user)
            } header: {
                Text("settings.appearance.preview")
            }
        }
        .navigationTitle("settings.appearance.title")
        .navigationBarTitleDisplayMode(.inline)
    }

    @ViewBuilder
    private var userAvatarPreview: some View {
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
        .frame(width: 36, height: 36)
        .clipShape(Circle())
    }

    @ViewBuilder
    private func previewRow(role: ThreadMessageRole) -> some View {
        HStack(alignment: .top, spacing: 8) {
            if role == .assistant {
                AssistantAvatarView(style: currentStyle)
                previewBubble(role: role)
                Spacer(minLength: 0)
            } else {
                Spacer(minLength: 0)
                previewBubble(role: role)
                UserAvatarView()
            }
        }
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
    }

    @ViewBuilder
    private func previewBubble(role: ThreadMessageRole) -> some View {
        let isAssistant = role == .assistant
        Text(isAssistant
            ? NSLocalizedString("settings.appearance.previewAssistant", comment: "")
            : NSLocalizedString("settings.appearance.previewUser", comment: ""))
            .font(.subheadline)
            .foregroundStyle(isAssistant ? AnyShapeStyle(.primary) : AnyShapeStyle(Color.white))
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(
                isAssistant
                    ? AnyShapeStyle(.regularMaterial)
                    : AnyShapeStyle(LinearGradient(
                        colors: [.blue, .cyan],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )),
                in: RoundedRectangle(cornerRadius: 14, style: .continuous)
            )
    }
}

#Preview {
    NavigationStack {
        ChatAppearanceSettingsView()
    }
}
