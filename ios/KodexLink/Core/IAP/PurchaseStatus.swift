import StoreKit

/// 购买状态管理：检查用户是否曾完成任意打赏，用于决定是否展示广告。
/// - UserDefaults 作为快速缓存（冷启动立即可读）
/// - 启动时异步从 StoreKit 交易历史二次验证，删除重装后仍可恢复
@MainActor
final class PurchaseStatus {

    static let shared = PurchaseStatus()

    private static let cacheKey = "hasPurchased"

    /// 是否已购买（UserDefaults 缓存）
    private(set) var hasPurchased: Bool {
        get { UserDefaults.standard.bool(forKey: Self.cacheKey) }
        set { UserDefaults.standard.set(newValue, forKey: Self.cacheKey) }
    }

    private init() {}

    private static let tipProductIDs: Set<String> = [
        "com.example.kodexlink.tip.small",
        "com.example.kodexlink.tip.large",
        "com.example.kodexlink.tip.lobster",
    ]

    /// App 启动时调用：从 StoreKit 本地交易历史异步验证，更新缓存。
    /// 删除重装后 StoreKit 凭证仍在，可恢复免广告状态。
    func verifyFromTransactionHistory() {
        Task {
            for await result in Transaction.all {
                if case .verified(let tx) = result,
                   Self.tipProductIDs.contains(tx.productID) {
                    if !hasPurchased {
                        hasPurchased = true
                    }
                    return
                }
            }
        }
    }

    /// 购买成功时立即标记，无需等待异步验证。
    func markPurchased() {
        hasPurchased = true
    }
}
