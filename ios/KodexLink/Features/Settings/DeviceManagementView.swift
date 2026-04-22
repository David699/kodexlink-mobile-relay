import SwiftUI

struct DeviceManagementView: View {
    @EnvironmentObject private var bindingStore: BindingStore

    private var secondaryBindings: [BindingRecord] {
        guard let defaultBinding = bindingStore.defaultBinding else {
            return bindingStore.bindings
        }

        return bindingStore.bindings.filter { $0.id != defaultBinding.id }
    }

    var body: some View {
        List {
            if let defaultBinding = bindingStore.defaultBinding {
                Section("deviceManagement.defaultMac") {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(defaultBinding.agentName)
                            .font(.headline)
                        Text(defaultBinding.agentId)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            Section("deviceManagement.boundDevices") {
                if secondaryBindings.isEmpty {
                    Text("deviceManagement.noOtherDevices")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(secondaryBindings) { binding in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(binding.agentName)
                                .font(.body.weight(.semibold))
                            Text(binding.agentId)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .navigationTitle("deviceManagement.title")
    }
}

#Preview {
    NavigationStack {
        DeviceManagementView()
            .environmentObject(BindingStore())
    }
}
