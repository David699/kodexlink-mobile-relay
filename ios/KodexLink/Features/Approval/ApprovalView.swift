import SwiftUI

struct ApprovalView: View {
    @StateObject private var viewModel = ApprovalViewModel()

    var body: some View {
        VStack(spacing: 16) {
            Text(viewModel.title)
                .font(.headline)
            HStack {
                Button("approval.reject") {}
                Button("approval.approve") {}
            }
        }
        .padding(24)
    }
}

#Preview {
    ApprovalView()
}

