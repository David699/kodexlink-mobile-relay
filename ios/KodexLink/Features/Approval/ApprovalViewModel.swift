import Foundation
import Combine

@MainActor
final class ApprovalViewModel: ObservableObject {
    @Published var title = String(localized: "approval.waitingTitle")
}
