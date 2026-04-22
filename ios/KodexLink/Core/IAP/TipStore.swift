import StoreKit

@MainActor
final class TipStore: ObservableObject {
    private static let logTag = "[IAP]"

    static let productIDs = [
        "com.example.kodexlink.tip.small",
        "com.example.kodexlink.tip.large",
        "com.example.kodexlink.tip.lobster",
    ]

    enum LoadState: Equatable {
        case idle
        case loading
        case loaded
        case unavailable
        case failed
    }

    enum PurchaseState: Equatable {
        case idle
        case purchasing
        case success
        case failed
    }

    @Published var products: [Product] = []
    @Published var loadState: LoadState = .idle
    @Published var purchaseState: PurchaseState = .idle
    @Published var loadDebugMessage: String?

    private var hasPreloaded = false

    func preloadProductsIfNeeded() async {
        guard !hasPreloaded else {
            return
        }
        hasPreloaded = true
        await loadProducts()
    }

    func loadProducts() async {
        loadState = .loading
        products = []
        loadDebugMessage = nil
        let bundleIdentifier = Bundle.main.bundleIdentifier ?? "nil"
        let receiptURL = Bundle.main.appStoreReceiptURL?.lastPathComponent ?? "nil"
        let receiptExists = Bundle.main.appStoreReceiptURL.map { FileManager.default.fileExists(atPath: $0.path) } ?? false
        print("\(Self.logTag) [TipStore] context: bundleID=\(bundleIdentifier), receipt=\(receiptURL), receiptExists=\(receiptExists)")
        do {
            let fetched = try await fetchProducts()
            print("\(Self.logTag) [TipStore] loadProducts: fetched \(fetched.count) products, IDs=\(fetched.map(\.id))")
            products = fetched
            loadState = fetched.isEmpty ? .unavailable : .loaded
            if fetched.isEmpty {
                loadDebugMessage = Self.emptyProductsDebugMessage
            }
        } catch {
            print("\(Self.logTag) [TipStore] loadProducts failed: \(error) — \(error.localizedDescription)")
            loadDebugMessage = Self.errorDebugMessage(for: error)
            loadState = .failed
        }
    }

    func purchase(_ product: Product) async {
        purchaseState = .purchasing
        do {
            let result = try await product.purchase()
            switch result {
            case .success(let verification):
                let transaction = try checkVerified(verification)
                await transaction.finish()
                PurchaseStatus.shared.markPurchased()
                purchaseState = .success
            case .userCancelled:
                purchaseState = .idle
            case .pending:
                purchaseState = .idle
            @unknown default:
                purchaseState = .idle
            }
        } catch {
            print("\(Self.logTag) [TipStore] purchase failed: \(error)")
            purchaseState = .failed
        }
    }

    private func checkVerified<T>(_ result: VerificationResult<T>) throws -> T {
        switch result {
        case .unverified(_, let error): throw error
        case .verified(let value): return value
        }
    }

    private func fetchProducts() async throws -> [Product] {
        try await Product.products(for: Self.productIDs)
            .sorted { $0.price < $1.price }
    }

    private static var emptyProductsDebugMessage: String {
#if targetEnvironment(simulator)
        return "Simulator does not expose live App Store products. Test product loading and purchases on a real device."
#else
        return "No products were returned. Verify App Store Connect product status, bundle ID, and sandbox account configuration."
#endif
    }

    private static func errorDebugMessage(for error: Error) -> String {
#if targetEnvironment(simulator)
        return "Failed to query live App Store products on the simulator: \(error.localizedDescription)"
#else
        return error.localizedDescription
#endif
    }
}
