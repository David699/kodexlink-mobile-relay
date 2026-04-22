import SwiftUI

// MARK: - 语言

enum MockLanguage: String, CaseIterable {
    case chinese = "中文"
    case english = "English"
}

// MARK: - 数据模型

private enum MockRole {
    case user, assistant
}

private struct MockMessage: Identifiable {
    let id = UUID()
    let role: MockRole
    let text: String
    let time: String
}

private struct MockCommandOutput: Identifiable {
    let id = UUID()
    let title: String
    let detail: String
    let output: String
    let isSuccess: Bool
}

private enum MockRow: Identifiable {
    case message(MockMessage)
    case command(MockCommandOutput)

    var id: UUID {
        switch self {
        case .message(let m): return m.id
        case .command(let c): return c.id
        }
    }
}

// MARK: - 模拟对话内容

private func mockRows(for language: MockLanguage) -> [MockRow] {
    switch language {
    case .chinese:
        return [
            .message(MockMessage(
                role: .user,
                text: "帮我重构这个 URLSession 封装，支持 async/await 并发请求和指数退避重试",
                time: "10:21"
            )),
            .message(MockMessage(
                role: .assistant,
                text: "好的！我来分析现有代码，然后给你一个更现代的实现。\n\n主要改动：\n• 用 `async throws` 替换回调闭包\n• 加入 `withRetry` 泛型包装器，支持指数退避\n• 请求/响应拦截器链式设计\n\n先跑一下测试确认基线👇",
                time: "10:21"
            )),
            .command(MockCommandOutput(
                title: "swift test --filter NetworkClientTests",
                detail: "NetworkClientTests",
                output: "Test Suite 'NetworkClientTests' started\n...\nTest Case '-[NetworkClientTests testRetryOnTimeout]' passed (0.342s)\nTest Case '-[NetworkClientTests testConcurrentRequests]' passed (0.128s)\n\nExecuted 8 tests, with 0 failures in 1.203s",
                isSuccess: true
            )),
            .message(MockMessage(
                role: .assistant,
                text: "基线测试全部通过 ✓ 重构完成，新的 `NetworkClient` 用法：\n\n```swift\nlet client = NetworkClient(\n    retryPolicy: .exponentialBackoff(maxAttempts: 3),\n    timeout: 30\n)\nlet data = try await client.fetch(UserProfile.self, from: .profile)\n```\n\n已更新 `Sources/Network/NetworkClient.swift` 和对应单元测试。",
                time: "10:23"
            )),
            .message(MockMessage(
                role: .user,
                text: "完美！顺手帮我加上请求日志和耗时统计吧",
                time: "10:24"
            )),
            .message(MockMessage(
                role: .assistant,
                text: "已添加 `RequestLogger` 中间件，自动记录每次请求的耗时、状态码和错误信息。Debug 构建打印到控制台，Release 静默写入本地日志文件。\n\n需要我把日志也接入 Crashlytics 吗？",
                time: "10:25"
            )),
        ]
    case .english:
        return [
            .message(MockMessage(
                role: .user,
                text: "Refactor my URLSession wrapper to support async/await concurrent requests and exponential backoff retry",
                time: "10:21"
            )),
            .message(MockMessage(
                role: .assistant,
                text: "Sure! Let me analyze the existing code and give you a modern implementation.\n\nKey changes:\n• Replace completion handlers with `async throws`\n• Add a generic `withRetry` wrapper with exponential backoff\n• Chain request/response interceptors\n\nRunning baseline tests first 👇",
                time: "10:21"
            )),
            .command(MockCommandOutput(
                title: "swift test --filter NetworkClientTests",
                detail: "NetworkClientTests",
                output: "Test Suite 'NetworkClientTests' started\n...\nTest Case '-[NetworkClientTests testRetryOnTimeout]' passed (0.342s)\nTest Case '-[NetworkClientTests testConcurrentRequests]' passed (0.128s)\n\nExecuted 8 tests, with 0 failures in 1.203s",
                isSuccess: true
            )),
            .message(MockMessage(
                role: .assistant,
                text: "All baseline tests passed ✓ Refactoring complete. New `NetworkClient` usage:\n\n```swift\nlet client = NetworkClient(\n    retryPolicy: .exponentialBackoff(maxAttempts: 3),\n    timeout: 30\n)\nlet data = try await client.fetch(UserProfile.self, from: .profile)\n```\n\nUpdated `Sources/Network/NetworkClient.swift` and all unit tests.",
                time: "10:23"
            )),
            .message(MockMessage(
                role: .user,
                text: "Perfect! Can you also add request logging and performance monitoring?",
                time: "10:24"
            )),
            .message(MockMessage(
                role: .assistant,
                text: "Added a `RequestLogger` middleware that automatically records latency, status codes, and errors. Logs print to the console in Debug builds, and are silently written to a local log file in Release.\n\nWant me to pipe the logs into Crashlytics as well?",
                time: "10:25"
            )),
        ]
    }
}

private func mockTitle(for language: MockLanguage) -> String {
    switch language {
    case .chinese: return "NetworkClient 重构"
    case .english: return "NetworkClient Refactor"
    }
}

private func composerPlaceholder(for language: MockLanguage) -> String {
    switch language {
    case .chinese: return "继续对话…"
    case .english: return "Continue the conversation…"
    }
}

private func commandStatusLabel(isSuccess: Bool, language: MockLanguage) -> String {
    switch language {
    case .chinese: return isSuccess ? "完成" : "失败"
    case .english: return isSuccess ? "Done" : "Failed"
    }
}

private func meLabel(for language: MockLanguage) -> String {
    switch language {
    case .chinese: return "我"
    case .english: return "Me"
    }
}

// MARK: - 主视图

struct AppStorePreviewView: View {
    @State private var language: MockLanguage = .chinese

    var body: some View {
        let rows = mockRows(for: language)
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 12) {
                    ForEach(rows) { row in
                        mockRowView(row)
                            .id(row.id)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 20)
            }
            .background(Color(UIColor.systemGroupedBackground))
            .navigationTitle(mockTitle(for: language))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    languageToggleButton
                }
            }
            .safeAreaInset(edge: .bottom) {
                MockComposerBar(placeholder: composerPlaceholder(for: language))
            }
            .onChange(of: language) { _, _ in
                let newRows = mockRows(for: language)
                if let lastId = newRows.last?.id {
                    proxy.scrollTo(lastId, anchor: .bottom)
                }
            }
            .onAppear {
                if let lastId = rows.last?.id {
                    proxy.scrollTo(lastId, anchor: .bottom)
                }
            }
        }
    }

    private var languageToggleButton: some View {
        Menu {
            ForEach(MockLanguage.allCases, id: \.self) { lang in
                Button {
                    language = lang
                } label: {
                    if lang == language {
                        Label(lang.rawValue, systemImage: "checkmark")
                    } else {
                        Text(lang.rawValue)
                    }
                }
            }
        } label: {
            Label(language.rawValue, systemImage: "globe")
                .font(.subheadline.weight(.medium))
                .opacity(0)
        }
    }

    @ViewBuilder
    private func mockRowView(_ row: MockRow) -> some View {
        switch row {
        case .message(let msg):
            MockMessageBubble(message: msg, meLabel: meLabel(for: language))
        case .command(let cmd):
            MockCommandCard(output: cmd, language: language)
        }
    }
}

// MARK: - 消息气泡

private struct MockMessageBubble: View {
    let message: MockMessage
    let meLabel: String

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            if message.role == .assistant {
                MockAssistantAvatar()
                bubble
                Spacer(minLength: 32)
            } else {
                Spacer(minLength: 32)
                bubble
                MockUserAvatar()
            }
        }
    }

    private var bubble: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .center) {
                Text(message.role == .assistant ? "Codex" : meLabel)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(labelColor)
                Spacer(minLength: 0)
                Text(message.time)
                    .font(.caption2)
                    .foregroundStyle(timestampColor)
            }
            Text(message.text)
                .font(.body)
                .foregroundStyle(textColor)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(backgroundStyle, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private var backgroundStyle: AnyShapeStyle {
        if message.role == .assistant {
            return AnyShapeStyle(.regularMaterial)
        }
        return AnyShapeStyle(
            LinearGradient(
                colors: [Color.blue, Color.cyan],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
    }

    private var labelColor: Color {
        message.role == .assistant ? Color.secondary : Color.white.opacity(0.85)
    }

    private var textColor: Color {
        message.role == .assistant ? Color.primary : Color.white
    }

    private var timestampColor: Color {
        message.role == .assistant ? Color(UIColor.tertiaryLabel) : Color.white.opacity(0.72)
    }
}

// MARK: - 命令输出卡片

private struct MockCommandCard: View {
    let output: MockCommandOutput
    let language: MockLanguage
    @State private var isExpanded = false

    var body: some View {
        HStack {
            DisclosureGroup(isExpanded: $isExpanded) {
                Text(output.output)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 8)
            } label: {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        Image(systemName: "terminal")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(statusTint)
                        Text(output.detail)
                            .font(.caption.weight(.semibold))
                            .lineLimit(1)
                        Spacer(minLength: 0)
                        Text(commandStatusLabel(isSuccess: output.isSuccess, language: language))
                            .font(.caption2.weight(.bold))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(statusTint.opacity(0.12), in: Capsule())
                            .foregroundStyle(statusTint)
                    }
                    Text(output.title)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(Color(UIColor.secondarySystemGroupedBackground))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(statusTint.opacity(0.12), lineWidth: 1)
            )
            Spacer(minLength: 56)
        }
    }

    private var statusTint: Color { output.isSuccess ? .green : .red }
}

// MARK: - 头像

private struct MockAssistantAvatar: View {
    var body: some View {
        Image("codex")
            .resizable()
            .scaledToFill()
            .frame(width: 32, height: 32)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

private struct MockUserAvatar: View {
    var body: some View {
        Image(systemName: "person.circle.fill")
            .font(.system(size: 32))
            .foregroundStyle(Color.blue.gradient)
            .frame(width: 32, height: 32)
    }
}

// MARK: - 静态输入栏

private struct MockComposerBar: View {
    let placeholder: String

    var body: some View {
        HStack(alignment: .bottom, spacing: 12) {
            Image(systemName: "paperclip.circle.fill")
                .font(.system(size: 28))
                .foregroundStyle(Color.secondary)

            Text(placeholder)
                .font(.body)
                .foregroundStyle(Color(UIColor.placeholderText))
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 8)
                .padding(.vertical, 7)
                .background(
                    RoundedRectangle(cornerRadius: 8)
                        .strokeBorder(Color(UIColor.separator), lineWidth: 0.5)
                        .background(Color(UIColor.systemBackground), in: RoundedRectangle(cornerRadius: 8))
                )

            Image(systemName: "arrow.up.circle.fill")
                .font(.system(size: 28))
                .foregroundStyle(Color.secondary)
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 12)
        .background(.bar)
    }
}

// MARK: - Preview

#Preview {
    NavigationStack {
        AppStorePreviewView()
    }
}
