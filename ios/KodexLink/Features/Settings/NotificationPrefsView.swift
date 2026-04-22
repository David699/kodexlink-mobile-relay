import SwiftUI

struct NotificationPrefsView: View {
    @State private var approvalEnabled = true
    @State private var completionEnabled = true

    var body: some View {
        Form {
            Toggle("notificationPrefs.approval", isOn: $approvalEnabled)
            Toggle("notificationPrefs.completion", isOn: $completionEnabled)
        }
        .navigationTitle("notificationPrefs.title")
    }
}

#Preview {
    NavigationStack {
        NotificationPrefsView()
    }
}

