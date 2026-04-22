import SwiftUI

struct SettingsView: View {
    @State private var showTip = false

    private var isSimplifiedChinese: Bool {
        Locale.current.language.languageCode?.identifier == "zh" &&
        Locale.current.language.script?.identifier == "Hans"
    }

    var body: some View {
        List {
            NavigationLink("settings.relayServer", destination: RelaySettingsView())
            NavigationLink("settings.deviceManagement", destination: DeviceManagementView())
            NavigationLink("settings.appearance", destination: ChatAppearanceSettingsView())

            Button {
                showTip = true
            } label: {
                Label("settings.tip", systemImage: "heart.fill")
                    .foregroundStyle(
                        LinearGradient(colors: [.pink, .purple],
                                       startPoint: .leading, endPoint: .trailing)
                    )
            }
            .sheet(isPresented: $showTip) {
                TipView()
            }

            Section("settings.about") {
                if !isSimplifiedChinese {
                    Link(destination: URL(string: "https://apps.apple.com/us/app/lightning-vpn-outline-proxy/id1271020119")!) {
                        Label("settings.myApp", systemImage: "star.fill")
                    }
                }
                Link(destination: URL(string: "https://my-muffin.pages.dev/privacy/kodexlink")!) {
                    Label("settings.privacyPolicy", systemImage: "hand.raised.fill")
                }
                Link(destination: URL(string: "https://my-muffin.pages.dev/terms")!) {
                    Label("settings.termsOfUse", systemImage: "doc.text.fill")
                }
                HStack {
                    Label("settings.version", systemImage: "info.circle.fill")
                    Spacer()
                    Text(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "—")
                        .foregroundStyle(.secondary)
                }
            }

            #if ENABLE_DEV_TOOLS
            Section("Developer") {
                NavigationLink(destination: AppStorePreviewView()) {
                    Label("App Store 截图预览", systemImage: "camera.viewfinder")
                }
            }
            #endif
        }
        .navigationTitle("settings.title")
    }
}

#Preview {
    NavigationStack {
        SettingsView()
    }
}
