import GoogleMobileAds
import UIKit

/// 管理开屏广告的加载与展示。
/// - 冷启动时自动加载，前台切换时按需展示
/// - 广告有效期 4 小时，过期后重新加载
@MainActor
final class AppOpenAdManager: NSObject {

    static let shared = AppOpenAdManager()

    // MARK: - 私有状态

    private var appOpenAd: GADAppOpenAd?
    private var isLoadingAd = false
    private var isShowingAd = false
    private var loadTime: Date?

    private let adUnitID: String = Bundle.main.infoDictionary?["AdMobAdUnitID"] as? String ?? ""
    private let adExpiryInterval: TimeInterval = 4 * 3600

    // MARK: - 公开接口

    /// 预加载广告（应用启动时调用）
    func loadAd() {
        print("[AppOpenAd] loadAd called — isLoadingAd=\(isLoadingAd) isAdAvailable=\(isAdAvailable())")
        guard !isLoadingAd else {
            print("[AppOpenAd] skip: already loading")
            return
        }
        guard !isAdAvailable() else {
            print("[AppOpenAd] skip: ad already available")
            return
        }
        isLoadingAd = true
        print("[AppOpenAd] start loading adUnitID=\(adUnitID)")

        GADAppOpenAd.load(
            withAdUnitID: adUnitID,
            request: GADRequest()
        ) { [weak self] ad, error in
            guard let self else { return }
            self.isLoadingAd = false

            if let error {
                print("[AppOpenAd] load FAILED: \(error.localizedDescription)")
                DiagnosticsLogger.warning("AppOpenAd", "load_failed", metadata: DiagnosticsLogger.metadata(["error": error.localizedDescription]))
                return
            }

            self.appOpenAd = ad
            self.appOpenAd?.fullScreenContentDelegate = self
            self.loadTime = Date()
            print("[AppOpenAd] load SUCCESS ✓")
            DiagnosticsLogger.info("AppOpenAd", "load_success")
        }
    }

    /// 展示广告。若无可用广告则触发加载，下次前台再展示。
    func showAdIfAvailable() {
        guard !PurchaseStatus.shared.hasPurchased else {
            print("[AppOpenAd] skip: user has purchased, ads disabled")
            return
        }
        print("[AppOpenAd] showAdIfAvailable — isShowingAd=\(isShowingAd) isAdAvailable=\(isAdAvailable()) ad=\(appOpenAd != nil)")
        guard !isShowingAd else {
            print("[AppOpenAd] skip: already showing")
            return
        }
        guard isAdAvailable(), let ad = appOpenAd else {
            print("[AppOpenAd] skip: no ad available, triggering load")
            loadAd()
            return
        }
        guard let rootVC = rootViewController() else {
            print("[AppOpenAd] skip: rootViewController not found")
            return
        }

        print("[AppOpenAd] presenting on \(type(of: rootVC))")
        isShowingAd = true
        ad.present(fromRootViewController: rootVC)
        DiagnosticsLogger.info("AppOpenAd", "presented")
    }

    // MARK: - 私有辅助

    private func isAdAvailable() -> Bool {
        guard appOpenAd != nil, let loadTime else { return false }
        return Date().timeIntervalSince(loadTime) < adExpiryInterval
    }

    private func rootViewController() -> UIViewController? {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow }?
            .rootViewController
    }
}

// MARK: - GADFullScreenContentDelegate

extension AppOpenAdManager: GADFullScreenContentDelegate {

    nonisolated func adDidDismissFullScreenContent(_ ad: any GADFullScreenPresentingAd) {
        Task { @MainActor in
            self.appOpenAd = nil
            self.isShowingAd = false
            self.loadAd()
            DiagnosticsLogger.info("AppOpenAd", "dismissed")
        }
    }

    nonisolated func ad(_ ad: any GADFullScreenPresentingAd, didFailToPresentFullScreenContentWithError error: Error) {
        Task { @MainActor in
            self.isShowingAd = false
            self.loadAd()
            DiagnosticsLogger.warning("AppOpenAd", "present_failed", metadata: DiagnosticsLogger.metadata(["error": error.localizedDescription]))
        }
    }
}
