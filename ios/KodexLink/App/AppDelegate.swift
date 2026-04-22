import UIKit
import GoogleMobileAds

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        GADMobileAds.sharedInstance().start { _ in
            Task { @MainActor in
                AppOpenAdManager.shared.loadAd()
            }
        }
        Task { @MainActor in
            PurchaseStatus.shared.verifyFromTransactionHistory()
        }
        return true
    }
}

