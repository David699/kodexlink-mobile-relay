import SwiftUI

struct OnboardingView: View {
    let pairingService: PairingService

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Spacer()

                // ── Hero 图标 ────────────────────────────────────
                heroSection
                    .padding(.bottom, 32)

                // ── 特性列表 ─────────────────────────────────────
                VStack(spacing: 18) {
                    OnboardingFeatureRow(
                        icon: "antenna.radiowaves.left.and.right",
                        color: .blue,
                        title: "onboarding.feature1.title",
                        desc: "onboarding.feature1.desc"
                    )
                    OnboardingFeatureRow(
                        icon: "bubble.left.and.bubble.right.fill",
                        color: Color(red: 0.42, green: 0.32, blue: 0.98),
                        title: "onboarding.feature2.title",
                        desc: "onboarding.feature2.desc"
                    )
                    OnboardingFeatureRow(
                        icon: "terminal.fill",
                        color: .green,
                        title: "onboarding.feature3.title",
                        desc: "onboarding.feature3.desc"
                    )
                }
                .padding(.horizontal, 28)

                // ── Mac 端安装引导 ────────────────────────────────
                macSetupSection
                    .padding(.top, 20)

                Spacer()

                // ── CTA 按钮 ─────────────────────────────────────
                NavigationLink(destination: ScannerView(pairingService: pairingService)) {
                    Text("onboarding.startPairing")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 4)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .padding(.horizontal, 28)
                .padding(.bottom, 16)

                #if ENABLE_DEV_TOOLS
                NavigationLink(destination: AppStorePreviewView()) {
                    Label("截图预览模式", systemImage: "camera.viewfinder")
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .padding(.bottom, 36)
                #else
                Spacer().frame(height: 36)
                #endif
            }
        }
    }

    private var macSetupSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("onboarding.macSetup.title", systemImage: "laptopcomputer")
                .font(.subheadline.weight(.semibold))

            VStack(alignment: .leading, spacing: 10) {
                MacSetupStepRow(number: 1, label: "onboarding.macSetup.step1", code: nil)
                MacSetupStepRow(number: 2, label: "onboarding.macSetup.step2", code: "npm install -g kodexlink")
                MacSetupStepRow(number: 3, label: "onboarding.macSetup.step3", code: "kodexlink start")
            }

            Text("onboarding.macSetup.footer")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(16)
        .background(
            Color(.secondarySystemGroupedBackground),
            in: RoundedRectangle(cornerRadius: 20, style: .continuous)
        )
        .padding(.horizontal, 28)
    }

    private var heroSection: some View {
        VStack(spacing: 20) {
            // 图标 + 光晕
            ZStack {
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [
                                Color(red: 0.42, green: 0.32, blue: 0.98).opacity(0.22),
                                Color(red: 0.42, green: 0.32, blue: 0.98).opacity(0.0)
                            ],
                            center: .center,
                            startRadius: 20,
                            endRadius: 72
                        )
                    )
                    .frame(width: 144, height: 144)

                Image("codex")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 96, height: 96)
                    .shadow(color: Color(red: 0.42, green: 0.32, blue: 0.98).opacity(0.35), radius: 20, y: 8)
            }

            // 标题
            Text("KodexLink")
                .font(.largeTitle.bold())

            // 副标题（Codex 高亮）
            (
                Text("onboarding.subtitle.prefix")
                + Text("Codex")
                    .foregroundStyle(Color(red: 0.42, green: 0.32, blue: 0.98))
                    .fontWeight(.semibold)
                + Text("onboarding.subtitle.suffix")
            )
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 32)
        }
    }
}

// MARK: - Mac Setup Step Row

private struct MacSetupStepRow: View {
    let number: Int
    let label: LocalizedStringKey
    let code: String?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text("\(number)")
                .font(.caption2.weight(.bold))
                .foregroundStyle(.white)
                .frame(width: 18, height: 18)
                .background(Color.orange, in: Circle())

            VStack(alignment: .leading, spacing: 4) {
                Text(label)
                    .font(.footnote)
                if let code {
                    Text(code)
                        .font(.caption.monospaced())
                        .foregroundStyle(.orange)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(
                            Color.orange.opacity(0.1),
                            in: RoundedRectangle(cornerRadius: 6, style: .continuous)
                        )
                }
            }
        }
    }
}

// MARK: - Feature Row

private struct OnboardingFeatureRow: View {
    let icon: String
    let color: Color
    let title: LocalizedStringKey
    let desc: LocalizedStringKey

    var body: some View {
        HStack(spacing: 16) {
            ZStack {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(color.opacity(0.12))
                    .frame(width: 52, height: 52)
                Image(systemName: icon)
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(color)
            }

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                Text(desc)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 0)
        }
    }
}

#Preview {
    OnboardingView(pairingService: PairingService())
}
