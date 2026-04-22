import SwiftUI
import StoreKit

struct TipView: View {
    @EnvironmentObject private var store: TipStore
    @State private var showThankYou = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                Color(.systemGroupedBackground).ignoresSafeArea()

                if showThankYou {
                    ThankYouView { dismiss() }
                        .transition(.opacity.combined(with: .scale(scale: 0.95)))
                } else {
                    ScrollView {
                        VStack(spacing: 28) {
                            headerSection
                            contentSection
                        }
                        .padding(.horizontal, 20)
                        .padding(.top, 12)
                        .padding(.bottom, 40)
                    }
                }
            }
            .navigationTitle(NSLocalizedString("tip.title", comment: ""))
            .navigationBarTitleDisplayMode(.inline)
            .task {
                await store.preloadProductsIfNeeded()
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    if !showThankYou {
                        Button(NSLocalizedString("common.cancel", comment: "")) { dismiss() }
                    }
                }
            }
            .animation(.easeInOut(duration: 0.35), value: showThankYou)
            .onChange(of: store.purchaseState) { _, state in
                if state == .success {
                    withAnimation { showThankYou = true }
                }
            }
        }
    }

    // MARK: - Header

    private var headerSection: some View {
        VStack(spacing: 16) {
            ZStack {
                Circle()
                    .fill(
                        LinearGradient(
                            colors: [Color.orange.opacity(0.18), Color.pink.opacity(0.14)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: 88, height: 88)
                Text("☕️")
                    .font(.system(size: 40))
            }

            VStack(spacing: 8) {
                Text(NSLocalizedString("tip.header.title", comment: ""))
                    .font(.system(size: 22, weight: .bold, design: .rounded))
                Text(NSLocalizedString("tip.header.subtitle", comment: ""))
                    .font(.system(size: 15))
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(3)
                    .padding(.horizontal, 16)
            }
        }
        .padding(.top, 8)
    }

    // MARK: - Products

    @ViewBuilder
    private var contentSection: some View {
        switch store.loadState {
        case .idle, .loading:
            ProgressView()
                .padding(.top, 40)
        case .loaded:
            productsSection
        case .unavailable:
            unavailableSection
        case .failed:
            loadFailedSection
        }
    }

    private var productsSection: some View {
        VStack(spacing: 14) {
            ForEach(store.products, id: \.id) { product in
                TipProductCard(
                    product: product,
                    isPurchasing: store.purchaseState == .purchasing
                ) {
                    Task { await store.purchase(product) }
                }
            }

            if store.purchaseState == .failed {
                Text(NSLocalizedString("tip.error", comment: ""))
                    .font(.caption)
                    .foregroundStyle(.red)
                    .padding(.top, 4)
            }

            Text(NSLocalizedString("tip.footer", comment: ""))
                .font(.caption)
                .foregroundStyle(Color(.tertiaryLabel))
                .multilineTextAlignment(.center)
                .padding(.top, 8)
        }
    }

    private var unavailableSection: some View {
        TipStateSection(
            iconName: "shippingbox.circle",
            titleKey: "tip.unavailable",
            messageKey: "tip.unavailable.hint",
            debugMessage: store.loadDebugMessage
        ) {
            Task { await store.loadProducts() }
        }
    }

    private var loadFailedSection: some View {
        TipStateSection(
            iconName: "exclamationmark.triangle",
            titleKey: "tip.loadFailed",
            messageKey: "tip.loadFailed.hint",
            debugMessage: store.loadDebugMessage
        ) {
            Task { await store.loadProducts() }
        }
    }
}

private struct TipStateSection: View {
    let iconName: String
    let titleKey: String
    let messageKey: String
    let debugMessage: String?
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: iconName)
                .font(.system(size: 32))
                .foregroundStyle(.secondary)

            Text(NSLocalizedString(titleKey, comment: ""))
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.primary)
                .multilineTextAlignment(.center)

            Text(NSLocalizedString(messageKey, comment: ""))
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 16)

#if ENABLE_DEV_TOOLS
            if let debugMessage, !debugMessage.isEmpty {
                Text(debugMessage)
                    .font(.caption2)
                    .foregroundStyle(Color(.tertiaryLabel))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 12)
            }
#endif

            Button(NSLocalizedString("tip.retry", comment: ""), action: onRetry)
                .buttonStyle(.bordered)
        }
        .padding(.top, 40)
    }
}

// MARK: - 产品卡片

private struct TipProductCard: View {
    let product: Product
    let isPurchasing: Bool
    let onTap: () -> Void

    private enum Tier { case small, large, lobster }

    private var tier: Tier {
        if product.id.hasSuffix(".small") { return .small }
        if product.id.hasSuffix(".lobster") { return .lobster }
        return .large
    }

    private var emoji: String {
        switch tier {
        case .small: "☕️"
        case .large: "🍰"
        case .lobster: "🦞"
        }
    }

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 16) {
                // 图标
                ZStack {
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(iconBackground)
                        .frame(width: 52, height: 52)
                    Text(emoji)
                        .font(.system(size: 26))
                }

                // 文字
                VStack(alignment: .leading, spacing: 4) {
                    Text(product.displayName)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Color.primary)
                    Text(product.description)
                        .font(.system(size: 13))
                        .foregroundStyle(Color.secondary)
                        .lineLimit(2)
                }

                Spacer(minLength: 0)

                // 价格
                if isPurchasing {
                    ProgressView()
                        .frame(width: 60)
                } else {
                    Text(product.displayPrice)
                        .font(.system(size: 15, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .background(priceBackground, in: Capsule())
                }
            }
            .padding(16)
            .background(Color(.secondarySystemGroupedBackground),
                        in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(isPurchasing)
    }

    private var iconBackground: LinearGradient {
        switch tier {
        case .small:
            LinearGradient(colors: [Color.orange.opacity(0.2), Color.yellow.opacity(0.15)],
                           startPoint: .topLeading, endPoint: .bottomTrailing)
        case .large:
            LinearGradient(colors: [Color.pink.opacity(0.2), Color.purple.opacity(0.15)],
                           startPoint: .topLeading, endPoint: .bottomTrailing)
        case .lobster:
            LinearGradient(colors: [Color.red.opacity(0.18), Color(red: 1, green: 0.4, blue: 0.2).opacity(0.15)],
                           startPoint: .topLeading, endPoint: .bottomTrailing)
        }
    }

    private var priceBackground: LinearGradient {
        switch tier {
        case .small:
            LinearGradient(colors: [Color.orange, Color.yellow],
                           startPoint: .leading, endPoint: .trailing)
        case .large:
            LinearGradient(colors: [Color.pink, Color(red: 0.7, green: 0.2, blue: 0.9)],
                           startPoint: .leading, endPoint: .trailing)
        case .lobster:
            LinearGradient(colors: [Color(red: 0.9, green: 0.1, blue: 0.1), Color(red: 1, green: 0.45, blue: 0.1)],
                           startPoint: .leading, endPoint: .trailing)
        }
    }
}

// MARK: - Preview

#Preview {
    TipView()
        .environmentObject(TipStore())
}
